# gh-helix documentation

gh-helix is a production-grade Git repository mirror and disaster recovery tool for GitHub
organizations. This directory is the canonical documentation set — the root [README](../README.md)
is a landing page; everything below it lives here.

## Start here

- **[Getting Started](getting-started.md)** — the fastest path from `git clone` to a working backup.
- **[Installation](installation.md)** — Node/Git/Git LFS prerequisites, install methods, verifying your setup.
- **[Configuration](configuration.md)** — every environment variable and `config.json` key, precedence rules, validation.
- **[Authentication](authentication.md)** — token resolution order, scopes, GitHub Enterprise auth.
- **[CLI Reference](cli-reference.md)** — every command, every flag, every exit code.

## Understanding the system

- **[Architecture](architecture.md)** — components, data flow, and diagrams for every major subsystem.
- **[Repository Discovery](repository-discovery.md)** — how the org's repo list is fetched, cached, and kept fresh.
- **[Backup Workflow](backup-workflow.md)** — the full lifecycle of `gh-helix backup`.
- **[Restore Workflow](restore-workflow.md)** — the full lifecycle of `gh-helix restore`.
- **[Disaster Recovery](disaster-recovery.md)** — runbooks for actually losing GitHub, a host, or a mirror.
- **[Metadata](metadata.md)** — `.metadata/*.json`, what each file means, how it's kept consistent.
- **[Locking](locking.md)** — the cross-process lock that keeps concurrent invocations safe.
- **[Transaction Model](transaction-model.md)** — how multi-file metadata writes stay atomic across crashes.
- **[Git LFS](lfs.md)** — how LFS objects are fetched, verified, and rehydrated.
- **[GitHub Enterprise Server](github-enterprise.md)** — pointing gh-helix at a GHES instance.

## Operating gh-helix

- **[Troubleshooting](troubleshooting.md)** — symptom-first index of common failures and fixes.
- **[FAQ](faq.md)** — short answers to questions that don't need a runbook.
- **[Performance](performance.md)** — benchmark methodology, tuning knobs, expected runtimes at scale.
- **[Security](security.md)** — threat model, token handling, supported reporting channels.

## Contributing

- **[Testing](testing.md)** — test architecture and how to run each category locally.
- **[Release Process](release-process.md)** — versioning, changelog, and how a release ships.
- **[Roadmap](roadmap.md)** — what's planned, what's intentionally not built yet.
- **[Architecture Decision Records](adr/)** — the "why" behind every major design choice, in [ADR](https://adr.github.io/) format.

## Document map by task

| I want to... | Read |
| --- | --- |
| Back up an org for the first time | [Getting Started](getting-started.md) |
| Understand what happens during a backup run | [Backup Workflow](backup-workflow.md) |
| Recover after losing my backup host | [Disaster Recovery](disaster-recovery.md) |
| Restore one repository from a mirror | [Restore Workflow](restore-workflow.md) |
| Point gh-helix at GitHub Enterprise Server | [GitHub Enterprise Server](github-enterprise.md) |
| Understand a specific flag | [CLI Reference](cli-reference.md) |
| Understand why a design decision was made | [ADRs](adr/) |
| Diagnose a failed run | [Troubleshooting](troubleshooting.md) |
| Contribute code | [Testing](testing.md), [../CONTRIBUTING.md](../CONTRIBUTING.md) |
