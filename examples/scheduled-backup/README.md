# Example: scheduled backup

Running `gh-helix backup` unattended, with monitoring, on a recurring schedule. Platform-specific
scheduler setup lives in [../windows](../windows/), [../linux](../linux/), and
[../macos](../macos/) — this example covers the parts that are the same everywhere: exit codes,
logging, and alerting.

## Configuration

Use `config.json` for the non-secret baseline (safe to commit) and `.env` for the token only:

```json
// config.json
{
  "GITHUB_ORG": "my-org",
  "BACKUP_DIRECTORY": "D:/GitHubBackups",
  "MAX_PARALLEL": 8
}
```

```bash
# .env (git-ignored)
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
```

## Command

```bash
gh-helix backup --log-file D:/GitHubBackups/logs/backup-$(date +%Y%m%d-%H%M%S).log
```

`--log-file` writes plain-text (no ANSI color codes), timestamped output — safe to redirect
straight into a scheduler's log capture.

## Exit code handling

Every gh-helix command uses the same [exit code contract](../../docs/cli-reference.md#exit-codes),
designed specifically for schedulers:

```bash
gh-helix backup --log-file backup.log
case $? in
  0) echo "backup: success" ;;
  1) echo "backup: partial failure — check backup.log" ; send_alert "gh-helix partial failure" ;;
  2) echo "backup: auth error" ; send_alert "gh-helix auth failure" ;;
  3) echo "backup: config error" ; send_alert "gh-helix misconfigured" ;;
  4) echo "backup: fatal error" ; send_alert "gh-helix fatal error" ;;
esac
```

`send_alert` is a placeholder for whatever your environment uses (Slack webhook, PagerDuty, an
email step in CI, etc.) — gh-helix intentionally has no built-in notification integration; wire
its exit code into whatever you already use.

## Recommended schedule

Backup frequency should match how much data loss is acceptable between runs — hourly for
active orgs where fresh commits matter, daily is a reasonable default otherwise. Avoid scheduling
two invocations closer together than the org typically takes to back up — an overlapping run will
hit the [lock](../../docs/locking.md) and exit `4`, which is correct behavior, not a bug to
suppress.

## Replicating the backup directory off-host

gh-helix does not replicate `BACKUP_DIRECTORY` itself — add a sync step *after* a successful
backup:

```bash
gh-helix backup --log-file backup.log
if [ $? -le 1 ]; then   # 0 or 1: mirrors were updated even if some repos failed
  aws s3 sync D:/GitHubBackups s3://my-backup-bucket/gh-helix/ --delete
fi
```

See [../../docs/disaster-recovery.md#runbook-the-backup-host-itself-is-gone](../../docs/disaster-recovery.md#runbook-the-backup-host-itself-is-gone).

## Best practices

- Alert on exit codes `2`, `3`, and `4` immediately (these mean the run largely or entirely didn't
  happen). Alert on sustained `1` (partial failures) rather than every single occurrence, since a
  single transient repo failure is expected occasionally and self-heals on the next run.
- Keep `--log-file` output (rotate/retain it) — it's the first thing to check when investigating
  a failure after the fact.
- Run `gh-helix status` on a separate, more frequent schedule than `backup` itself for
  lightweight health monitoring between full runs.
