# 0009. Direct GitHub REST API usage via Octokit, not the `gh` CLI

## Status

Accepted

## Context

Repository discovery and org access verification need a reliable, scriptable way to talk to the
GitHub API (and, for Enterprise Server, a *configurable* API endpoint rather than a hardcoded
one). The GitHub CLI (`gh`) is a plausible alternative for both authentication and API access,
since many operators already have it installed and authenticated.

## Decision

gh-helix uses `@octokit/rest` directly for all GitHub API access (repository listing, org
verification, rate-limit checks) and never shells out to `gh` for anything except an *optional*
fallback token source (`gh auth token`, used only when neither `GITHUB_TOKEN` nor `GH_TOKEN` is
configured). Discovery, specifically, never uses `gh` at all under any configuration.

## Alternatives considered

- **Use the `gh` CLI for repository discovery** (`gh repo list`, parsing its output). Rejected:
  introduces a hard dependency on an external binary being installed and authenticated
  independently of gh-helix's own configuration, adds output-parsing fragility (`gh`'s text/JSON
  output shape is not a stable API contract in the same sense as the REST API itself), and offers
  no capability the REST API + Octokit doesn't already provide directly.
- **GraphQL API instead of REST.** Considered — GraphQL can reduce round-trips for some query
  shapes — but rejected for this use case: REST's paginated `repos.listForOrg` maps directly onto
  Octokit's built-in async paginating iterator (see
  [Repository Discovery: Live discovery](../repository-discovery.md#live-discovery)), keeping
  memory bounded on very large orgs without hand-rolled cursor management, and REST's `baseUrl`
  override is a simpler, more universally supported mechanism for GitHub Enterprise Server
  compatibility (see [ADR](0009-github-api.md) itself and
  [GitHub Enterprise Server](../github-enterprise.md)) than GraphQL endpoint configuration would
  be.
- **GitHub's migration/export API** for bulk organization data. Rejected as the discovery
  mechanism — see [ADR-0001](0001-use-git-mirror.md) for the related decision that gh-helix is
  Git-data-focused, not a full-organization-migration tool; the plain repository-listing endpoint
  is a better fit for "what repositories currently exist and what are their clone URLs," which is
  all discovery needs.

## Consequences

- gh-helix's only *required* external dependency for GitHub access is the token itself — `gh`
  installation is optional, needed only if an operator wants its `gh auth token` convenience
  instead of setting `GITHUB_TOKEN`/`GH_TOKEN` directly.
- GitHub Enterprise Server support is a simple `baseUrl` override
  (`GITHUB_API_URL`) passed straight to Octokit's constructor, with no special-casing elsewhere
  in the codebase — see [GitHub Enterprise Server](../github-enterprise.md).
- Octokit's own request-logging plugin is explicitly silenced (`silentLog`) in `api/client.ts` so
  all output flows through gh-helix's own logger consistently — a minor but deliberate detail
  that keeps `--log-file` output well-formed.

## Tradeoffs

Depending directly on Octokit rather than the `gh` CLI means gh-helix owns its own API client
code (token resolution, pagination, error wrapping) rather than delegating to `gh`'s — more code
to maintain, but a stable, versioned, typed dependency (`@octokit/rest`) instead of parsing
another CLI tool's output, which was judged the more robust choice for the tool's core, most
frequently exercised code path.
