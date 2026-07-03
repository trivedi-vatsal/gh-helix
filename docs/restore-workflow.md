# Restore Workflow

`gh-helix restore <repository>` reconstructs a working clone from a **local mirror only**. It is
the one command that never talks to GitHub — no token is resolved, no API call is made — because
the entire point of a disaster-recovery tool is that it must work when GitHub itself is
unreachable. For the diagram, see
[Architecture: Restore lifecycle](architecture.md#restore-lifecycle).

## 1. Setup and lock

Load configuration, acquire the cross-process lock over `BACKUP_DIRECTORY` (fails fast with
`LockConflictError`, exit `4`, unless `--force-lock`). See [Locking](locking.md).

## 2. Locate the mirror

`mirrorPath = <BACKUP_DIRECTORY>/<repository>.git`. If it doesn't exist, the command exits
immediately with exit code `4` and the message *"No local mirror found... Run 'backup' first."*
— there's nothing to restore from.

## 3. Validate the destination

`--destination` defaults to `./<repository>` relative to the current directory. The destination
may be a **missing path or an existing empty directory** — never an existing non-empty one. A
non-empty destination throws `RestoreDestinationExistsError` (exit `4`) rather than silently
merging into or overwriting whatever's there.

## 4. Resume check

The clone and LFS verification happen in a staging directory beside the destination
(`<destination>.restoring`), committed only once fully verified. If a prior `restore` invocation
was killed mid-operation, running `restore` again finds the staging directory *and* its verified
marker file already present, and skips straight to committing — no re-clone, no manual cleanup
required.

## 5. Clone and verify LFS

If not resuming, any stale (unverified) staging leftovers are discarded, then:

1. Clone the mirror into staging with `GIT_LFS_SKIP_SMUDGE=1` — this prevents a missing LFS
   object from aborting the whole clone outright; LFS is verified as a distinct, explicit step
   next.
2. **If `git-lfs` isn't installed**: recursively scan the working tree for any `.gitattributes`
   (not just the root — nested LFS configuration is checked too) containing `filter=lfs`.
   - Found → `RestoreLfsError` (LFS objects are needed but the tool to fetch them isn't present).
   - Not found → success; this repository simply doesn't use LFS.
3. **If `git-lfs` is installed**: run `git lfs pull`, then `git lfs ls-files --name-only` to
   enumerate LFS-tracked files. If none, success (no LFS objects to restore). Otherwise, inspect
   the first 200 bytes of every tracked file for the LFS pointer signature
   (`version https://git-lfs.github.com/spec/v1`) — any file still showing that signature means
   its real content wasn't rehydrated. If any remain, `RestoreLfsError`, listing up to 5 affected
   filenames plus a count of any more.
4. On success, write the verified marker file recording whether LFS was restored.

See [Git LFS](lfs.md) for why pointer-file detection matters — a silent pointer file looks like a
tiny text file, not a missing binary, so it has to be checked explicitly rather than trusted by
absence of an error.

## 6. Commit

`rename(staging, destination)` — a single atomic move — then the marker file is removed. If the
destination path already existed as an empty directory, it's removed first (its emptiness was
already confirmed in step 3).

## 7. Result

- **Success** (exit `0`): logs whether LFS objects were rehydrated as part of the restore.
- **LFS not confirmed** (exit `1`, `RestoreLfsError`): the partially-restored working copy is
  deliberately left in place (in staging, not committed to the destination) so a retry resumes
  from there rather than starting over.
- **No mirror / bad destination** (exit `4`).

## Restoring at scale

- **A single repository**: `gh-helix restore my-repo` — see
  [examples/restore-single-repository](../examples/restore-single-repository/).
- **An entire organization**: there's no built-in "restore all" command; script a loop over
  `gh-helix list` output — see
  [examples/restore-entire-organization](../examples/restore-entire-organization/).
- **Fully offline** (no network at all): works as long as the mirrors and the gh-helix binary are
  present — see [examples/offline-restore](../examples/offline-restore/).

## See also

- [Disaster Recovery](disaster-recovery.md) — runbooks that use `restore` as a building block
- [Git LFS](lfs.md)
- [Locking](locking.md)
- [Troubleshooting](troubleshooting.md)
