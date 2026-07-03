# Backup Workflow

This is the full lifecycle of `gh-helix backup`, in the order it actually executes
(`src/commands/backup.ts`). For the high-level diagram, see
[Architecture: Backup lifecycle](architecture.md#backup-lifecycle).

## 1. Setup

1. Load configuration ([Configuration](configuration.md)) and resolve `--retries` (default `3`).
2. Resolve a GitHub token ([Authentication](authentication.md)) and construct the Octokit client.
3. Ensure `BACKUP_DIRECTORY` exists.

## 2. Acquire the lock

Everything from here on runs inside `withLock(backupDirectory, ...)`. If another `backup`,
`restore`, `clean`, or `verify` is already running against the same directory, this fails
immediately with `LockConflictError` (exit `4`) unless `--force-lock` is given. See
[Locking](locking.md).

## 3. Discover repositories

`discoverReposResilient` is called with `persistCache: false` — a `backup` run never writes the
discovery cache by itself. Instead, if discovery succeeded live (not degraded) and this isn't a
dry run, the cache write is folded into the single metadata transaction at the end of the run
(step 8), so `repositories.json`, `manifest.json`, and `last-run.json` always advance together.
See [Repository Discovery](repository-discovery.md) and [Transaction Model](transaction-model.md).

If the API is unreachable, this falls back to the last cached discovery (`degraded: true`) rather
than aborting — see [Repository Discovery: degraded mode](repository-discovery.md#degraded-mode).

## 4. Filter

`--include`/`--exclude` glob patterns are applied against both the bare repository name and
`owner/name`. `--exclude` always wins over `--include` when both match the same repository.

## 5. Process repositories in parallel

A worker pool (`p-limit`, sized by `MAX_PARALLEL`, default `5`) processes every filtered
repository concurrently. For each repository:

1. **Compute the expected local directory**: `<name>.git`.
2. **Rename detection**: the repository's previous cache entry is looked up by its *stable
   GitHub ID* (not name). If the expected local directory differs from what's cached, and the new
   path doesn't already exist, this is a rename:
   - `--dry-run`: logs "Would rename" and stops there.
   - Real run: `renameMirror` (transactional — see [Transaction Model](transaction-model.md#transactional-rename)) updates the `origin` URL, verifies it's reachable, then moves the directory. A rename failure is logged as an error but doesn't abort the whole run — the repository is still attempted as a clone/update against its new expected path.
3. **Archived + already present locally**: skipped (`status: skipped-archived`) — archived repos
   can't change, so re-fetching one that's already mirrored is pointless. Its previous
   `lfsFetched`/`lastFetchedAt`/`lastCommitSha` are carried forward into the new manifest entry.
4. **Dry run**: logs `would-clone` or `would-update` (depending on whether a local mirror
   already exists) and carries forward previous fetch metadata, without touching disk.
5. **Real clone or update**, wrapped in `retry()` (exponential backoff, `--retries` attempts):
   - New mirror: `git clone --mirror <url> <dest>` — see [Mirror synchronization](architecture.md#mirror-synchronization-flow-single-repository).
   - Existing mirror: `git remote update --prune`.
   - If `FETCH_LFS=true` (default): `git lfs fetch --all`, retried up to 2 attempts (independent of `--retries`). **A failed LFS fetch marks the repository `failed`, not a warning** — see [Git LFS](lfs.md#why-a-failed-lfs-fetch-is-a-backup-failure).
   - `verifyMirror`: confirms the `origin` remote is set and runs `git fsck --full`.
   - Any failure at any of these steps → `status: failed`, with the error recorded; previous fetch metadata is preserved (not overwritten with nulls) so a manifest entry never regresses to "no data" just because one run failed.
   - All steps succeed → `status: cloned` or `status: updated`.

## 6. Orphan detection

Only runs when discovery was **not** degraded — acting on stale data to decide what's "no longer
on GitHub" is a real correctness risk (a repo that's actually still there could be moved into
`_deleted/`), not just a convenience tradeoff. See
[Repository Discovery: degraded mode](repository-discovery.md#degraded-mode).

- `--dry-run`: logs what would be moved.
- Real run: `moveToDeleted` relocates each orphaned local directory into `_deleted/<name>.git`
  (timestamp-suffixed on collision) using the same staged, verified, safe-move machinery used by
  rename — see [Architecture: Failure recovery](architecture.md#failure-recovery).

## 7. Build the manifest

A `BackupManifest` is assembled: org, timestamp, total/cloned/updated/failed/archived/skipped
counts, elapsed time, `dryRun`, `discoveryDegraded`, and the full per-repository detail array.
Full field reference: [Metadata](metadata.md#manifestjson).

## 8. Write metadata (transactionally)

`writeManifest` writes `.metadata/manifest.json` and `.metadata/last-run.json` — and, when
discovery was live and this isn't a dry run, the repository cache too — as **one** atomic,
journaled transaction. Dry runs pass `canonical: false`: no tracked state changes at all, though
`--report <path>` (if given) is still written as a standalone file regardless of dry-run status.
See [Transaction Model](transaction-model.md).

## 9. Summary and exit

Prints a "Backup Summary" (or "Backup Summary (dry run)") with per-status counts and a yellow
"Discovery: degraded (...)" line when applicable.

**Exit code**: `1` (`PartialFailure`) if `manifest.failed > 0` or `manifest.discoveryDegraded`;
`0` otherwise.

## Idempotency

Running `backup` repeatedly is always safe and cheap after the first run:

- Already-mirrored, unchanged repositories just run `git remote update --prune`, which is a
  no-op fetch if nothing changed upstream.
- Rename detection is keyed on the repository's stable GitHub ID, not its name, so a rename is
  detected and handled correctly even across many intervening runs.
- Nothing is ever deleted outright — a repository gone from GitHub only ever gets *moved* into
  `_deleted/`, and only when discovery is confidently live.

## See also

- [Architecture: Backup lifecycle diagram](architecture.md#backup-lifecycle)
- [Restore Workflow](restore-workflow.md)
- [Disaster Recovery](disaster-recovery.md)
- [Troubleshooting](troubleshooting.md)
