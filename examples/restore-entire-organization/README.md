# Example: restore an entire organization

gh-helix has no built-in "restore all" command (see
[../../docs/roadmap.md#known-gaps-not-yet-on-a-committed-timeline](../../docs/roadmap.md#known-gaps-not-yet-on-a-committed-timeline))
— this example scripts the loop over every locally mirrored repository.

## Bash / Linux / macOS

```bash
#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIRECTORY="${BACKUP_DIRECTORY:?set BACKUP_DIRECTORY}"
RESTORE_ROOT="${1:-./restored}"

fail=0
for mirror in "$BACKUP_DIRECTORY"/*.git; do
  [ -d "$mirror" ] || continue
  name="$(basename "$mirror" .git)"
  echo "Restoring $name..."
  if ! gh-helix restore "$name" --destination "$RESTORE_ROOT/$name"; then
    echo "FAILED: $name" >&2
    fail=1
  fi
done

exit $fail
```

## PowerShell / Windows

```powershell
param(
    [string]$RestoreRoot = ".\restored"
)

if (-not $env:BACKUP_DIRECTORY) {
    throw "Set BACKUP_DIRECTORY first"
}

$failed = @()
Get-ChildItem -Path $env:BACKUP_DIRECTORY -Directory -Filter "*.git" | ForEach-Object {
    $name = $_.BaseName
    Write-Host "Restoring $name..."
    & gh-helix restore $name --destination (Join-Path $RestoreRoot $name)
    if ($LASTEXITCODE -ne 0) {
        $failed += $name
    }
}

if ($failed.Count -gt 0) {
    Write-Warning "Failed to restore: $($failed -join ', ')"
    exit 1
}
```

## Expected output

```
Restoring api-service...
✓ Restored api-service -> ./restored/api-service (LFS: not used)
Restoring web-frontend...
✓ Restored web-frontend -> ./restored/web-frontend (LFS: rehydrated)
Restoring docs-site...
✓ Restored docs-site -> ./restored/docs-site (LFS: not used)
```

## Notes

- This intentionally excludes `_deleted/` (the glob only matches `*.git` directly under
  `BACKUP_DIRECTORY`, not the `_deleted` subfolder) — restore repositories still known to GitHub
  first; restore from `_deleted/` explicitly and separately if you specifically need a
  since-removed repository back.
- Each `gh-helix restore` call acquires the lock independently — running this loop sequentially
  (as written) avoids lock contention with itself; don't parallelize it against a single
  `BACKUP_DIRECTORY` without accounting for that (see
  [../../docs/locking.md](../../docs/locking.md)).
- For very large organizations, consider restoring in parallel batches against **separate**
  destination trees, since each `restore` invocation still serializes on the shared lock — the
  parallelism benefit is limited unless you're restoring from multiple `BACKUP_DIRECTORY` mirrors
  or hosts.

## Best practices

- Run this rehearsal periodically (see [offline-restore](../offline-restore/)) rather than only
  discovering a restore problem during a real incident.
- Capture the failure list and re-run just the failed subset once the underlying issue (e.g. an
  LFS problem — see [../../docs/lfs.md](../../docs/lfs.md)) is resolved.
