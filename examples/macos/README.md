# Example: macOS

macOS-specific setup notes. gh-helix's toolchain (Node 22+, Git, Git LFS) is identical to Linux;
this covers Homebrew installation and `launchd` scheduling. Note: macOS isn't currently covered by
CI (see [../../docs/installation.md#platform-notes](../../docs/installation.md#platform-notes)),
though nothing in gh-helix is platform-specific beyond standard Node/Git behavior.

## Prerequisites (Homebrew)

```bash
brew install node git git-lfs
git lfs install
```

Verify:

```bash
node --version
git --version
git lfs version
```

## Scheduling with launchd

`~/Library/LaunchAgents/com.example.gh-helix-backup.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.example.gh-helix-backup</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/Users/you/gh-helix/dist/cli.js</string>
        <string>backup</string>
        <string>--log-file</string>
        <string>/Users/you/GitHubBackups/logs/backup.log</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/you/gh-helix</string>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>2</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>/Users/you/GitHubBackups/logs/launchd-stdout.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/you/GitHubBackups/logs/launchd-stderr.log</string>
</dict>
</plist>
```

Load it:

```bash
launchctl load ~/Library/LaunchAgents/com.example.gh-helix-backup.plist
launchctl start com.example.gh-helix-backup   # run once immediately, to test
```

Check the logs at the paths above for output and gh-helix's own
[exit code](../../docs/cli-reference.md#exit-codes) behavior (visible via
`launchctl list com.example.gh-helix-backup`, which shows the last exit status).

## Apple Silicon note

If Homebrew is installed under `/opt/homebrew` (default on Apple Silicon) rather than
`/usr/local`, adjust the `node` path in the `plist` accordingly (`which node` to confirm).

## Best practices

- `launchd` agents run in the user's context by default and won't fire if the user isn't logged
  in — for a headless/server Mac, consider a `LaunchDaemon` (system-level, in
  `/Library/LaunchDaemons/`) instead, running as a dedicated service account.
- Store `GITHUB_TOKEN` in `.env` with restrictive permissions (`chmod 600 .env`), not directly in
  the `plist`.
- Same replication guidance as other platforms applies — see
  [../../docs/disaster-recovery.md#protecting-the-backup-host](../../docs/disaster-recovery.md#protecting-the-backup-host).
