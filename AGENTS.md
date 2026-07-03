# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this is

**gh-helix** — a Node.js/TypeScript CLI (`npm run dev -- <command>`) that mirrors every repository
in a GitHub organization to browsable local Git working copies (including LFS content) and can
restore an independent copy from that local mirror alone, entirely offline. The design goal
driving every architectural decision: *if GitHub disappeared right now, could we get every
repository back?* See [docs/architecture.md](docs/architecture.md) for the full reasoning and
[docs/adr/](docs/adr/) for decision-by-decision detail — check the ADRs before changing locking,
transactions, safe moves, or LFS handling.

## Commands

```bash
npm run dev -- backup --dry-run   # run a CLI command from source, no build step (tsx)
npm run typecheck                 # tsc --noEmit
npm run lint                      # eslint src/**/*.ts tests/**/*.ts tests/**/*.mts
npm run lint:fix
npm run format                    # prettier --write .
npm run format:check
npm test                          # vitest run -- single pass, used in CI
npm run test:watch                # vitest watch mode
npm run build                     # tsc -p tsconfig.json -> dist/
```

Run a single test file or a specific test by name:

```bash
npx vitest run tests/metadata/lock.test.ts
npx vitest run -t "stale lock"
```

Full local check before opening a PR (mirrors CI, which runs on both `ubuntu-latest` and
`windows-latest`):

```bash
npm run typecheck && npm run lint && npm run format:check && npm test && npm run build
```

## Architecture

Strict layering, enforced by convention (not by tooling) — `mirror/` never reaches into
`metadata/`, and `metadata/` never shells out to `git`. Only `commands/` composes across layers:

```
cli.ts (Commander)
  -> commands/   one file per subcommand: backup, restore, clean, verify, status, list, health
       -> api/        GitHub REST client (Octokit), token resolution, paginated + cached discovery
       -> mirror/      all git/git-lfs subprocess invocations: clone, update, verify (fsck), lfs,
                        auth (ephemeral token injection), rename, orphans, restore, inspect
       -> metadata/     .metadata/*.json only — cross-process lock, journaled transactions,
                         repositories.json cache, manifest.json / last-run.json
       -> utils/         cross-cutting primitives: exec, retry, safe directory moves, filter, fs
config/  loads .env / config.json / process env (process env wins on conflict)
logger/  colored console + log-file output
```

Key invariants worth knowing before touching this code:

- **Disk-state changes are stage → verify → commit, never "delete then write" or "copy then
  delete."** This applies to metadata writes, directory moves, and restores alike — see
  [docs/architecture.md#failure-recovery](docs/architecture.md#failure-recovery). The process must
  be safe to kill at any point and resume correctly on the next run.
- **The three metadata files (`manifest.json`, `last-run.json`, `repositories.json`) are written
  as one transaction** via `metadata/transaction.ts`, not independently.
- **Repositories are keyed by GitHub's stable repo ID, not by name**, so renames are never mistaken
  for delete+create. Deleted repos are moved to `_deleted/`, never erased.
- **A failed `git lfs fetch` is a hard failure, not a warning** — a mirror missing LFS objects
  isn't disaster-recoverable (see [ADR-0006](docs/adr/0006-lfs-verification.md)). Don't silently
  change a failure class to a warning (or vice versa) without updating the relevant ADR.
- **Tokens are injected as an ephemeral `Authorization` header per Git subprocess** (`mirror/auth.ts`)
  — never persisted into `.git/config` or passed via argv.
- **`backup`, `restore`, `clean`, `verify` acquire a cross-process lock**; `status`, `list` do not.
  Discovery degrades to the last cached result (`degraded=true`) instead of failing when the
  GitHub API is unreachable, so Git-level maintenance can continue.
- Exit codes are meaningful and distinct: `0` success, `1` partial failure, `2` auth/org access
  failure, `3` invalid config, `4` lock conflict/fatal — see
  [docs/cli-reference.md](docs/cli-reference.md).

## Tests

`tests/` mirrors `src/`'s layout 1:1 — a new function in `src/mirror/verify.ts` gets its test in
`tests/mirror/verify.test.ts`. Prefer a unit test unless the behavior specifically depends on real
cross-process filesystem semantics (atomic rename races, lock acquisition races, resumable staging
across a killed process); those go in `tests/integration/concurrency.test.ts`, which spawns real
separate Node processes via `tests/helpers/{lockWorker,restoreWorker}.mts` rather than mocking
`fs`. When testing crash-recovery behavior, assert both that recovery succeeds *and* that a
partially-completed operation left the original data untouched until the final atomic commit —
that's the guarantee under test, not just "it didn't throw." Full breakdown of what's covered
where: [docs/testing.md](docs/testing.md).

## Conventions when changing the CLI surface

New CLI flags/commands need a `commands/*.ts` implementation, a test, and an update to
[docs/cli-reference.md](docs/cli-reference.md) and the root [README.md](README.md) in the same
change — CLI surface and docs should not drift apart. Avoid adding new runtime dependencies; the
dependency list is kept deliberately small (see [docs/security.md#dependencies](docs/security.md#dependencies)).

## Before opening a PR

- Bug fixes and docs can go straight to a PR. New features or behavior changes should have an
  issue first describing the use case — the core loop (discover → mirror → verify → record) is
  deliberately small; check [docs/roadmap.md](docs/roadmap.md) for whether a change fits an
  existing extension point before proposing changes to the core loop itself.
- Keep changes scoped — a bug fix shouldn't carry unrelated refactors.
- Commit messages should describe *why*, not just *what*.
