# Installation

## Prerequisites

| Requirement | Version | Why |
| --- | --- | --- |
| [Node.js](https://nodejs.org/) | 22+ (`engines.node` in `package.json`) | Runtime. gh-helix is pure ESM. |
| [Git](https://git-scm.com/) | any recent version, on `PATH` | Every mirror operation shells out to `git`. |
| [Git LFS](https://git-lfs.com/) | any recent version, on `PATH` | Only required if `FETCH_LFS=true` (the default) or if any mirrored repository uses LFS. |
| A GitHub token | — | See [Authentication](authentication.md). The GitHub CLI (`gh`) is only used as an optional fallback for obtaining one — never for repository discovery. |

Confirm prerequisites with:

```bash
node --version
git --version
git lfs version
```

or let gh-helix do it for you after installing:

```bash
gh-helix health
```

## Install from source

There is currently no published npm package or prebuilt binary — install from source:

```bash
git clone https://github.com/trivedi-vatsal/gh-helix.git
cd gh-helix
npm install
npm run build
```

This produces `dist/cli.js`, the compiled entry point referenced by `package.json`'s `bin` field.

### Run without installing globally

```bash
node dist/cli.js --help
```

### Install as a global command

```bash
npm link
gh-helix --help
```

`npm link` symlinks the `gh-helix` bin into your global npm prefix. To undo it:

```bash
npm unlink -g gh-helix
```

### Run without building (development)

```bash
npm run dev -- backup --dry-run
```

`npm run dev` runs `src/cli.ts` directly via [tsx](https://github.com/privatenumber/tsx) — useful
while developing, not recommended for scheduled production runs (every invocation re-transpiles).

## Platform notes

gh-helix is developed and CI-tested on both **Windows** and **Linux** (see
[.github/workflows/ci.yml](../.github/workflows/ci.yml)); macOS is expected to work identically
(same Node/Git toolchain) but isn't currently covered by CI.

- **Windows**: use forward slashes in `BACKUP_DIRECTORY` (e.g. `D:/GitHubBackups`) — this is
  what `.env.example` and `config.json.example` use, and avoids backslash-escaping issues in
  `.env`/JSON.
- **Directory fsync on Windows**: the best-effort directory-fsync step in the metadata
  transaction writer (see [Transaction Model](transaction-model.md)) is not reliably supported
  on Windows filesystems; this is expected and does not weaken the journal-based crash recovery,
  which is the actual correctness guarantee.
- **Cross-volume moves**: if `BACKUP_DIRECTORY` and its `_deleted/` subfolder ever end up on
  different volumes (unusual, but possible with certain mount configurations), safe moves
  transparently fall back from an atomic rename to a verified copy — see
  [Architecture: Failure recovery](architecture.md#failure-recovery).

## Docker

See [examples/docker](../examples/docker/) for a minimal container setup — there is no official
published image yet (tracked in the [Roadmap](roadmap.md)).

## Verifying the install

```bash
gh-helix health
```

Expect every check to report `pass` (Git, Git LFS, backup directory, disk permissions, available
disk space, authentication, API connectivity). A `warn` on Git LFS is fine if `FETCH_LFS=false`
and none of your repositories use LFS.

## Upgrading

gh-helix has no separate migration command. Pull the latest source, `npm install`, `npm run
build`. If you're upgrading from the legacy `gh-org-backup` 1.x tool, its `.backup-state.json` is
migrated into `.metadata/repositories.json` automatically the first time you run any command
against an existing `BACKUP_DIRECTORY` — no manual step required.

## Uninstalling

```bash
npm unlink -g gh-helix   # if installed globally
rm -rf gh-helix           # the cloned source
```

Your `BACKUP_DIRECTORY` (the mirrors themselves, and `.metadata/`) is untouched by uninstalling —
it's just a directory on disk.
