# Roadmap

This mirrors [../ROADMAP.md](../ROADMAP.md) at the repository root with more technical framing.
See that file for the community-facing version.

## Philosophy

gh-helix's core loop (discover → mirror → verify → record) is deliberately small and stable. Most
future work is additive — new seams around that loop — rather than changes to it. The
[Extension points](../README.md#extension-points) section of the root README lists the specific
seams the current architecture was built to support without disruptive refactors:

- Storage backends (Azure Blob Storage, Amazon S3)
- An official Docker image / first-class GitHub Actions usage
- Scheduled daemon mode (wrapping the existing single-async-function command bodies)
- Incremental snapshot diffing (from consecutive `manifest.json` files, which already exist)
- A web dashboard / Prometheus metrics exporter (reading `.metadata/*.json` directly)
- A SQLite/Postgres metadata store (swapping `metadata/cache.ts` and `metadata/manifest.ts`'s
  read/write functions for a database client)

These are **intentionally not implemented yet** — only the architectural seams for them exist, so
they can be added later without touching `api/`, `mirror/`, or the transaction/locking machinery.

## Known gaps (not yet on a committed timeline)

- No dedicated fork-only / non-fork filter beyond `--include`/`--exclude` glob matching on name.
- No built-in "restore entire organization" command (currently scripted — see
  [examples/restore-entire-organization](../examples/restore-entire-organization/)).
- No published npm package or prebuilt binary — install-from-source only (see
  [Installation](installation.md#install-from-source)).
- No official Docker image (see [examples/docker](../examples/docker/) for a DIY setup).
- No support for Git hosts other than GitHub.com / GitHub Enterprise Server.
- No cross-repository LFS object deduplication.
- No `--jitter` option on the retry backoff (currently pure exponential, no randomization).

## Under consideration

- Native object-storage backends (S3/Azure Blob) as a `backup` destination alongside local mirrors.
- A `--json` output mode for `status`/`list` for easier scripting (today, scripting reads
  `.metadata/*.json` directly, which already works but requires knowing the schema — see
  [Metadata](metadata.md)).
- Structured/JSON logging as an alternative to the plain-text `--log-file` format.
- A Prometheus/OpenMetrics exporter reading `.metadata/manifest.json`.

## How to propose something

Open an issue using the **Feature Request** template (see
[.github/ISSUE_TEMPLATE](../.github/ISSUE_TEMPLATE/)) describing the use case, not just the
desired API — see [CONTRIBUTING.md](../CONTRIBUTING.md) for how proposals get triaged into this
roadmap.

## Non-goals

- **Not a general-purpose Git hosting migration tool.** gh-helix backs up and restores; it
  doesn't rewrite history, merge orgs, or transform repository content.
- **Not a CI/CD or deployment tool.** It has no write path back to GitHub at all, by design — see
  [Security](security.md#threat-model).
- **Not a replacement for GitHub's own org-level export/migration APIs** for full org migrations
  (issues, PRs, wiki, settings) — gh-helix is Git-data-only (commits, refs, LFS).
