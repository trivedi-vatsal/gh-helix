# Examples

Practical, runnable-shaped scenarios for common gh-helix use cases. Each example is self-contained
with a `README.md` covering commands, configuration, expected output, and best practices.

| Example | Scenario |
| --- | --- |
| [basic-backup](basic-backup/) | The simplest possible first backup of an org |
| [scheduled-backup](scheduled-backup/) | Running `backup` unattended on a schedule (cron / Task Scheduler / CI) |
| [github-enterprise](github-enterprise/) | Pointing gh-helix at GitHub Enterprise Server |
| [offline-backup](offline-backup/) | What `backup` does — and doesn't do — when GitHub is unreachable |
| [offline-restore](offline-restore/) | Restoring a repository with zero network access |
| [restore-single-repository](restore-single-repository/) | Restoring one repository from its mirror |
| [restore-entire-organization](restore-entire-organization/) | Scripted restore of every mirrored repository |
| [docker](docker/) | Running gh-helix inside a container |
| [windows](windows/) | Windows-specific setup notes (paths, Task Scheduler) |
| [linux](linux/) | Linux-specific setup notes (systemd timer, cron) |
| [macos](macos/) | macOS-specific setup notes (launchd) |

Every example assumes gh-helix is already built (`npm run build`) or installed globally — see
[../docs/installation.md](../docs/installation.md) if you haven't done that yet.
