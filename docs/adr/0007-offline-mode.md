# 0007. Degraded (offline-tolerant) discovery instead of hard-failing on API errors

## Status

Accepted

## Context

Every command except `restore` and `verify` needs to know the current list of repositories in the
org, which requires reaching the GitHub REST API. That API — or the configured token — can become
unavailable independently of whether Git-level access to already-known repositories still works
(GitHub having a partial outage, a token expiring, a network partition that still permits Git
traffic but not API traffic, etc.). A tool that hard-fails the moment the API is unreachable would
mean a scheduled `backup` does *nothing at all* during exactly the kind of event that makes
having current backups most valuable.

## Decision

`discoverReposResilient` tries live discovery first; on any failure, it falls back to the last
cached discovery (`.metadata/repositories.json`), ignoring the cache's normal 10-minute freshness
window entirely, and returns `degraded: true`. If the cache is empty (nothing has ever
successfully been fetched), the original error is re-thrown — there's no fallback data to serve.
`backup` uses this to keep performing Git-level maintenance (clone/update/LFS/verify) against
every repository already known from cache, while explicitly **skipping orphan detection** in this
mode — deciding "no longer exists on GitHub" from stale data risks moving a still-real repository
into `_deleted/`. `clean`, whose entire purpose is acting on that same signal, refuses to run at
all when degraded. Full detail: [Repository Discovery: Degraded mode](../repository-discovery.md#degraded-mode).

## Alternatives considered

- **Hard-fail every command on any discovery error.** Rejected — this is the behavior described
  as unacceptable in Context: it turns a partial GitHub outage into a total backup outage.
- **Fall back to cache for all operations uniformly, including orphan detection and `clean`.**
  Rejected — silently uses stale data for a decision whose whole purpose is spotting things that
  changed, which risks relocating still-real repositories. Treated as a correctness bug, not a
  convenience win.
- **A configurable "degraded mode" toggle (opt-in fallback) rather than default-on.** Rejected as
  unnecessary complexity — falling back to cached data for continued Git maintenance has no
  meaningful downside (the same data was already trusted enough to have been used for the last
  live run), so there's no real scenario where an operator would want it *off*.

## Consequences

- A `backup` run during a GitHub outage still produces value (mirrors stay current) instead of
  failing entirely, and this is visible and auditable: exit code `1`, `discoveryDegraded: true`
  in the manifest, a yellow warning in the summary — a scheduled run surfaces the condition rather
  than silently succeeding *or* silently doing nothing.
  the "degraded" case anywhere in .
- The asymmetry between `backup` (continues, skips orphans) and `clean` (refuses entirely) means
  operators need to understand that distinction — documented explicitly in
  [Repository Discovery](../repository-discovery.md#degraded-mode) and
  [CLI Reference](../cli-reference.md) to avoid surprise.

## Tradeoffs

Serving arbitrarily stale cached data during an outage is a deliberate tradeoff: continued
Git-level protection for known repositories is judged more valuable than refusing to act until
the API recovers, provided the operations performed under staleness (clone/update/LFS/verify) are
themselves safe regardless of how old the repository list is — which they are, since they only
touch repositories already known to exist.
