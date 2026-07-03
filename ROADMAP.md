# Roadmap

This is the community-facing roadmap. For the technical framing (extension points, architectural
seams), see [docs/roadmap.md](docs/roadmap.md).

## Philosophy

gh-helix's core loop — discover repositories, mirror them, verify integrity, record the result —
is intentionally small and stable. Most future work extends *around* that loop rather than
changing it. See [README.md#extension-points](README.md#extension-points) for the specific seams
the architecture was built to support.

## Planned extension points (seams exist, not yet implemented)

- **Cloud storage backends** — push mirrors to Azure Blob Storage or Amazon S3, in addition to
  local disk.
- **Official Docker image** — a maintained, published image (see [examples/docker](examples/docker/)
  for a DIY version today).
- **Scheduled daemon mode** — an optional long-running mode instead of one-shot CLI invocations.
- **Incremental snapshot diffing** — deriving what-changed reports from consecutive
  `manifest.json` files, which already contain everything needed.
- **Web dashboard / metrics exporter** — reading `.metadata/manifest.json` and `last-run.json`
  directly; no gh-helix internals need to change to support this.
- **Database-backed metadata store** (SQLite/Postgres) as an alternative to the JSON files, for
  deployments that want queryable history across many runs.

## Known gaps

- No published npm package or prebuilt binary yet — install-from-source only.
- No dedicated fork-only/non-fork filter.
- No built-in "restore entire organization" command (scripted today — see
  [examples/restore-entire-organization](examples/restore-entire-organization/)).
- No support for Git hosts other than GitHub.com and GitHub Enterprise Server.

See [docs/roadmap.md](docs/roadmap.md#known-gaps-not-yet-on-a-committed-timeline) for the full,
regularly-updated list.

## Proposing something

Open a **Feature Request** issue describing the use case — see
[CONTRIBUTING.md](CONTRIBUTING.md#before-you-start) for how proposals get evaluated against the
project's core-loop-stays-small philosophy.

## Non-goals

- A general-purpose Git hosting migration tool (rewriting history, merging orgs).
- A CI/CD or deployment tool — gh-helix has no write path back to GitHub, by design.
- A full-fidelity GitHub org migration tool (issues, PRs, wiki, settings) — gh-helix is
  Git-data-only.
