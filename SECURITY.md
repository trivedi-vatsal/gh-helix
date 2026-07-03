# Security Policy

## Supported versions

See [SUPPORTED_VERSIONS.md](SUPPORTED_VERSIONS.md) for which released versions receive security
fixes.

## Reporting a vulnerability

**Please do not open a public GitHub issue for a suspected security vulnerability**, especially
anything involving credential handling, the locking/transaction guarantees, or the safe-move
logic — see [docs/security.md](docs/security.md#threat-model) for what those guarantees are
supposed to be, so you can describe clearly how they were broken.

Instead, report privately using one of:

- GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability)
  feature on this repository (Security tab → "Report a vulnerability"), if enabled.
- Open a regular issue titled generically (e.g. "Security contact needed") with no technical
  detail, asking a maintainer to reach out for a private channel, if the above isn't available.

Please include:

- A description of the vulnerability and its potential impact.
- Steps to reproduce (a minimal repro is extremely helpful).
- The gh-helix version (or commit) affected.
- Any suggested fix or mitigation, if you have one.

## What to expect

- Acknowledgment of your report as soon as reasonably possible.
- An assessment of severity and affected versions.
- A fix, released as a patch version per [docs/release-process.md](docs/release-process.md), with
  credit to the reporter in the release notes (unless you prefer to remain anonymous).
- Coordinated disclosure — please give maintainers a reasonable window to release a fix before
  any public disclosure.

## Scope

In scope: gh-helix's own source code (`src/`), its handling of GitHub tokens, its locking and
transaction guarantees, and its directory-move safety logic.

Out of scope: vulnerabilities in third-party dependencies (please report those upstream directly
— though we do want to know if gh-helix's usage of a dependency makes an upstream vulnerability
exploitable in a way that wouldn't otherwise be); vulnerabilities requiring an attacker to already
have write access to a machine running gh-helix or to the `.env`/`config.json` files themselves.

## See also

- [docs/security.md](docs/security.md) — threat model and design rationale
- [docs/authentication.md](docs/authentication.md) — token handling specifics
