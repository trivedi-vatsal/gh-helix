# Git LFS

How gh-helix handles Git LFS objects during backup and restore, and why a failed LFS fetch is
treated as seriously as it is.

## During backup

If `FETCH_LFS=true` (the default — see [Configuration](configuration.md#fetch_lfs)), every
clone/update is followed by `git lfs fetch --all` against the mirror, retried up to 2 attempts
(independent of the `--retries` flag, which governs the clone/update step itself).

### Why a failed LFS fetch is a backup failure

Most tools would log an LFS failure as a warning and report the backup as otherwise successful.
gh-helix does not: **a failed LFS fetch sets that repository's manifest `status` to `failed`**,
the same as a failed clone. The reasoning, verbatim from the source comment: *"A 'successful'
backup that's missing LFS objects is not actually disaster-recoverable, so this counts as a real
failure, not a warning."*

A mirror with a working Git history but missing LFS blobs looks fine at a glance — `git fsck`
still passes, because LFS objects aren't part of Git's own object graph — but restoring it would
hand back a working copy full of tiny pointer files instead of the actual binary content. Since
the entire purpose of this tool is disaster recovery, that's not an acceptable definition of
"backed up." See [Disaster Recovery: what "recoverable" actually means](disaster-recovery.md#what-recoverable-actually-means-here).

If you're certain no repository in your org uses LFS, set `FETCH_LFS=false` to skip this step —
`lfsFetched` is then recorded as `null` in the manifest (distinct from `false`, which means it
was attempted and failed) to make that distinction visible.

## During restore

`gh-helix restore` rehydrates LFS objects from the mirror's own local LFS storage — no network
access required. See [Restore Workflow: clone and verify LFS](restore-workflow.md#5-clone-and-verify-lfs)
for the full step-by-step.

Summary of the verification gh-helix performs, which most restore tooling skips:

1. Clone with `GIT_LFS_SKIP_SMUDGE=1` so a missing object doesn't abort the whole clone.
2. If `git-lfs` isn't installed: scan the working tree (including nested directories) for any
   `.gitattributes` referencing `filter=lfs`. If found, fail loudly (`RestoreLfsError`) rather
   than silently handing back a checkout full of pointer files.
3. If `git-lfs` is installed: `git lfs pull`, then explicitly check every LFS-tracked file's
   first 200 bytes for the LFS pointer signature (`version https://git-lfs.github.com/spec/v1`).
   Any file still showing that signature after `lfs pull` means it wasn't actually rehydrated —
   this is caught and reported by name (up to 5, plus a count of any more), not silently accepted.

This matters because a Git LFS pointer file *is* valid UTF-8 text and *is* a file that exists — a
naive restore that only checks "did the clone succeed" would report success while quietly handing
back non-functional data.

## Installing Git LFS

```bash
# Windows (winget)
winget install GitHub.GitLFS

# macOS (Homebrew)
brew install git-lfs

# Debian/Ubuntu
sudo apt-get install git-lfs
```

Then, once per machine:

```bash
git lfs install
```

Confirm with:

```bash
git lfs version
gh-helix health
```

`health` reports Git LFS as `fail` if it's missing from `PATH` *and* `FETCH_LFS=true`; otherwise
just a `warn`.

## Disk usage note

`git lfs fetch --all` downloads every LFS object across every ref, not just the default branch —
this is deliberate (a true mirror preserves every branch's content), but it means LFS-heavy
repositories with many long-lived branches can be significantly larger to mirror than their
GitHub-reported size suggests, since `sizeKb` (used by `status`) reflects GitHub's own repository
size metric.

## See also

- [Backup Workflow](backup-workflow.md)
- [Restore Workflow](restore-workflow.md)
- [Disaster Recovery](disaster-recovery.md)
- [ADR-0006: LFS verification](adr/0006-lfs-verification.md)
- [Troubleshooting: LFS errors](troubleshooting.md#lfs-errors)
