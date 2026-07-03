# Security

For how to *report* a vulnerability, see [../SECURITY.md](../SECURITY.md). This document
describes gh-helix's threat model and the specific design decisions made in response to it.

## Threat model

gh-helix handles one category of secret (a GitHub token) and operates against two trust
boundaries: the GitHub API/Git remotes, and the local filesystem it mirrors into.

| Asset | Threat | Mitigation |
| --- | --- | --- |
| GitHub token | Leaking via process listing (`ps`, Task Manager) | Injected as an ephemeral `Authorization` header via Git's `GIT_CONFIG_*` env mechanism, never placed in argv. See [Authentication: How the token reaches Git](authentication.md#how-the-token-reaches-git). |
| GitHub token | Leaking via persisted Git config | Never written into a mirror's `.git/config` — the header is process-environment-scoped only, per subprocess. |
| GitHub token | Accidental commit to source control | `.env` is git-ignored by default; `config.json.example` ships with empty credential fields; documentation consistently steers secrets toward `.env`/real env vars, never `config.json`. See [Configuration: Secrets](configuration.md#secrets). |
| Local mirrors | Data loss from a bug in cleanup/move logic | Nothing is ever deleted before its replacement is verified in place — see [Architecture: Failure recovery](architecture.md#failure-recovery) and [ADR-0005](adr/0005-safe-directory-moves.md). |
| Local mirrors | Silent corruption going undetected | Every sync ends with `git fsck --full`; `verify` can be run independently on a schedule. |
| `.metadata/*.json` | Corruption from a crash mid-write | Journaled, fsynced, atomic-rename writes; corrupt files are quarantined and warned about, never silently treated as empty. See [Transaction Model](transaction-model.md). |
| Concurrent invocations | Two processes racing on the same mirrors | Exclusive cross-process lock, fail-fast (never blocks). See [Locking](locking.md). |

## What gh-helix does **not** do

- **No write access to GitHub.** Every GitHub API call gh-helix makes is a read (`repos.listForOrg`,
  `orgs.get`, `rateLimit.get`). It has no code path that creates, modifies, or deletes anything on
  GitHub. A token with only read scopes is sufficient and recommended — see
  [Authentication: Scopes and permissions](authentication.md#scopes-and-permissions).
- **No telemetry, no phone-home.** gh-helix makes network requests only to the configured GitHub
  API host and Git remotes — nothing else.
- **No credential storage of its own.** gh-helix never writes a token to disk itself; it only
  reads one from `.env`/`config.json`/the environment/`gh auth token` at runtime and holds it in
  memory for the duration of the process.

## Dependencies

Direct runtime dependencies are deliberately few: `@octokit/rest`, `commander`, `dotenv`,
`execa`, `ora`, `p-limit`, `picocolors`, `simple-git`. [Dependabot](../.github/dependabot.yml) is
configured to open PRs for version updates; [CodeQL](../.github/workflows/codeql.yml) scans on
every push/PR and on a schedule. See [SUPPORTED_VERSIONS.md](../SUPPORTED_VERSIONS.md) for which
releases receive security fixes.

## Reporting a vulnerability

See [../SECURITY.md](../SECURITY.md) for the reporting channel and expected response process. Do
not open a public GitHub issue for a suspected vulnerability or credential-handling bug.

## Hardening recommendations for operators

- Scope the GitHub token as narrowly as possible (fine-grained PAT limited to the specific org,
  read-only).
- Run scheduled backups under a dedicated service account/identity, not a personal token.
- Restrict filesystem permissions on `BACKUP_DIRECTORY` — it contains full repository history,
  which may include secrets previously committed and later "removed" (removal from HEAD doesn't
  remove them from history; a mirror preserves all of it, which is the point, but also means the
  mirror inherits whatever sensitivity the original repository's full history has).
- Store `.env`/tokens using your platform's secret manager in CI/scheduled environments rather
  than a plaintext file where practical.

## See also

- [Authentication](authentication.md)
- [Locking](locking.md)
- [Transaction Model](transaction-model.md)
- [../SECURITY.md](../SECURITY.md)
