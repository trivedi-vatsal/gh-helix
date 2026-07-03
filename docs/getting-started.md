# Getting Started

This walks through the fastest path from a fresh clone of gh-helix to a completed backup of a
real GitHub organization. For prerequisites and alternative install methods, see
[Installation](installation.md).

## 1. Install

```bash
git clone https://github.com/trivedi-vatsal/gh-helix.git
cd gh-helix
npm install
npm run build
```

Verify it built:

```bash
node dist/cli.js --help
```

(Optional) install it as a global command:

```bash
npm link
gh-helix --help
```

## 2. Configure

```bash
cp .env.example .env
```

Edit `.env`:

```bash
GITHUB_ORG=my-org
BACKUP_DIRECTORY=D:/GitHubBackups
GITHUB_TOKEN=ghp_xxx
```

See [Configuration](configuration.md) for every available setting and
[Authentication](authentication.md) for how to scope the token.

## 3. Check your environment

```bash
gh-helix health
```

This checks Git, Git LFS, the backup directory, disk space, authentication, and GitHub API
connectivity in one pass — fix anything it flags before running a real backup.

## 4. Dry-run the backup

```bash
gh-helix backup --dry-run
```

A dry run discovers repositories and reports what *would* happen (clone/update/rename/orphan)
without touching disk or `.metadata/`. Use it to sanity-check `--include`/`--exclude` filters
before committing to a real run.

If you just changed token permissions or org access settings, run discovery with `--refresh`
to bypass the 10-minute cache and confirm current visibility immediately:

```bash
gh-helix list --refresh
gh-helix backup --dry-run --refresh
```

## 5. Run the backup

```bash
gh-helix backup
```

On a large org this can take a while the first time (every repository is a full mirror clone).
Subsequent runs only clone what's new and fetch what changed, so they're much faster.

## 6. Check the result

```bash
gh-helix status
gh-helix verify
```

`status` reports counts and disk usage; `verify` runs `git fsck` against every local mirror. Both
are read-only and safe to run at any time.

## 7. Try a restore

Prove to yourself the backup is actually recoverable, on a repository you don't mind restoring
into a scratch folder:

```bash
gh-helix restore some-repo --destination ./scratch/some-repo
```

This works **entirely offline** — no GitHub access is used, only the local mirror. That's the
property a disaster-recovery tool has to have.

## Next steps

- Automate it: see [examples/scheduled-backup](../examples/scheduled-backup/).
- Understand what each command actually does: [CLI Reference](cli-reference.md).
- Understand the guarantees behind "safe to interrupt anywhere": [Architecture](architecture.md).
- Point it at GitHub Enterprise Server: [GitHub Enterprise Server](github-enterprise.md).
