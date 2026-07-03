# 0008. Time-boxed, ID-keyed local cache for repository discovery

## Status

Accepted

## Context

Listing every repository in an organization via the GitHub REST API is a paginated operation that
costs both latency and API rate-limit budget. Several gh-helix commands (`backup`, `status`,
`list`, `clean`) each need this list, and are often run back-to-back (e.g., a `status` check
immediately after a `backup`, or a scheduler running multiple commands in sequence). Re-listing
the entire org on every single invocation is wasteful at any scale, and becomes a real latency
and rate-limit problem on organizations with thousands of repositories. Separately, detecting
repository renames requires comparing "what we called this repository last time" against "what
GitHub calls it now" — which requires *some* persisted record of prior state, not just a live API
response.

## Decision

Repository discovery is cached to `.metadata/repositories.json`, keyed by each repository's
**stable GitHub ID** (not name), with a 10-minute freshness window
(`DEFAULT_CACHE_TTL_MS`). Within that window, cached data is served without an API call; outside
it (or with `--refresh`), a live call refreshes the cache. The same cache doubles as the rename
detection mechanism: keying by ID means a name change is directly observable as "this ID's cached
name differs from its current name," which a name-keyed cache could not represent.

## Alternatives considered

- **No caching — always query live.** Rejected: reintroduces the exact latency/rate-limit cost
  described in Context on every command invocation, including read-only ones like `status`
  invoked frequently for monitoring.
- **Cache with no expiry (manual refresh only).** Rejected: too easy to silently operate on very
  stale data indefinitely; a bounded default freshness window makes staleness self-limiting
  without requiring the operator to remember `--refresh`.
- **Name-keyed cache.** Rejected — cannot represent renames at all; a rename would look
  indistinguishable from "old repository deleted, new repository created," which is the wrong
  signal for `clean`/orphan detection and would move a still-live repository's mirror into
  `_deleted/` on every rename.
- **A much longer or much shorter default TTL.** 10 minutes was chosen as a middle ground:
  short enough that routine staleness (a repo created minutes ago not yet appearing) is rarely
  surprising and easily worked around with `--refresh` when it matters, long enough that
  back-to-back command invocations in the same operator session or scheduled job don't each pay
  a fresh API round-trip. This value isn't derived from a benchmark and could reasonably be
  revisited — see [Performance](../performance.md) for the broader point that only real
  measurement should adjust tuning constants like this one.

## Consequences

- Rename detection falls out of the cache's key structure essentially for free, rather than
  needing a separate mechanism.
- Operators need to understand the freshness tradeoff and reach for `--refresh` when
  currency matters more than speed — documented in
  [Repository Discovery: Caching](../repository-discovery.md#caching) and
  [FAQ](../faq.md#why-didnt-backup-pick-up-a-repository-i-just-created-on-github).
- The cache is also what makes [degraded mode](../repository-discovery.md#degraded-mode)
  (ADR-0007) possible at all — without a persisted prior discovery result, there would be nothing
  to fall back to when the API is unreachable.

## Tradeoffs

A time-boxed cache trades perfect currency for reduced API load and lower latency on repeated
invocations — judged correct for a tool whose commands are run repeatedly (scheduled, or manually
in sequence) against a repository list that changes far less often than commands are invoked.
