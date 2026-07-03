# Example: Windows

Windows-specific setup notes. General installation: [../../docs/installation.md](../../docs/installation.md).

## Paths

Use forward slashes in `BACKUP_DIRECTORY`, in both `.env` and `config.json`:

```bash
BACKUP_DIRECTORY=D:/GitHubBackups
```

This avoids backslash-escaping ambiguity (`\` is an escape character in JSON strings, and can be
misinterpreted in `.env` parsing) — Node's `path` module accepts forward slashes natively on
Windows, so there's no downside.

## Prerequisites

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
winget install GitHub.GitLFS
```

Verify:

```powershell
node --version
git --version
git lfs version
```

## Scheduling with Task Scheduler

1. Build gh-helix (`npm run build`) and confirm `node dist\cli.js --help` works.
2. Create a wrapper script, `backup.ps1`:

   ```powershell
   Set-Location "D:\gh-helix"
   $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
   & node dist\cli.js backup --log-file "D:\GitHubBackups\logs\backup-$stamp.log"
   exit $LASTEXITCODE
   ```

3. Open Task Scheduler → **Create Task** (not "Basic Task", so you get access to exit-code-based
   conditions):
   - **General**: run whether user is logged on or not; run with highest privileges only if
     required by your disk permissions.
   - **Triggers**: your desired schedule (e.g. daily at 02:00).
   - **Actions**: Program/script `powershell.exe`, arguments
     `-NoProfile -ExecutionPolicy Bypass -File "D:\gh-helix\backup.ps1"`.
   - **Settings**: enable "If the task fails, restart every..." if you want automatic retry on
     transient failures.
4. Check the task's **Last Run Result** and the log file after the first scheduled run.

## Expected output

Identical CLI output to any other platform — see [../basic-backup](../basic-backup/). Task
Scheduler's "Last Run Result" will show a non-zero value matching gh-helix's
[exit code](../../docs/cli-reference.md#exit-codes) on failure.

## Best practices

- Store `.env`/`config.json` outside of any folder synced by OneDrive/similar — sync clients can
  interfere with the atomic file operations gh-helix relies on for `.metadata/` (see
  [../../docs/transaction-model.md](../../docs/transaction-model.md)) if the same directory is
  also being actively synced by another process.
- The directory-fsync step in gh-helix's metadata transaction writer is best-effort and not
  reliably supported on Windows filesystems — this doesn't weaken crash recovery (the journal
  itself is still fsynced), but it's worth knowing if you're auditing durability guarantees; see
  [../../docs/installation.md#platform-notes](../../docs/installation.md#platform-notes).
- Grant the Task Scheduler service account explicit write permissions on `BACKUP_DIRECTORY` if
  running as a dedicated service account rather than an interactive user.
