# Example: basic backup

The smallest useful gh-helix setup — back up one organization to one local directory.

## Configuration

`.env`:

```bash
GITHUB_ORG=my-org
BACKUP_DIRECTORY=D:/GitHubBackups
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
```

See [../../docs/configuration.md](../../docs/configuration.md) for every available key.

## Commands

```bash
# Confirm the environment is ready
gh-helix health

# See what would happen without touching disk
gh-helix backup --dry-run

# Run it for real
gh-helix backup

# Confirm the result
gh-helix status
gh-helix verify
```

## Expected output

```
$ gh-helix backup
✓ Cloned api-service
✓ Cloned web-frontend
✓ Updated docs-site
⚠ Archived repo skipped: legacy-tool
== Backup Summary ==
Total repositories: 4
Cloned: 2
Updated: 1
Archived: 1
Failed: 0

$ gh-helix status
Repository count: 4
Mirrored: 4
Failed count (last run): 0
Orphaned: 0
Archived: 1
Total disk usage (approximate, from GitHub): 128.4 MB
Last sync: 2026-07-03T12:00:00.000Z
```

Exit code `0` on both commands — see [../../docs/cli-reference.md#exit-codes](../../docs/cli-reference.md#exit-codes).

## Resulting layout

```
D:/GitHubBackups/
    api-service.git/
    web-frontend.git/
    docs-site.git/
    legacy-tool.git/
    .metadata/
        repositories.json
        manifest.json
        last-run.json
```

## Best practices

- Run `gh-helix health` before the first real backup — it catches missing Git/Git LFS,
  authentication, and disk-space issues in one pass.
- Use `--dry-run` before backing up an org for the first time, especially if you plan to add
  `--include`/`--exclude` filters later — confirm the unfiltered set looks right first.
- Re-running `gh-helix backup` is always safe and cheap after the first run — see
  [../../docs/backup-workflow.md#idempotency](../../docs/backup-workflow.md#idempotency).
