# 0010. Layered project structure: `commands/` / `api/` / `mirror/` / `metadata/` / `utils/`

## Status

Accepted

## Context

gh-helix's logic spans several genuinely different concerns: talking to the GitHub API, shelling
out to `git`/`git-lfs`, persisting local state durably, and orchestrating all of that into
user-facing commands. Without a deliberate layering, these concerns tend to blur together over
time — API-specific error handling leaking into Git operations, or metadata file writes scattered
across command files — making the codebase harder to test in isolation and harder to extend
safely.

## Decision

Source is organized into five layers with a strict, one-directional dependency rule:

```
commands/  ->  api/, mirror/, metadata/  ->  utils/
```

- **`commands/`** — one file per CLI subcommand; the only layer that composes across all others.
- **`api/`** — GitHub REST API access and repository discovery; knows about Octokit and
  `.metadata/repositories.json`, nothing about `git` itself.
- **`mirror/`** — all `git`/`git lfs` subprocess invocations against a single mirror; knows about
  the local filesystem and Git, nothing about the GitHub API or `.metadata/`'s other files.
- **`metadata/`** — reads/writes `.metadata/*.json` durably and holds the cross-process lock;
  knows about the filesystem only, no Git, no GitHub.
- **`utils/`** — cross-cutting primitives (retry, safe moves, exec, filtering, path helpers) with
  no knowledge of anything above them.

`mirror/` never reaches into `metadata/`, and `metadata/` never shells out to `git` — see
[Architecture: Component responsibilities](../architecture.md#component-responsibilities).

## Alternatives considered

- **Feature-folder structure** (one folder per command, containing everything that command
  needs). Rejected: the actual logic (mirror operations, metadata handling) is shared across
  multiple commands (`backup` and `restore` both touch mirrors; `backup`, `restore`, `clean`, and
  `verify` all touch the lock) — a feature-folder split would duplicate this logic or require an
  awkward shared module anyway, without the benefit of a clear dependency direction.
- **Flat `src/` with no subfolders.** Rejected as it doesn't scale past a handful of files, and
  provides no enforced boundary preventing, e.g., a metadata function from directly shelling out
  to `git` as a shortcut.
- **A single monolithic `core/` module.** Rejected for the same reason — no natural seam for
  testing each concern independently (see the per-module test layout in
  [Testing](../testing.md#test-architecture)), and no natural seam for the extension points
  listed below.

## Consequences

- Each layer can be unit-tested independently, largely without needing to mock the layers above
  it — reflected directly in `tests/` mirroring `src/`'s structure.
- The [Extension points](../../README.md#extension-points) documented in the root README
  (storage backends, a web dashboard, a database-backed metadata store, a daemon wrapper) are
  each scoped to exactly one layer, which is what makes them additive rather than requiring
  cross-cutting refactors: a storage backend wraps `mirror/clone.ts` and `mirror/update.ts`; a
  dashboard reads `metadata/manifest.ts`'s output; a database-backed store swaps `metadata/`'s
  read/write functions.
- One known inconsistency from this evolution, worth flagging rather than silently living with:
  `metadata/manifest.ts`'s `RepoStatus` type declares a `skipped-filtered` value that isn't
  currently assigned by `commands/backup.ts` — filtered-out repositories are counted in the
  summary arithmetic rather than materialized as individual manifest entries with that status.
  This is a minor type/behavior gap, not a bug with user-visible impact, and is a reasonable
  candidate for a small future cleanup (see [Roadmap](../roadmap.md)).

## Tradeoffs

A strict layered structure adds a small amount of indirection (a command orchestrates rather than
inlining logic) compared to a more ad-hoc organization, in exchange for testability and the
specific extensibility this project's documented roadmap depends on.
