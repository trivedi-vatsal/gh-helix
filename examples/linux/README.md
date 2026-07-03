# Example: Linux

Linux-specific setup notes. General installation: [../../docs/installation.md](../../docs/installation.md).

## Prerequisites (Debian/Ubuntu)

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git git-lfs
git lfs install --system
```

Verify:

```bash
node --version
git --version
git lfs version
```

## cron

```cron
# /etc/cron.d/gh-helix-backup
0 2 * * * ghhelix cd /opt/gh-helix && /usr/bin/node dist/cli.js backup --log-file /var/backups/github/logs/backup-$(date +\%Y\%m\%d).log >> /var/log/gh-helix-cron.log 2>&1
```

Run as a dedicated `ghhelix` user with write access to `BACKUP_DIRECTORY`, not root.

## systemd timer (recommended over cron for better logging and dependency handling)

`/etc/systemd/system/gh-helix-backup.service`:

```ini
[Unit]
Description=gh-helix backup
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
User=ghhelix
WorkingDirectory=/opt/gh-helix
EnvironmentFile=/opt/gh-helix/.env
ExecStart=/usr/bin/node dist/cli.js backup --log-file /var/backups/github/logs/backup-%Y%m%d.log
```

`/etc/systemd/system/gh-helix-backup.timer`:

```ini
[Unit]
Description=Run gh-helix backup daily

[Timer]
OnCalendar=*-*-* 02:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now gh-helix-backup.timer
sudo systemctl status gh-helix-backup.timer
```

Check results:

```bash
sudo systemctl status gh-helix-backup.service
journalctl -u gh-helix-backup.service --since today
```

`journalctl`'s own exit-status reporting reflects gh-helix's
[exit code](../../docs/cli-reference.md#exit-codes) directly (`Type=oneshot` services report
their process exit code as the unit's result).

## Best practices

- Use `EnvironmentFile=` (as above) rather than embedding the token directly in the unit file —
  unit files under `/etc/systemd/system/` are often world-readable; restrict the `.env` file's
  permissions instead (`chmod 600`).
- `Persistent=true` on the timer ensures a missed run (e.g. host was off at 02:00) executes as
  soon as the system is next up, rather than waiting for the next scheduled time.
- Prefer the systemd timer over cron when available — `journalctl` gives you searchable,
  timestamped logs correlated with the exit code, without needing your own log redirection
  boilerplate.
