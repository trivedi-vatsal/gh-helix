# Metadata

Everything gh-helix knows beyond the mirrors themselves lives under `BACKUP_DIRECTORY/.metadata/`:

```
.metadata/
    repositories.json   # discovery cache + rename tracking, keyed by stable GitHub repo ID
    manifest.json        # full detail of the most recent backup run
    last-run.json         # lightweight summary (manifest.json minus the repositories[] array)
    backup.lock             # present only while a command is actively running
```

These are plain, versioned JSON files by design — see
[ADR-0009: Direct GitHub REST API usage](adr/0009-github-api.md) and
[Architecture: Extension points](../README.md#extension-points): a web dashboard, Prometheus
exporter, or SQLite-backed store can all be built by reading these files without touching
gh-helix's internals.

## `repositories.json`

The repository discovery cache. Structure:

```json
{
  "fetchedAt": "2026-07-03T12:00:00.000Z",
  "repos": {
    "123456789": {
      "id": "123456789",
      "name": "my-repo",
      "nameWithOwner": "my-org/my-repo",
      "sshUrl": "git@github.com:my-org/my-repo.git",
      "cloneUrl": "https://github.com/my-org/my-repo.git",
      "htmlUrl": "https://github.com/my-org/my-repo",
      "isArchived": false,
      "isFork": false,
      "isDisabled": false,
      "createdAt": "2020-01-01T00:00:00Z",
      "updatedAt": "2026-06-30T00:00:00Z",
      "pushedAt": "2026-06-30T00:00:00Z",
      "defaultBranch": "main",
      "sizeKb": 4096,
      "localDir": "my-repo.git"
    }
  }
}
```

**Keyed by the repository's stable GitHub ID**, not its name — this is the entire mechanism
behind rename detection: if `my-repo`'s ID is unchanged but GitHub now reports its name as
`my-repo-renamed`, the cache entry's `localDir` (`my-repo.git`) no longer matches the freshly
computed expected directory (`my-repo-renamed.git`), and `backup` treats that as a rename rather
than a new repository. See [Repository Discovery](repository-discovery.md).

Freshness: a cache is considered fresh for 10 minutes (`DEFAULT_CACHE_TTL_MS`) from `fetchedAt`;
`--refresh` bypasses this. In degraded mode (API unreachable), *any* cache age is used — see
[Repository Discovery: degraded mode](repository-discovery.md#degraded-mode).

**Legacy migration**: if a `.backup-state.json` file (from the earlier `gh-org-backup` 1.x tool)
is found and no new-style cache exists yet, it's migrated into this format automatically on the
first command run, with safe defaults filled in for fields the old format didn't track.

## `manifest.json`

The full detail of the most recent `backup` run.

```json
{
  "organization": "my-org",
  "timestamp": "2026-07-03T12:00:00.000Z",
  "totalRepositories": 240,
  "cloned": 2,
  "updated": 235,
  "failed": 1,
  "archived": 12,
  "skipped": 0,
  "elapsedTimeMs": 184213,
  "dryRun": false,
  "discoveryDegraded": false,
  "repositories": [
    {
      "name": "my-repo",
      "defaultBranch": "main",
      "archived": false,
      "mirrorPath": "D:/GitHubBackups/my-repo.git",
      "sizeKb": 4096,
      "lastFetchedAt": "2026-07-03T12:00:00.000Z",
      "lastCommitSha": "a1b2c3d4e5f6...",
      "status": "updated",
      "lfsFetched": true
    }
  ]
}
```

`RepoStatus` values: `cloned`, `updated`, `skipped-archived`, `would-clone`, `would-update`,
`failed`. (`skipped-filtered` is a reserved value in the type for repositories excluded by
`--include`/`--exclude`; filtered repositories are currently counted in the summary rather than
materialized as individual manifest entries — see
[ADR-0010: Project structure](adr/0010-project-structure.md) for related type/behavior notes.)

`lfsFetched: null` specifically means LFS fetching was disabled (`FETCH_LFS=false`) for that run
— distinct from `false`, which means it was attempted and failed.

`renamedFrom` is present on an entry only when that repository was detected as a rename during
this run.

**Never written on a dry run** — `backup --dry-run` passes `canonical: false` to `writeManifest`,
so `.metadata/manifest.json` and `last-run.json` are untouched. Use `--report <path>` if you want
dry-run output captured to a file.

## `last-run.json`

`Omit<BackupManifest, 'repositories'>` — the same summary fields as `manifest.json` without the
per-repository array. This is what `status` reads for "Failed count (last run)" and "Last sync",
so it stays cheap to read even on orgs with thousands of repositories.

## `backup.lock`

```json
{ "pid": 12345, "hostname": "backup-host-01", "timestamp": "2026-07-03T12:00:00.000Z", "command": "backup" }
```

Present only while `backup`, `restore`, `clean`, or `verify` is actively running. Full mechanics:
[Locking](locking.md).

## Durability and corruption handling

Every metadata file is written atomically (temp file, fsynced, then renamed into place — never
edited in place), and reads follow one consistent rule: **missing is normal, corrupt is not**.

- **Missing file** → treated as empty/absent silently. This is the normal state on a first run.
- **File exists but fails to parse** → quarantined by renaming it to
  `<name>.<ext>.corrupt-<ISO-timestamp>` (colons/dots replaced with `-`) alongside a logged
  warning, then treated as absent so the command can proceed. The bad data is never silently
  discarded — it's preserved next to the working file for inspection, and the warning ensures a
  scheduled run surfaces the condition instead of quietly resetting state.

`repositories.json`, `manifest.json`, and `last-run.json` are written together as a single
journaled transaction at the end of a `backup` run — see [Transaction Model](transaction-model.md)
for why, and how a crash mid-write is recovered automatically on the next command invocation.

## Reading metadata programmatically

These files are stable, versioned JSON and safe to read directly from another process (a
dashboard, a metrics exporter, an alerting script) — just don't write to them from outside
gh-helix, since that would bypass the transaction/locking guarantees. See
[Architecture: Extension points](../README.md#extension-points).

## See also

- [Locking](locking.md)
- [Transaction Model](transaction-model.md)
- [Repository Discovery](repository-discovery.md)
- [Backup Workflow](backup-workflow.md)
