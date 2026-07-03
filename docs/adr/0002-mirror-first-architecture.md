# 0002. Mirror-first architecture: local mirrors are the source of truth for recovery

## Status

Accepted

## Context

A disaster-recovery tool has to define, precisely, what it means to have "recovered." Two broad
architectural shapes were possible:

1. **Mirror-first**: maintain complete local mirrors continuously; recovery reads only from
   those mirrors, never from GitHub.
2. **On-demand/GitHub-first**: keep lighter local state (or none) and reconstruct repositories by
   talking to the GitHub API at restore time, using local mirrors only as a cache/optimization.

## Decision

gh-helix is mirror-first. `restore` reads **exclusively** from a local mirror under
`BACKUP_DIRECTORY` and makes zero GitHub API or network calls. `backup` is the only command that
talks to GitHub; every other mutating command (`restore`, `clean`, `verify`) and every read-only
command except `status`/`list` operates purely on local state (`clean` and `status`/`list` do
consult live discovery, but only to *decide what to do*, not as part of the recovery path itself).

## Alternatives considered

- **GitHub-first recovery** (re-clone from GitHub at restore time, using the local mirror only as
  a fallback). Rejected: this makes "recovered" dependent on GitHub being reachable at exactly
  the moment you need to recover — which is precisely the scenario a disaster-recovery tool has
  to handle. See [Disaster Recovery: Threat model](../disaster-recovery.md#threat-model).
- **Hybrid**: prefer GitHub if reachable, fall back to the mirror. Rejected for `restore`
  specifically — a tool whose recovery path *sometimes* depends on the thing that might be down
  is harder to reason about and test than one that never does. (Note this hybrid pattern *is*
  used elsewhere, deliberately — see [ADR-0007: Offline mode](0007-offline-mode.md) for
  `backup`'s degraded-mode fallback, which is a different tradeoff: keeping mirrors *current*
  benefits from live data when available, but *recovering* from them must not depend on it.)

## Consequences

- `restore` has a simple, testable contract: given a mirror on disk, produce a working copy, with
  no external dependencies to mock or account for in tests (see `mirror/restore.test.ts` in
  [Testing](../testing.md)).
- The local mirror must itself be trustworthy — this is why every sync ends in `git fsck` and why
  a failed LFS fetch is treated as a real failure rather than a warning (see
  [Git LFS](../lfs.md#why-a-failed-lfs-fetch-is-a-backup-failure)). If the mirror-first premise
  holds, mirror integrity *is* recovery integrity.
- Protecting the backup host itself (where the mirrors live) becomes the operator's
  responsibility beyond what gh-helix can guarantee on its own — see
  [Disaster Recovery: Protecting the backup host](../disaster-recovery.md#protecting-the-backup-host).

## Tradeoffs

Mirror-first means recovery is only as good as the last successful `backup` run — there is no
"live" fallback to paper over a mirror that's behind. This is treated as the correct tradeoff for
a disaster-recovery tool: predictability and independence from GitHub's availability at recovery
time outweigh the marginal freshness a hybrid approach might offer.
