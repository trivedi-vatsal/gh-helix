# Architecture

## Design goals

gh-helix exists to answer one question with confidence: *if GitHub disappeared right now, could
we get every repository back?* Every architectural choice in this codebase is downstream of that
goal:

1. **Mirrors, not clones.** A working clone loses refs, notes, and remote-tracking branches that
   don't map to a local branch. A `git clone --mirror` keeps everything.
2. **Verifiable, not just "ran without error."** Every mirror is `git fsck`'d after every sync.
   LFS is treated as part of the repository, not an optional extra — a mirror missing its LFS
   objects is not disaster-recoverable, so it's reported as a failure, not a warning.
3. **Safe to interrupt, anywhere.** Every operation that touches disk (metadata writes, directory
   moves, restores) is designed so that killing the process mid-operation and re-running the same
   command resolves the interruption automatically. See [Transaction Model](transaction-model.md)
   and the safe-move algorithm below.
4. **Safe to run concurrently with itself.** Two invocations against the same backup directory
   must never race. See [Locking](locking.md).
5. **Scale-aware.** Discovery is paginated and cached; disk usage is read from GitHub's own
   repository metadata rather than walking the filesystem, so `status` stays fast at 10,000+ repos.
6. **Degrade, don't fail closed.** If the GitHub API is unreachable, Git-level maintenance of
   mirrors you already know about should still be possible — see
   [Repository Discovery](repository-discovery.md#degraded-mode).

## Component overview

```mermaid
flowchart TB
    subgraph CLI["cli.ts (Commander)"]
        direction LR
        C1[backup] 
        C2[restore]
        C3[clean]
        C4[verify]
        C5[status]
        C6[list]
        C7[health]
    end

    subgraph Config["config/"]
        CFG[config.ts<br/>.env + config.json + process env]
    end

    subgraph API["api/"]
        CLIENT[client.ts<br/>Octokit + token resolution]
        DISCOVER[discover.ts<br/>pagination + cache + degraded mode]
    end

    subgraph Mirror["mirror/"]
        CLONE[clone.ts / update.ts]
        VERIFY[verify.ts<br/>fsck]
        LFS[lfs.ts]
        AUTH[auth.ts<br/>ephemeral token injection]
        ORPHAN[orphans.ts]
        RENAME[rename.ts]
        RESTORE[restore.ts]
        INSPECT[inspect.ts]
    end

    subgraph Metadata["metadata/"]
        LOCK[lock.ts<br/>cross-process lock]
        TX[transaction.ts<br/>journaled multi-file writes]
        CACHE[cache.ts<br/>repositories.json]
        MANIFEST[manifest.ts<br/>manifest.json / last-run.json]
    end

    subgraph Utils["utils/"]
        SAFEMOVE[safeMove.ts<br/>staged directory moves]
        RETRY[retry.ts]
    end

    CLI --> Config
    CLI --> API
    CLI --> Mirror
    CLI --> Metadata
    API --> CACHE
    Mirror --> AUTH
    ORPHAN --> SAFEMOVE
    RENAME --> SAFEMOVE
    RESTORE --> SAFEMOVE
    MANIFEST --> TX
    CACHE --> TX
    CLI --> LOCK
```

### Component responsibilities

| Layer | Responsibility | Knows about |
| --- | --- | --- |
| `cli.ts` / `commands/` | Parse arguments, orchestrate a single command end-to-end, own the exit code | Everything below it |
| `api/` | Talk to the GitHub REST API, resolve tokens, cache and degrade discovery | Octokit, `.metadata/repositories.json` |
| `mirror/` | All `git`/`git lfs` process invocations against a single mirror | Local filesystem, `git`, `git-lfs` |
| `metadata/` | Read/write `.metadata/*.json` durably and atomically, hold the cross-process lock | Filesystem only — no Git, no GitHub |
| `utils/` | Cross-cutting primitives (retry, safe moves, exec, filtering) | Nothing above it |

This is a strict layering: `mirror/` never reaches into `metadata/`, and `metadata/` never shells
out to `git`. `commands/` is the only layer that composes across all of them. This is what makes
the [extension points](../README.md#extension-points) in the root README possible without
touching existing code — a storage backend or a web dashboard reads `metadata/manifest.ts`'s
output; it doesn't need to understand `mirror/`'s internals at all.

## Data flow: a single `backup` run

```mermaid
sequenceDiagram
    participant U as User
    participant CLI as commands/backup.ts
    participant Lock as metadata/lock.ts
    participant GH as GitHub REST API
    participant Cache as .metadata/repositories.json
    participant Git as mirror/*.ts
    participant Tx as metadata/transaction.ts

    U->>CLI: gh-helix backup
    CLI->>CLI: loadConfig() + resolveToken()
    CLI->>Lock: acquireLock(backupDirectory)
    alt lock already held
        Lock-->>CLI: LockConflictError
        CLI-->>U: exit 4
    end
    CLI->>GH: discoverReposResilient()
    alt API reachable
        GH-->>CLI: repo list (paginated)
    else API unreachable
        CLI->>Cache: fall back to cached discovery
        Cache-->>CLI: repos, degraded=true
    end
    CLI->>CLI: filter (--include/--exclude), pLimit(maxParallel)
    par per repository
        CLI->>Git: clone or update mirror
        Git-->>CLI: ok / error
        CLI->>Git: fetch LFS (if FETCH_LFS)
        CLI->>Git: verifyMirror (fsck)
    end
    CLI->>Git: findOrphanDirs + moveToDeleted (if not degraded)
    CLI->>Tx: writeMetadataTransaction(manifest.json, last-run.json, repositories.json)
    Tx-->>CLI: committed atomically
    CLI->>Lock: release()
    CLI-->>U: summary + exit code
```

The three metadata files are written as **one transaction** deliberately — see
[Transaction Model](transaction-model.md) for why partial writes here would be worse than no
write at all.

## Backup lifecycle

```mermaid
flowchart LR
    A[Discover repos] --> B{Include/exclude filter}
    B -->|excluded| Z[skipped]
    B -->|included| C{Local mirror exists?}
    C -->|no| D[clone --mirror]
    C -->|yes, renamed| E[renameMirror<br/>transactional]
    C -->|yes, archived| F[skip - carry forward metadata]
    C -->|yes| G[remote update --prune]
    D --> H{FETCH_LFS?}
    E --> H
    G --> H
    H -->|yes| I[git lfs fetch --all]
    H -->|no| J[verifyMirror: fsck]
    I -->|failed| K[status: failed]
    I -->|ok| J
    J -->|failed| K
    J -->|ok| L[status: cloned/updated]
    K --> M[record in manifest]
    L --> M
    F --> M
    M --> N[orphan detection]
    N --> O[write manifest transaction]
```

Full narrative: [Backup Workflow](backup-workflow.md).

## Restore lifecycle

`restore` is the one command that never talks to GitHub — it reconstructs a working copy purely
from a local mirror, which is the entire point of a disaster-recovery tool: it must work when
GitHub itself is the thing that's down.

```mermaid
flowchart TD
    A[gh-helix restore repo] --> B{Local mirror exists?}
    B -->|no| X[error: run backup first, exit 4]
    B -->|yes| C{Staging + verified marker<br/>already present?}
    C -->|yes, resume| G[commit: rename staging to destination]
    C -->|no| D[clone mirror to staging<br/>GIT_LFS_SKIP_SMUDGE=1]
    D --> E{Repo uses LFS?}
    E -->|no| F[write verified marker]
    E -->|yes, git-lfs installed| E2[git lfs pull + verify no pointer files remain]
    E -->|yes, git-lfs missing| E3[RestoreLfsError, exit 1]
    E2 -->|ok| F
    E2 -->|failed| E3
    F --> G
    G --> H[remove marker, done]
```

Full narrative: [Restore Workflow](restore-workflow.md).

## Metadata lifecycle

```mermaid
flowchart LR
    subgraph Read
        R1[recoverPendingTransactions] --> R2{file exists?}
        R2 -->|no| R3[treat as empty - normal]
        R2 -->|yes, parses| R4[use it]
        R2 -->|yes, corrupt| R5[quarantine as .corrupt-timestamp<br/>+ warn, treat as empty]
    end
    subgraph Write
        W1[build content in memory] --> W2[fsync to temp files]
        W2 --> W3[fsync journal]
        W3 --> W4[fsync directory - best effort]
        W4 --> W5[rename each temp to final]
        W5 --> W6[delete journal]
    end
```

Every read path (`loadCache`, `loadManifest`, `loadLastRun`) calls `recoverPendingTransactions`
first, so a journal left behind by a crashed previous process is replayed (or discarded, if
corrupt) before anything else happens — see [Transaction Model](transaction-model.md).

## Lock acquisition flow

```mermaid
flowchart TD
    A[acquireLock] --> B["open(lockfile, 'wx')<br/>atomic create-exclusive"]
    B -->|success| C[start heartbeat timer]
    B -->|EEXIST| D[read existing lock]
    D --> E{unreadable, or --force-lock,<br/>or stale?}
    E -->|yes| F[force-remove lock file] --> B
    E -->|no| G[throw LockConflictError<br/>exit 4]
    C --> H[run command]
    H --> I[release: delete lock file<br/>if pid+hostname still match]
```

Staleness rule: a same-host lock is stale iff its PID is no longer running
(`process.kill(pid, 0)` → `ESRCH`); a lock written by a *different* host is stale once it's older
than 15 minutes, since PID liveness can't be checked across hosts. Full detail:
[Locking](locking.md).

## Repository discovery flow

```mermaid
flowchart TD
    A[discoverReposResilient] --> B[verifyApiAccess]
    B -->|ok| C{forceRefresh or<br/>cache older than 10 min?}
    C -->|no| D[return cached repos<br/>degraded=false]
    C -->|yes| E[paginate repos.listForOrg]
    E --> F[save cache] --> G[return live repos<br/>degraded=false]
    B -->|fails: network/auth| H[load cache regardless of age]
    H -->|cache non-empty| I[return cached repos<br/>degraded=true]
    H -->|cache empty| J[re-throw original error]
```

Full detail, including why orphan detection and `clean` behave differently under degraded mode:
[Repository Discovery](repository-discovery.md).

## Mirror synchronization flow (single repository)

```mermaid
flowchart LR
    A[repo from discovery] --> B{exists locally?}
    B -->|no| C["cloneMirror<br/>git clone --mirror"]
    B -->|yes| D["updateMirror<br/>git remote update --prune"]
    C --> E[buildGitAuthEnv:<br/>ephemeral Authorization header]
    D --> E
    E --> F[process exits, token never<br/>touches argv or .git/config]
```

Token injection uses Git's `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_n` / `GIT_CONFIG_VALUE_n`
environment-variable config-override mechanism to set `http.extraheader` to
`AUTHORIZATION: bearer <token>` for the lifetime of a single subprocess only — see
[Authentication](authentication.md#how-the-token-reaches-git).

## Failure recovery

Every stateful operation in gh-helix follows the same pattern: **stage, verify, commit** — never
"mutate in place" and never "delete before the replacement is confirmed."

| Operation | Staging area | Verification | Commit |
| --- | --- | --- | --- |
| Metadata write | `.tx-<uuid>.json` journal + per-file `.tmp-<id>` | journal itself is fsynced before any rename | rename each temp file into place, then delete journal |
| Orphan move / rename | `<dest>.staging` | `git fsck` (or structural compare) on the staged copy | rename staged copy to final destination |
| Restore | `<destination>.restoring` + `.verified` marker | LFS pointer scan on staged clone | rename staging to destination |
| Lock acquisition | N/A | PID liveness / hostname+age | atomic `open(..., 'wx')` |

Because every commit step is a single `rename()` (atomic within a directory on POSIX and
Windows), a process killed at any point before that rename leaves the *original* untouched, and a
process killed after it leaves the *result* complete. Re-running the same command is always
sufficient to finish or discard whatever was interrupted — there is deliberately no separate
`repair` or `fsck`-style command, because the normal command already does that job.

## See also

- [Locking](locking.md)
- [Transaction Model](transaction-model.md)
- [Metadata](metadata.md)
- [Repository Discovery](repository-discovery.md)
- [Backup Workflow](backup-workflow.md)
- [Restore Workflow](restore-workflow.md)
- [ADRs](adr/) for the reasoning behind each of these choices
