# 0004. Cross-process locking via atomic lock-file creation

## Status

Accepted

## Context

`backup`, `restore`, `clean`, and `verify` all mutate or read mirrors under `BACKUP_DIRECTORY` in
ways that are unsafe to run concurrently against the same repository — e.g., `backup` cloning
into a directory `clean` is simultaneously relocating, or two `backup` runs both writing
`manifest.json`. gh-helix is designed to be invoked by external schedulers (cron, Task Scheduler,
CI) where overlapping invocations are a realistic operator mistake (a long-running backup still
executing when the next scheduled run fires), not just a theoretical concern.

## Decision

An exclusive lock file (`.metadata/backup.lock`) is acquired via `open(file, 'wx')` — an atomic,
create-exclusive filesystem operation — before any of the four commands above touches a mirror.
Acquisition fails immediately (no blocking/waiting) if the file already exists and the existing
lock isn't stale or force-broken. Full mechanics: [Locking](../locking.md).

## Alternatives considered

- **Advisory OS-level file locks (`flock`/`LockFileEx`).** Rejected primarily for portability:
  behavior and availability differ meaningfully between POSIX `flock` and Windows locking APIs,
  and gh-helix targets both as first-class platforms (see the CI matrix in
  [Testing](../testing.md#ci-matrix)). An atomic-create lock file is a plain filesystem
  primitive with consistent semantics on both.
- **A lock server / external coordination service** (e.g. a database row, a Redis key). Rejected
  as disproportionate — gh-helix has no other infrastructure dependency, and introducing one
  solely for locking would work against the tool's install-from-source, dependency-light design
  (see [Security: Dependencies](../security.md#dependencies)).
- **Blocking/waiting for the lock instead of failing fast.** Rejected — see the "fail fast, never
  block" design note in [Locking](../locking.md#design-note-fail-fast-never-block): a CLI meant
  for schedulers should surface a conflict immediately rather than silently queuing, which could
  mask a genuinely stuck previous run.

## Consequences

- Lock conflicts are visible and actionable immediately (exit code 4, with pid/hostname/command
  of the holder shown) rather than causing silent corruption or a hung process.
- Because there's no central lock server, staleness has to be inferred locally: same-host
  liveness via PID check, cross-host via a time-to-live. This is inherently heuristic for the
  cross-host case (a 15-minute TTL, not a guarantee) — see
  [Locking: Staleness rules](../locking.md#staleness-rules) — and `--force-lock` exists as an
  explicit escape hatch for operators who know better than the heuristic.
- `status`, `list`, and `health` deliberately don't acquire the lock, since they're read-only and
  safe to run alongside a mutating command — this keeps the lock's scope limited to where it's
  actually needed.

## Tradeoffs

A local, heuristic staleness model is weaker than a coordination service with real distributed
consensus, but appropriate for gh-helix's actual deployment shape (typically one host, or a small
number of hosts sharing a network volume) and avoids taking on an infrastructure dependency for a
problem this scale of tool doesn't need one to solve.
