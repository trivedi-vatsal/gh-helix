# Example: backup during a GitHub outage (degraded mode)

Demonstrates what `gh-helix backup` does when the GitHub API is unreachable but Git-level access
to already-known repositories still works. Full explanation:
[../../docs/repository-discovery.md#degraded-mode](../../docs/repository-discovery.md#degraded-mode).

## Setup

Requires at least one prior successful `backup` run, so `.metadata/repositories.json` has a
cached discovery to fall back to. A first-ever run against an unreachable API has nothing to fall
back to and fails normally (`AuthenticationError`/network error, exit `2`).

## Command

```bash
gh-helix backup
```

## Expected output (API unreachable)

```
⚠ Discovery: degraded (getaddrinfo ENOTFOUND api.github.com (using cached discovery from 2026-07-03T09:00:00.000Z))
✓ Updated api-service
✓ Updated web-frontend
== Backup Summary ==
Total repositories: 2
Updated: 2
Failed: 0
Discovery: degraded (getaddrinfo ENOTFOUND api.github.com ...)
```

Exit code `1` — even with zero repository failures, degraded discovery alone sets `PartialFailure`
so a scheduler notices the condition. Note **orphan detection did not run** in this output — a
repository actually deleted from GitHub during the outage would not be moved to `_deleted/` until
a subsequent, live run.

## What's different from a normal run

| Behavior | Normal | Degraded |
| --- | --- | --- |
| Clone/update known mirrors | Yes | Yes |
| LFS fetch | Yes | Yes |
| Orphan detection (`_deleted/`) | Yes | **Skipped** |
| Exit code on otherwise-clean run | `0` | `1` |
| `.metadata/manifest.json` | `discoveryDegraded: false` | `discoveryDegraded: true` |

## Best practices

- Treat a degraded run as "mirrors stayed current, but the repository list itself may be stale" —
  re-run with `--refresh` once the API is reachable again to get a fully current run, including
  orphan detection.
- Don't run `gh-helix clean` during an outage — it refuses to act while discovery is degraded, by
  design (see [../../docs/cli-reference.md#clean](../../docs/cli-reference.md#clean)).
- Alert on `discoveryDegraded: true` separately from per-repository failures — it's a distinct
  signal (API/token issue) from an individual repo failing to clone.
