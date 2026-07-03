# Architecture Decision Records

An [ADR](https://adr.github.io/) records a significant architectural decision, the alternatives
considered, and the tradeoffs accepted — so future contributors (including future maintainers)
understand *why* the code looks the way it does, not just what it does.

| ADR | Title |
| --- | --- |
| [0001](0001-use-git-mirror.md) | Use `git clone --mirror` instead of a working clone |
| [0002](0002-mirror-first-architecture.md) | Mirror-first architecture: local mirrors are the source of truth for recovery |
| [0003](0003-transactional-metadata.md) | Transactional, journaled metadata writes |
| [0004](0004-cross-process-locking.md) | Cross-process locking via atomic lock-file creation |
| [0005](0005-safe-directory-moves.md) | Safe (staged, verified) directory moves instead of copy-then-delete |
| [0006](0006-lfs-verification.md) | Treat LFS fetch/restore failures as real failures, not warnings |
| [0007](0007-offline-mode.md) | Degraded (offline-tolerant) discovery instead of hard-failing on API errors |
| [0008](0008-cache-strategy.md) | Time-boxed, ID-keyed local cache for repository discovery |
| [0009](0009-github-api.md) | Direct GitHub REST API usage via Octokit, not the `gh` CLI |
| [0010](0010-project-structure.md) | Layered project structure: `commands/` / `api/` / `mirror/` / `metadata/` / `utils/` |

## Adding a new ADR

Copy the format of any existing ADR: **Status**, **Context**, **Decision**, **Alternatives
Considered**, **Consequences**, **Tradeoffs**. Number sequentially, add it to the table above,
and link to it from any [docs/](../README.md) page whose subject it explains the reasoning
behind — an ADR is only useful if it's discoverable from the doc someone's actually reading.
