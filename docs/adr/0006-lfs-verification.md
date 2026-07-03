# 0006. Treat LFS fetch/restore failures as real failures, not warnings

## Status

Accepted

## Context

Git LFS stores large file content outside of Git's own object graph — a repository with LFS
enabled still has a fully valid Git history (and passes `git fsck`) even if none of its LFS
objects were ever fetched; what's present instead are small pointer files. This means a backup
tool that only checks "did the clone succeed" and "does `git fsck` pass" can report a repository
as successfully backed up while silently missing all of its actual binary content — and the
inverse failure mode exists on restore: a working copy can be produced, look complete (every file
is present), and still be non-functional because LFS-tracked files are pointer text instead of
their real content.

## Decision

Two related rules:

1. **Backup**: if `FETCH_LFS=true` and `git lfs fetch --all` fails for a repository, that
   repository's manifest `status` is set to `failed` — the same severity as a failed clone — not
   logged as a warning alongside an otherwise-successful `cloned`/`updated` status.
2. **Restore**: after cloning, gh-helix explicitly verifies that every LFS-tracked file's content
   was actually rehydrated (inspecting the first 200 bytes of each for the LFS pointer file
   signature) rather than trusting that `git lfs pull` returning success means the data is really
   there. Any file still showing pointer content fails the restore (`RestoreLfsError`) rather than
   handing back a working copy that looks complete but isn't.

Full detail: [Git LFS](../lfs.md).

## Alternatives considered

- **Log LFS failures as warnings, report the backup as otherwise successful.** This is the
  behavior most tools default to, and was explicitly rejected — see the source comment quoted in
  [Git LFS: Why a failed LFS fetch is a backup failure](../lfs.md#why-a-failed-lfs-fetch-is-a-backup-failure).
  A "successful" backup missing LFS objects fails the tool's own stated purpose
  (disaster-recoverability) silently.
- **Trust `git lfs pull`'s own exit code as sufficient restore verification.** Rejected — pointer
  files remaining after a nominally successful `lfs pull` is a real, observed Git LFS failure
  mode (e.g. objects that were never actually fetched into the mirror in the first place), and an
  exit-code-only check would miss it entirely.

## Consequences

- A `backup` run's exit code and manifest more accurately reflect true recoverability, at the
  cost of a stricter, more "pessimistic" definition of success than an LFS-unaware tool would
  report — an org with LFS reliability issues will see more `failed` entries than it might expect
  from a coarser tool, which is intentional, not a bug to be tuned away.
- `restore` fails loudly and specifically (naming the affected files) instead of succeeding with
  silently broken output — better for an operator relying on the restored copy under pressure
  during an actual incident.
- `FETCH_LFS=false` remains available as an explicit, visible opt-out (recorded as
  `lfsFetched: null` in the manifest, distinct from `false`) for orgs that are certain LFS isn't
  in use, or that back up LFS storage through a separate path.

## Tradeoffs

This trades a stricter (some would say noisier) failure signal for an honest one. The alternative
— quieter reporting that undercounts real risk — was judged worse for a tool whose specific job
is disaster recovery, where a false "success" is far more costly than a true "failure" that
prompts investigation.
