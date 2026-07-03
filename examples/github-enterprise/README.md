# Example: GitHub Enterprise Server

Backing up an organization hosted on GitHub Enterprise Server instead of github.com. Full
reference: [../../docs/github-enterprise.md](../../docs/github-enterprise.md).

## Configuration

```bash
# .env
GITHUB_ORG=my-org
BACKUP_DIRECTORY=D:/GitHubBackups
GITHUB_API_URL=https://github.mycompany.com/api/v3
GH_HOST=github.mycompany.com
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
```

`GITHUB_TOKEN` must be a token generated **from `github.mycompany.com`**, not github.com — the
two are separate credential systems.

## Commands

```bash
# Confirm connectivity to the Enterprise instance specifically
gh-helix health

gh-helix backup --dry-run
gh-helix backup
```

## Expected output

```
$ gh-helix health
✓ Git: git version 2.45.0
✓ Git LFS: git-lfs/3.5.1
✓ Backup directory: D:/GitHubBackups
✓ Disk permissions: writable
✓ Available disk space: 412 GB free
✓ Authentication: token resolved (GITHUB_TOKEN)
✓ API connectivity: Connected (rate limit: 4998/5000)
== Health Summary ==
Checks passed: 7/7
```

A `pass` on "API connectivity" here specifically confirms `GITHUB_API_URL` and the token are both
correctly pointed at the Enterprise instance.

## Best practices

- If you're relying on the `gh auth token` fallback instead of setting `GITHUB_TOKEN`/`GH_TOKEN`
  directly, run `gh auth login --hostname github.mycompany.com` first — `GH_HOST` tells gh-helix's
  fallback which host's `gh` session to use.
- Double-check `GITHUB_API_URL` includes the `/api/v3` suffix GHES requires — a bare hostname
  will fail API calls even though it looks superficially correct.
- Everything else (backup, restore, locking, LFS) behaves identically to github.com — there's no
  Enterprise-specific behavior beyond the API endpoint and token source.
