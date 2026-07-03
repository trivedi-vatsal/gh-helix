# CLI Reference

```
gh-helix <command> [options]
```

## Global options

Available on every command:

| Flag | Description | Default |
| --- | --- | --- |
| `-e, --env <path>` | Path to a `.env` file | `.env` in the current working directory |
| `-c, --config <path>` | Path to a `config.json` file | `config.json` in the current working directory |
| `-l, --log-file <path>` | Append all log output to this file (plain text, no ANSI colors) | none |

## Commands

### `backup`

Discovers every repository in the org and synchronizes local mirrors. Acquires the cross-process
lock. Full lifecycle: [Backup Workflow](backup-workflow.md).

```bash
gh-helix backup
gh-helix backup --dry-run
gh-helix backup --include "api-*" --exclude "*-archive"
gh-helix backup --report backup-report.json
gh-helix backup --retries 5
gh-helix backup --refresh
gh-helix backup --force-lock
```

| Flag | Description | Default |
| --- | --- | --- |
| `--dry-run` | Report what would happen; touches no mirror and writes no `.metadata/manifest.json` / `last-run.json` (a standalone `--report` file is still written if given) | off |
| `--include <patterns...>` | Only process repos matching one of these glob patterns (matched against both bare name and `owner/name`) | all repos |
| `--exclude <patterns...>` | Skip repos matching any of these glob patterns; exclude always wins over include | none |
| `--report <path>` | Also write a standalone copy of the manifest to this path | none |
| `--retries <n>` | Retry attempts for clone/update on transient failure (exponential backoff) | `3` |
| `--refresh` | Bypass the 10-minute discovery cache and re-query the GitHub API | off |
| `--force-lock` | Break an existing lock unconditionally instead of failing on conflict | off |

**Exit code**: `1` if any repository failed or discovery ran in degraded mode; `0` otherwise.

### `status`

Repository count, mirrored/missing/orphaned/archived counts, total disk usage (from cached
GitHub repo sizes, not a filesystem walk), last sync time, oldest/newest repository. Read-only;
does not acquire the lock.

```bash
gh-helix status
gh-helix status --refresh
```

| Flag | Description | Default |
| --- | --- | --- |
| `--refresh` | Bypass the discovery cache | off |

**Exit code**: `0` unless an unexpected error occurs.

### `verify`

Runs `git fsck --full` against every local mirror and reports failures, continuing past them.
Purely local — no GitHub API access. Acquires the lock (mutually exclusive with `backup`,
`restore`, `clean`, since it reads mirrors that those commands mutate).

```bash
gh-helix verify
gh-helix verify --force-lock
```

**Exit code**: `1` if any mirror failed verification; `0` otherwise (including when no mirrors
exist yet).

### `list`

Lists every repository in the organization with its local status: `cloned`, `missing`,
`archived`, or `orphan` (a local directory with no matching remote repository). Read-only; does
not acquire the lock.

By default, `list` uses discovery cache when it's still fresh. If you just changed token/org
permissions and output looks empty or outdated, run with `--refresh` to force a live API call.

```bash
gh-helix list
gh-helix list --refresh
```

**Exit code**: `0` unless an unexpected error occurs.

### `clean`

Moves local mirrors whose repository no longer exists on GitHub into `_deleted/`. Never deletes
anything outright. Refuses to act if discovery is degraded (stricter than `backup`, which merely
skips orphan detection in that case — see [Repository Discovery](repository-discovery.md#degraded-mode)).

```bash
gh-helix clean
gh-helix clean --dry-run
gh-helix clean --refresh
gh-helix clean --force-lock
```

| Flag | Description | Default |
| --- | --- | --- |
| `--dry-run` | Report what would be moved without moving it | off |
| `--refresh` | Bypass the discovery cache | off |
| `--force-lock` | Break an existing lock unconditionally | off |

**Exit code**: `1` if discovery is degraded (refuses to act); `0` otherwise, including after
successfully moving one or more orphans.

### `restore <repository>`

Clones a working copy from a **local mirror** — no GitHub access required. Rehydrates Git LFS
objects as part of the restore, or fails loudly rather than handing back pointer files. Full
lifecycle: [Restore Workflow](restore-workflow.md).

```bash
gh-helix restore my-repo
gh-helix restore my-repo --destination D:\Restore\my-repo
gh-helix restore my-repo --force-lock
```

| Flag | Description | Default |
| --- | --- | --- |
| `--destination <path>` | Where to write the working copy | `./<repository>` relative to the current directory |
| `--force-lock` | Break an existing lock unconditionally | off |

The destination may be a missing path or an existing *empty* directory — never an existing
non-empty one (`RestoreDestinationExistsError`).

**Exit code**: `1` if the mirror was restored but LFS objects couldn't be confirmed rehydrated;
`4` if no local mirror exists for the repository, or the destination already contains files;
`0` on a clean restore.

### `health`

Checks Git, Git LFS, authentication, API connectivity, disk permissions, the backup directory,
and available disk space, then prints a health report. Does not acquire the lock (safe to run
alongside anything else).

```bash
gh-helix health
```

**Exit code**: `1` if any check failed; `0` otherwise.

## Exit codes

Consistent across every command, designed to be schedule-friendly (cron, Task Scheduler, CI):

| Code | Name | Meaning |
| --- | --- | --- |
| `0` | Success | Clean run, no failures |
| `1` | PartialFailure | Completed, but one or more repos/checks failed, discovery ran in degraded mode, `clean` refused to act on stale data, or a `restore`'s LFS objects couldn't be confirmed rehydrated |
| `2` | AuthError | GitHub authentication or org access failed, and no cached discovery was available to fall back to |
| `3` | ConfigError | Invalid or missing configuration (`GITHUB_ORG`, `BACKUP_DIRECTORY`, malformed `config.json`, invalid `MAX_PARALLEL`/`FETCH_LFS`) |
| `4` | FatalError | Lock conflict, restore destination already exists / no local mirror found, or any other unexpected/fatal error |

See [Troubleshooting](troubleshooting.md) for what to do for each code.

## Concurrency & locking

`backup`, `restore`, `clean`, and `verify` each acquire an exclusive lock
(`.metadata/backup.lock`) over the backup directory and fail immediately — rather than hanging —
if another instance already holds it. Full detail: [Locking](locking.md).

```bash
gh-helix backup --force-lock
```
