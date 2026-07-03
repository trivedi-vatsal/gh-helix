# Contributing to gh-helix

Thanks for considering a contribution. This document covers setup, workflow, and the standards a
pull request needs to meet.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating, you're
expected to uphold it.

## Getting set up

```bash
git clone https://github.com/trivedi-vatsal/gh-helix.git
cd gh-helix
npm install
```

```bash
npm run dev -- --help      # run directly from source, no build step
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
```

See [docs/testing.md](docs/testing.md) for the full test architecture and how to run a single
test file.

## Before you start

- **Bug fixes and documentation**: open a PR directly; no need to discuss first for small,
  well-scoped changes.
- **New features or behavior changes**: open an issue first (use the **Feature Request**
  template) describing the use case. This project's core loop
  (discover → mirror → verify → record) is deliberately small — see
  [docs/roadmap.md](docs/roadmap.md) for the extension points it's designed around, and check
  whether your idea fits one of them before proposing a change to the core loop itself.
- Check [docs/adr/](docs/adr/) before proposing a change to locking, transactions, safe moves, or
  LFS handling — these have documented reasoning, and a PR that changes one of them should either
  align with the existing decision or explicitly propose a new ADR superseding it.

## Development workflow

1. Fork and branch from `main`.
2. Make your change. Keep it scoped — a bug fix shouldn't carry along unrelated refactors (see
   the project's own engineering norms below).
3. Add or update tests. Put a new test next to its source module's mirrored path under `tests/`
   (see [docs/testing.md](docs/testing.md#writing-new-tests)).
4. Run the full local check before opening a PR:
   ```bash
   npm run typecheck && npm run lint && npm run format:check && npm test && npm run build
   ```
5. Open a PR using the [pull request template](.github/PULL_REQUEST_TEMPLATE.md). Link the issue
   it addresses, if any.

## Engineering norms for this codebase

- Respect the layered architecture (`commands/` → `api/`, `mirror/`, `metadata/` → `utils/`) —
  see [docs/architecture.md](docs/architecture.md#component-overview) and
  [ADR-0010](docs/adr/0010-project-structure.md). `mirror/` should never reach into `metadata/`,
  and vice versa.
- Anything that touches disk state (`.metadata/*.json`, mirror directories) needs to preserve the
  stage-verify-commit pattern documented in
  [docs/architecture.md#failure-recovery](docs/architecture.md#failure-recovery) — no "delete
  then write" or "copy then delete" shortcuts.
- Don't silently downgrade a failure to a warning, or vice versa, without updating the relevant
  ADR and docs — see [ADR-0006](docs/adr/0006-lfs-verification.md) for why this project treats
  some failure classes more strictly than might seem necessary at first glance.
- New CLI flags/commands need: a `commands/*.ts` implementation, a test, and an update to
  [docs/cli-reference.md](docs/cli-reference.md) and the root [README.md](README.md) in the same
  PR — CLI surface and docs should never drift apart.
- No new runtime dependencies without a good reason — see
  [docs/security.md#dependencies](docs/security.md#dependencies) for why the dependency list is
  kept deliberately small.

## Commit messages

Describe *why*, not just *what* — the diff already shows what changed. Reference the issue number
if one exists.

## Pull request review

- CI (typecheck, lint, format check, test, build — on both Windows and Linux) must pass.
- A maintainer will review for correctness, test coverage, and alignment with the architecture
  above. Expect questions if a change touches locking, transactions, or safe-move logic — these
  are the parts of the codebase where a subtle bug has the highest cost (see
  [docs/security.md](docs/security.md#threat-model)).

## Documentation changes

Docs live under [docs/](docs/), with [ADRs](docs/adr/) for architectural reasoning and
[examples/](examples/) for runnable scenarios. If you're fixing a doc bug, check whether the same
inaccuracy is duplicated elsewhere (the docs cross-link heavily, by design — see
[docs/README.md](docs/README.md)).

## Release process

See [docs/release-process.md](docs/release-process.md) — not something individual contributors
need to run, but useful context for how your merged change eventually ships.

## Questions

Open a **Question** issue (see [.github/ISSUE_TEMPLATE](.github/ISSUE_TEMPLATE/)) or start a
GitHub Discussion if enabled on the repository.
