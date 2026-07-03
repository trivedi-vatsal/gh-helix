# Troubleshooting

Symptom-first index. Every gh-helix failure maps to one of five [exit codes](cli-reference.md#exit-codes)
— check that first, then find your symptom below.

## Authentication errors (exit code 2)

**"GITHUB_TOKEN/GH_TOKEN not set and `gh auth token` failed"**

- Set `GITHUB_TOKEN` or `GH_TOKEN` in `.env` or the real environment, or run `gh auth login`
  first. See [Authentication](authentication.md#token-resolution-order).
- On GitHub Enterprise Server, confirm `GH_HOST` matches the host you ran `gh auth login
  --hostname` against.

**"Failed to access organization `<org>`"**

- The token is valid but lacks read access to that org's repositories, or the org name is
  misspelled. Confirm `GITHUB_ORG` and that the token's owner is a member (or has been granted
  access) of that org.
- On GHES, confirm `GITHUB_API_URL` points at the right instance — a token valid on github.com
  won't work against a GHES API URL and vice versa.

**`health` shows "API connectivity: skipped -- no token available"**

- This is a downstream symptom of the authentication check above already failing — fix that
  first.

**Auth/API checks pass, but `list` (or `backup --dry-run`) shows zero repositories**

- This is usually stale discovery cache (`.metadata/repositories.json`), not a token parsing
  bug.
- Re-run with `--refresh` to force a live GitHub API call:
  - `gh-helix list --refresh`
  - `gh-helix backup --dry-run --refresh`
- If this happens right after changing org token policy (for example enabling fine-grained PAT
  org access), `--refresh` is the quickest way to confirm current visibility.

## Configuration errors (exit code 3)

**"GITHUB_ORG is not set"** / **"BACKUP_DIRECTORY is not set"**

- Copy `.env.example` to `.env` (or `config.json.example` to `config.json`) and fill in both
  required values. See [Configuration](configuration.md).

**`config.json` parse error**

- `config.json` exists but isn't valid JSON. Validate it (`node -e "require('./config.json')"`
  or any JSON linter) — a trailing comma is the most common cause.

**"MAX_PARALLEL must be a positive integer" / "FETCH_LFS must be a boolean"**

- Check the exact accepted values in [Configuration](configuration.md#reference) —
  `FETCH_LFS` accepts `true/1/yes/on` or `false/0/no/off` (case-insensitive), nothing else.

## Lock conflicts (exit code 4)

**"Another instance is already running"**

- A `backup`, `restore`, `clean`, or `verify` is genuinely in progress against the same
  `BACKUP_DIRECTORY` — wait for it to finish, or check the pid/hostname/command shown in the
  error to confirm.
- If you're certain the previous process is actually gone (crashed without cleanup, or a
  different host's process died without releasing the lock), pass `--force-lock`. See
  [Locking](locking.md#staleness-rules) for exactly when a lock is auto-reclaimed without needing
  this flag at all.

## Partial failures (exit code 1)

**Some repositories show `status: failed` in the manifest / summary**

- Check the `error` field for that repository in `.metadata/manifest.json`, or the log output
  (use `--log-file` to capture it). Common causes: transient network failure that exhausted
  `--retries`, a permission issue on a specific (usually private) repository, or an LFS fetch
  failure (see below).
- Re-running `backup` is safe and will retry only what's still needed — see
  [Backup Workflow: Idempotency](backup-workflow.md#idempotency).

**"Discovery: degraded" appears in the summary**

- The GitHub API was unreachable during this run; mirrors were still updated from cache, but
  orphan detection was skipped. See
  [Repository Discovery: degraded mode](repository-discovery.md#degraded-mode). Re-run once the
  API is reachable, ideally with `--refresh`, to get a fully current run (including orphan
  detection).

**`clean` refuses to run: "Refusing to move anything to `_deleted/` based on stale data"**

- Same root cause as above — `clean` is stricter than `backup` and won't act at all while
  discovery is degraded. Retry once the API is reachable.

**`verify` reports failures**

- `git fsck --full` found a structural problem in that mirror. This usually indicates disk
  corruption or an interrupted low-level Git operation outside of gh-helix's own control (e.g. a
  hard power-off during a raw `git` command run by something else against that directory).
  Investigate the host's disk health; if you decide the mirror is unrecoverable, remove that
  mirror's directory and re-run `backup` to reclone it fresh.

**`restore` exits 1: "LFS objects could not be confirmed restored"**

- See [LFS errors](#lfs-errors) below.

## LFS errors

**Backup: repository fails with an LFS fetch error**

- Confirm `git lfs version` works on the backup host (see [Installation](installation.md#prerequisites)).
- Check for LFS storage quota/bandwidth limits on the GitHub side (LFS has separate quotas from
  regular Git storage on github.com).
- If you don't need LFS objects backed up at all, set `FETCH_LFS=false` — but understand this
  means those repositories are **not** disaster-recoverable through gh-helix; see
  [Git LFS](lfs.md#why-a-failed-lfs-fetch-is-a-backup-failure).

**Restore: `RestoreLfsError`, "git-lfs is required but not installed"**

- Install Git LFS on the machine running `restore` (see [Git LFS](lfs.md#installing-git-lfs)) and
  re-run the same `restore` command — it resumes from the staged clone rather than starting over.

**Restore: `RestoreLfsError` listing specific files as unresolved pointers**

- `git lfs pull` ran but some objects still weren't rehydrated — typically because the mirror
  itself is missing those LFS objects (an earlier `backup` run had `lfsFetched: false` for this
  repository). Check `.metadata/manifest.json` for that repository's history; if the mirror never
  successfully fetched LFS, re-run `backup` against it (with network access) before retrying
  `restore`.

## "No local mirror found" on restore (exit code 4)

- Run `gh-helix backup` at least once for that repository first — `restore` only ever reads from
  an existing local mirror, never from GitHub.

## Restore destination already exists (exit code 4)

- The destination must be a missing path or an *empty* directory. Choose a different
  `--destination`, or empty/remove the existing one first (after confirming you don't need what's
  in it).

## Health check failures

Run `gh-helix health` and act on the specific failing check — it's designed to catch exactly the
issues above (Git, Git LFS, auth, API connectivity, disk permissions, disk space, backup
directory) in one pass before you run a real command.

## Still stuck?

- Re-run with `--log-file <path>` to capture full plain-text output for sharing/inspection.
- Check [FAQ](faq.md) for questions that don't need a runbook.
- Open an issue — see [../CONTRIBUTING.md](../CONTRIBUTING.md).
