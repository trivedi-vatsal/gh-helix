# Changelog

All notable changes to gh-helix are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versioning follows
[Semantic Versioning](https://semver.org/) — see [docs/release-process.md](docs/release-process.md).

## [Unreleased]

### Added

- Comprehensive documentation site under `docs/`, including architecture diagrams, ADRs, and
  workflow guides.
- Architecture Decision Records under `docs/adr/`.
- Example scenarios under `examples/` (basic backup, scheduled backup, GitHub Enterprise, offline
  backup/restore, single/whole-org restore, Docker, and per-OS scheduling).
- Community and governance files: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`,
  `SUPPORTED_VERSIONS.md`, `ROADMAP.md`, `GOVERNANCE.md`.
- GitHub issue templates (bug report, feature request, question) and a pull request template.
- GitHub Actions workflows: lint, typecheck, format check, test, build, release, CodeQL, and
  Dependabot configuration.

## [2.0.0] - Prior to this documentation pass

Baseline functionality as documented in [docs/](docs/) and the root [README.md](README.md):
repository discovery with caching and degraded-mode fallback, mirror-based backup with rename and
orphan detection, offline restore with LFS verification, cross-process locking, transactional
metadata writes, and safe (staged, verified) directory moves. Migrated from the legacy
`gh-org-backup` 1.x tool — see [SUPPORTED_VERSIONS.md](SUPPORTED_VERSIONS.md#upgrading-from-1x).

Detailed historical entries prior to this changelog's introduction were not tracked separately;
see the Git history for the full record.

[Unreleased]: https://github.com/trivedi-vatsal/gh-helix/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/trivedi-vatsal/gh-helix/releases/tag/v2.0.0
