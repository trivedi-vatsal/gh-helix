# Disaster Recovery

This is the runbook document — what to actually do when GitHub, a repository, or the backup host
itself is gone. Everything here composes the primitives documented elsewhere
([Backup Workflow](backup-workflow.md), [Restore Workflow](restore-workflow.md)).

## Threat model

gh-helix is designed against these specific failure scenarios:

| Scenario | What's lost | What still works |
| --- | --- | --- |
| A repository is accidentally deleted on GitHub | The remote repository | Its mirror is intact under `BACKUP_DIRECTORY`; `restore` reconstructs a working copy entirely offline |
| GitHub has an outage | API + Git access to GitHub | `backup` continues Git-level maintenance of mirrors already known (degraded mode); `restore`, `verify`, `status`/`list` (from cache) all work fully offline |
| The backup host is lost (disk failure, VM deleted) | Every mirror | Recoverable only if `BACKUP_DIRECTORY` itself was backed up/replicated at the infrastructure level — see [Protecting the backup host](#protecting-the-backup-host) below |
| A mirror is silently corrupted | One mirror's integrity | `verify` (`git fsck`) catches this on a schedule, before you need the mirror |
| A process is killed mid-operation (power loss, OOM kill, `SIGKILL`) | Nothing — every stateful operation is stage/verify/commit | Re-running the same command finishes or discards the interrupted operation automatically; see [Architecture: Failure recovery](architecture.md#failure-recovery) |

gh-helix's mirrors are the disaster-recovery copy. gh-helix does not replicate `BACKUP_DIRECTORY`
to another host or to object storage itself — that's the operator's responsibility (see below),
and a deliberately unimplemented seam (see [Roadmap](roadmap.md)).

## Runbook: restore a single deleted repository

```bash
gh-helix restore <repo-name> --destination ./restored/<repo-name>
```

Push the restored working copy to a newly created (empty) repository on GitHub to fully recover
it there, or just use the working copy locally. See
[examples/restore-single-repository](../examples/restore-single-repository/).

## Runbook: recover an entire organization onto a new GitHub org

1. Confirm mirror integrity first: `gh-helix verify`.
2. Create the destination org (or use an existing empty one).
3. For each mirror, `gh-helix restore <repo> --destination ./restore/<repo>`, then push the
   working copy to the new org's matching (empty) repository.

See [examples/restore-entire-organization](../examples/restore-entire-organization/) for a
scripted version of this loop.

## Runbook: GitHub is down, but I need to keep mirrors current

Nothing to do — this is the default behavior. `discoverReposResilient` automatically falls back
to the last cached repository list (`degraded: true`) and `backup` continues fetching every
already-known mirror. Orphan detection is skipped in this mode (see
[Repository Discovery: degraded mode](repository-discovery.md#degraded-mode)) since it would be
unsafe to decide "no longer exists" from stale data. The run exits `1` and the manifest records
`discoveryDegraded: true` so a scheduled run surfaces the condition instead of silently reporting
success.

## Runbook: the backup host itself is gone

This is the one scenario gh-helix cannot recover from on its own — if `BACKUP_DIRECTORY` and
everything in it is gone, so are the mirrors. Mitigations, in order of robustness:

1. **Replicate `BACKUP_DIRECTORY` at the infrastructure level** — periodic snapshot of the
   volume/disk, or sync to object storage (rclone, `aws s3 sync`, `az storage blob sync`, etc.)
   as a step *after* `gh-helix backup` completes in your scheduled job. See
   [examples/scheduled-backup](../examples/scheduled-backup/).
2. **Run gh-helix against multiple hosts/regions** independently, each with its own
   `BACKUP_DIRECTORY` — since gh-helix is idempotent and stateless beyond its own metadata
   directory, running it identically against a second location is a valid redundancy strategy.
3. Native cloud storage backends (S3/Azure Blob) as a first-class gh-helix feature are an
   intentional extension point, not yet implemented — see
   [Architecture: Extension points](../README.md#extension-points) and
   [Roadmap](roadmap.md).

## Runbook: a mirror fails `verify`

```bash
gh-helix verify
```

reports which mirrors failed `git fsck`. A corrupted mirror is *not* automatically re-cloned —
investigate first (disk corruption on the host is the most common cause and may affect other
mirrors too), then, if you decide a clean re-clone is the right fix, remove that mirror's
directory manually and re-run `gh-helix backup` to reclone it fresh.

## What "recoverable" actually means here

A repository counts as truly disaster-recoverable by gh-helix's own bar only if:

1. Its mirror's most recent `backup` run has `status: cloned` or `status: updated` (not
   `failed`) in `.metadata/manifest.json`.
2. If it uses LFS, `lfsFetched: true` in that same entry — LFS fetch failures are recorded as a
   real backup failure, not a warning, specifically so this bar is meaningful. See
   [Git LFS](lfs.md#why-a-failed-lfs-fetch-is-a-backup-failure).
3. `gh-helix verify` passes for it.

`gh-helix status` and `.metadata/last-run.json` give you the fleet-wide view of this; script
against `.metadata/manifest.json` directly if you need per-repository detail in an alerting
pipeline.

## Protecting the backup host

Beyond gh-helix's own guarantees, minimum recommended practices for the host running scheduled
backups:

- Store `BACKUP_DIRECTORY` on redundant storage (RAID, cloud-managed disk with replication).
- Snapshot or sync it off-host on a schedule independent of the gh-helix run itself.
- Monitor `gh-helix status` / exit codes from your scheduler (see
  [examples/scheduled-backup](../examples/scheduled-backup/)) so a failing backup is noticed
  before a disaster makes it matter.

## See also

- [Backup Workflow](backup-workflow.md)
- [Restore Workflow](restore-workflow.md)
- [Repository Discovery: degraded mode](repository-discovery.md#degraded-mode)
- [Troubleshooting](troubleshooting.md)
