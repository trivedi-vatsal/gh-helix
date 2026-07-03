# Configuration

## Sources and precedence

Configuration can come from three places, in this precedence order (highest wins):

1. **Real process environment variables** (e.g. set by your shell, CI, or scheduler)
2. **`.env` file** (loaded via [dotenv](https://github.com/motdotla/dotenv); dotenv never
   overrides a variable already present in the real environment, which is *why* step 1 and 2
   share a precedence tier over step 3)
3. **`config.json` file**

In other words: `.env`/real env vars **always win** over `config.json`. This is deliberate —
`config.json` is meant to be a committable, non-secret baseline (org name, backup directory,
tuning knobs); `.env` and real env vars are where secrets and per-environment overrides belong.

```bash
cp .env.example .env
# or
cp config.json.example config.json
```

Both files use the **same key names**. You can mix them: put non-secret defaults in
`config.json` (safe to commit) and only the token in `.env` (already git-ignored).

### File locations

| Global flag | Default |
| --- | --- |
| `-e, --env <path>` | `.env` in the current working directory |
| `-c, --config <path>` | `config.json` in the current working directory |

A missing `.env` or `config.json` is **not an error** — gh-helix falls back to defaults / the
real environment. A `config.json` that exists but fails to parse as JSON *is* an error
(`ConfigError`, exit code 3).

## Reference

| Key | Env var | Required | Default | Possible values | Validation |
| --- | --- | --- | --- | --- | --- |
| GitHub organization | `GITHUB_ORG` | **yes** | — | any non-empty string | non-empty string |
| Backup directory | `BACKUP_DIRECTORY` | **yes** | — | any path | non-empty string; resolved to an absolute path |
| Worker pool size | `MAX_PARALLEL` | no | `5` | any positive integer | positive integer |
| Fetch Git LFS objects | `FETCH_LFS` | no | `true` | `true`/`1`/`yes`/`on`, `false`/`0`/`no`/`off` | boolean (`true/1/yes/on` or `false/0/no/off`, case-insensitive) |
| Checkout working tree | `CHECKOUT_CODE` | no | `true` | `true`/`1`/`yes`/`on`, `false`/`0`/`no`/`off` | boolean (`true/1/yes/on` or `false/0/no/off`, case-insensitive) |
| Authentication mode | `AUTH_MODE` | no | `auto` | `auto`, `token`, `gh` | one of `auto`, `token`, `gh`, case-insensitive |
| GitHub token (primary) | `GITHUB_TOKEN` | no* | — | any non-empty string | non-empty string |
| GitHub token (fallback) | `GH_TOKEN` | no* | — | any non-empty string | non-empty string |
| Enterprise host | `GH_HOST` | no | — | any bare hostname | bare hostname, GHES only |
| Enterprise API URL | `GITHUB_API_URL` | no | `https://api.github.com` (Octokit's own default) | any full REST base URL | full REST base URL, GHES only |

\* At least one token source is required at runtime: `GITHUB_TOKEN`, `GH_TOKEN`, or a working
`gh auth login` session. This isn't validated at config-load time — it's resolved lazily, per
command, by [`resolveToken`](authentication.md); `restore` doesn't need a token at all, since it
never talks to GitHub.

### `GITHUB_ORG`

The GitHub organization login to back up (e.g. `my-org` for `github.com/my-org`). Required; a
missing value throws `ConfigError`: *"GITHUB_ORG is not set. Add GITHUB_ORG=\<your-org\> to your
.env or config.json (see .env.example)."*

### `BACKUP_DIRECTORY`

Where mirrors are stored. Resolved through `path.resolve()`, so a relative value is resolved
against the current working directory — an absolute path is strongly recommended so behavior
doesn't depend on where you invoke gh-helix from (this matters for scheduled runs). On Windows,
use forward slashes (`D:/GitHubBackups`) to avoid backslash-escaping issues in `.env` and JSON.

Resulting layout:

```
D:/GitHubBackups/
    repo-a.git/
    repo-b.git/
    _deleted/
        old-repo.git/
    .metadata/
        repositories.json
        manifest.json
        last-run.json
        backup.lock
```

### `MAX_PARALLEL`

Size of the worker pool (via [p-limit](https://github.com/sindresorhus/p-limit)) used to run Git
operations concurrently across repositories during `backup`. Default `5`. Higher values speed up
large orgs at the cost of more concurrent Git processes, network connections, and disk I/O — see
[Performance](performance.md#parallel-worker-recommendations) for tuning guidance.

### `FETCH_LFS`

Whether `git lfs fetch --all` runs after every clone/update. Default `true`. When `true`, a
failed LFS fetch marks that repository's backup `status` as `failed` (not a warning) — see
[Git LFS](lfs.md#why-a-failed-lfs-fetch-is-a-backup-failure). Set to `false` only if you're
certain no mirrored repository uses LFS, or if LFS storage is backed up through another path.

### `CHECKOUT_CODE`

Whether repositories are stored as browsable working-tree clones (`true`, the default), with
source files checked out on disk, or as bare mirrors (`false`) — `.git`-only, no working tree,
full ref/tag/notes fidelity, less disk. Affects the on-disk directory naming convention (see
`mirrorDirName` in `src/utils/paths.ts`).

### `AUTH_MODE`

Which credential source(s) `resolveToken` is allowed to use: `auto` (default; `GITHUB_TOKEN` then
`GH_TOKEN` then `gh auth token`), `token` (only `GITHUB_TOKEN`/`GH_TOKEN`, never shells out to
`gh`), or `gh` (only the `gh auth token` fallback, ignoring any token env vars). See
[Authentication](authentication.md).

### `GITHUB_TOKEN` / `GH_TOKEN`

See [Authentication](authentication.md) for the full resolution order and scope requirements.

### `GH_HOST` / `GITHUB_API_URL`

GitHub Enterprise Server only — see [GitHub Enterprise Server](github-enterprise.md).
`GITHUB_API_URL` is passed straight through as Octokit's `baseUrl` and is never hardcoded
anywhere in the codebase; `GH_HOST` is used only for the `gh auth token` CLI fallback.

## Precedence example

```json
// config.json (committed)
{
  "GITHUB_ORG": "my-org",
  "BACKUP_DIRECTORY": "D:/GitHubBackups",
  "MAX_PARALLEL": 8
}
```

```bash
# .env (git-ignored)
GITHUB_TOKEN=ghp_xxx
MAX_PARALLEL=3
```

Effective config: `GITHUB_ORG=my-org`, `BACKUP_DIRECTORY=D:/GitHubBackups`, `MAX_PARALLEL=3`
(`.env` wins), `GITHUB_TOKEN=ghp_xxx`.

## Validation errors

Every validation failure throws `ConfigError` and exits with code `3`:

- `GITHUB_ORG` or `BACKUP_DIRECTORY` missing
- `MAX_PARALLEL` present but not a positive integer
- `FETCH_LFS` present but not a recognized boolean string
- `config.json` exists but isn't valid JSON

See [CLI Reference: Exit codes](cli-reference.md#exit-codes).

## Secrets

Never commit a token in `config.json`. Prefer `.env` (already listed in `.gitignore`) or real
environment variables (e.g. a CI secret, a scheduler's credential store). See
[Security](security.md#secrets-handling).
