# 0005. Safe (staged, verified) directory moves instead of copy-then-delete

## Status

Accepted

## Context

Two operations physically relocate a mirror directory: moving an orphaned mirror into
`_deleted/` and renaming a mirror to match a renamed repository. The naive implementation of
"move a directory" — copy the contents to the new location, then delete the original — has a
well-known failure mode: if the process is interrupted (killed, crashes, loses power) between the
copy completing and the delete happening, or worse, mid-copy, the result can be a corrupted or
partial copy at the destination *and* the original already partially or fully deleted, with no
way to tell which state you're in without manual inspection.

For a tool whose entire purpose is not losing repository data, this failure mode is unacceptable
— especially since directory moves in gh-helix are common operations (every rename, every orphan
cleanup), not rare edge cases.

## Decision

All directory relocation goes through `safeMoveDirectory`, a stage-verify-commit algorithm:

1. Attempt an atomic same-volume `rename()` first (the fast path — nothing to verify, since a
   rename is lossless by construction).
2. If that fails with `EXDEV` (cross-device), fall back to a recursive copy into a `.staging`
   sibling of the destination.
3. **Only** when the copy fallback was used, run a verifier against the staged copy (either a
   domain-specific one, like `git fsck` for mirrors, or a structural file-count/byte-size
   comparison as the default) before proceeding.
4. Write a `.verified` marker file once verification passes.
5. Commit with a single atomic `rename(staging, destination)`.
6. Only *then* attempt to remove the original source — and if that removal fails, leave both
   copies in place rather than losing anything (`staleSourceRemaining`, logged as a warning, not
   an error).

Full mechanics: [Architecture: Failure recovery](../architecture.md#failure-recovery).

## Alternatives considered

- **Copy-then-delete.** Rejected outright — this is the exact failure mode described in Context.
- **Delete-then-copy** (remove the original first, to "reserve" the destination). Rejected — 
  strictly worse: any failure during the copy now means the data is already gone with nothing to
  recover from.
- **Rely on `git mirror` re-clone as the recovery mechanism** instead of a verified move (i.e.,
  if a move fails, just re-clone from GitHub). Rejected as the primary mechanism: it would make
  local moves depend on GitHub being reachable (in tension with
  [ADR-0002](0002-mirror-first-architecture.md)), and would silently discard `_deleted/` history
  for repositories that no longer exist on GitHub — which is the entire point of moving orphans
  there instead of deleting them.

## Consequences

- Every relocation is resumable: the source is never touched until the destination is fully
  verified and committed, so a process killed at any point — before, during, or after the copy —
  leaves the tool in a state where re-running the same command (`backup`, `clean`) makes forward
  progress automatically.
- The same machinery is reused for both orphan moves and transactional renames
  (`createMirrorMoveVerifier`, which is `git fsck` plus an origin-remote check), avoiding two
  separate, inconsistently-safe implementations. See [ADR-0006](0006-lfs-verification.md) for a
  related decision about verification depth.
- The fast path (same-volume atomic rename) means most real-world moves — `BACKUP_DIRECTORY` and
  its `_deleted/` subfolder are normally on the same volume — pay none of the copy/verify
  overhead; the safety mechanism only activates when it's actually needed (cross-device moves).

## Tradeoffs

The verified-copy fallback path is slower and uses more temporary disk space (source and staged
copy coexist until commit) than a naive copy-then-delete. This is accepted because the fallback
path is the uncommon case (same-volume rename is the default), and because the alternative —
losing repository data on an interrupted cross-volume move — is precisely what this tool exists
to prevent.
