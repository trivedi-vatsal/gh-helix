# Governance

gh-helix is currently maintained under a **benevolent maintainer** model — a lightweight
governance style appropriate for the project's current size, intended to evolve as the
contributor base grows.

## Roles

### Maintainers

Maintainers have merge access and are responsible for:

- Reviewing and merging pull requests.
- Triaging issues and applying labels.
- Making final decisions on architectural questions, including whether a change requires a new
  [ADR](docs/adr/) or conflicts with an existing one.
- Cutting releases per [docs/release-process.md](docs/release-process.md).

The current maintainer(s) are listed in the repository's GitHub organization/collaborator
settings.

### Contributors

Anyone who opens an issue, submits a pull request, or participates in discussions following
[CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md).

## Decision-making

- **Day-to-day changes** (bug fixes, documentation, small features that fit existing extension
  points — see [docs/roadmap.md](docs/roadmap.md)): reviewed and merged by any maintainer once
  CI passes and review feedback is addressed.
- **Architectural changes** (anything touching locking, transactions, safe moves, the CLI
  contract, or `.metadata/*.json` schemas): require a maintainer's explicit sign-off and, for
  genuinely new decisions, a new or superseding [ADR](docs/adr/).
- **Disputes**: maintainers aim for consensus; where that's not reached, the maintainer who has
  been most active in that area of the codebase makes the final call, documented in the relevant
  PR or ADR.

## Becoming a maintainer

There's no formal application process at this project's current stage. Sustained, high-quality
contributions (code, review, documentation, issue triage) are the path — existing maintainers
extend an invitation when it's a clear fit. This will be formalized further as the contributor
base grows.

## Changing this document

Governance changes go through a normal pull request against this file, requiring maintainer
sign-off like any architectural change.
