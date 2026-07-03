# Supported Versions

gh-helix follows [Semantic Versioning](https://semver.org/) — see
[docs/release-process.md](docs/release-process.md) for how a release is cut.

| Version | Supported |
| --- | --- |
| 2.x (latest MAJOR) | :white_check_mark: |
| 1.x (`gh-org-backup`, legacy) | :x: — see the migration note below |

Only the latest MAJOR version line receives security fixes and bug fixes. Given this project's
current size and release cadence, maintaining parallel fix branches for older major versions isn't
practical — upgrading to the latest release is the supported path. This will be revisited if/when
release cadence and adoption justify a longer support window (tracked informally; open an issue if
this is a blocker for your deployment).

## Upgrading from 1.x

The legacy `gh-org-backup` 1.x tool's state file (`.backup-state.json`) is migrated automatically
into `.metadata/repositories.json` the first time any 2.x command runs against an existing
`BACKUP_DIRECTORY` — no manual migration step is required. See
[docs/installation.md#upgrading](docs/installation.md#upgrading).

## Node.js support

gh-helix requires Node.js **22+** (`engines.node` in [package.json](package.json)) — matching
Node's own [release schedule](https://nodejs.org/en/about/previous-releases), support for a given
Node major version follows that version's own upstream maintenance status.

## Reporting a vulnerability in a supported version

See [SECURITY.md](SECURITY.md).
