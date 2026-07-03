# FAQ

**Does gh-helix delete anything on GitHub?**
No. gh-helix only reads from the GitHub REST API and clones/fetches over Git — it has no write
path to GitHub at all.

**Does gh-helix delete local mirrors?**
Never outright. A repository that disappears from GitHub has its local mirror *moved* into
`_deleted/<name>.git` (timestamp-suffixed on collision), not removed. See
[Disaster Recovery](disaster-recovery.md) and [ADR-0005](adr/0005-safe-directory-moves.md).

**Is it safe to `Ctrl+C` / kill gh-helix mid-run?**
Yes. Every stateful operation follows a stage-verify-commit pattern designed so the same command,
run again, either finishes or discards whatever was interrupted — no manual repair needed. See
[Architecture: Failure recovery](architecture.md#failure-recovery).

**Can I run two `backup` commands at once against the same directory?**
No — they'll conflict on the cross-process lock and the second one fails immediately with exit
code 4, rather than racing. You *can* run gh-helix against two different `BACKUP_DIRECTORY`
values (e.g. two different orgs) at the same time. See [Locking](locking.md).

**Does gh-helix work without a GitHub token?**
`backup`, `status`, `list`, and `clean` need a token (or SSH keys, for the Git operations
specifically — see [Authentication](authentication.md#how-the-token-reaches-git)) to talk to the
GitHub API. `restore` and `verify` never need one — they only touch local mirrors.

**Does gh-helix support GitHub Enterprise Server?**
Yes — see [GitHub Enterprise Server](github-enterprise.md).

**Does gh-helix support GitLab / Bitbucket / other Git hosts?**
Not currently. See [Roadmap](roadmap.md).

**Why does `status` show a disk usage figure that doesn't match `du`?**
It's GitHub's own reported repository size (`sizeKb`), not a filesystem walk — deliberately, so
`status` stays fast on organizations with thousands of repositories. It's an approximation; see
[Repository Discovery](repository-discovery.md#live-discovery).

**Why didn't `backup` pick up a repository I just created on GitHub?**
Discovery is cached for up to 10 minutes by design. Pass `--refresh` for a guaranteed-current
view. See [Repository Discovery](repository-discovery.md#caching).

**A repository was renamed on GitHub — what happens to its mirror?**
It's detected automatically (by the repository's stable GitHub ID, not its name) and the local
directory is renamed to match, transactionally. See
[Backup Workflow: rename detection](backup-workflow.md#5-process-repositories-in-parallel).

**What happens to archived repositories?**
Cloned once like any other repository, then skipped on every subsequent run (archived repos can't
change), logged as `⚠ Archived repo skipped`.

**Why is a failed LFS fetch treated as a backup failure instead of a warning?**
Because a mirror missing its LFS objects isn't actually disaster-recoverable, even though its Git
history looks fine. See [Git LFS](lfs.md#why-a-failed-lfs-fetch-is-a-backup-failure).

**Can I exclude forks, or only back up forks?**
There's no dedicated fork filter yet — use `--include`/`--exclude` glob patterns on repository
name if your naming convention supports it, otherwise this is a gap; see
[Roadmap](roadmap.md).

**How many repositories can gh-helix handle?**
Discovery is paginated and cached, and `status`'s disk-usage figure avoids a filesystem walk
specifically so it stays fast well beyond 10,000 repositories. See
[Performance](performance.md).

**Does gh-helix upload mirrors to S3/Azure Blob/etc.?**
Not built in — this is an intentional, documented extension point rather than a missing feature
the maintainers forgot about. See [Architecture: Extension points](../README.md#extension-points)
and [Roadmap](roadmap.md). Pair gh-helix with your own sync step in a scheduled job; see
[examples/scheduled-backup](../examples/scheduled-backup/).

**Can gh-helix run as a long-lived daemon instead of a one-shot CLI command?**
Not currently — it's designed as a single async function per command, meant to be invoked by an
external scheduler (cron, Task Scheduler, CI). A daemon wrapper is a documented extension point.
See [Architecture: Extension points](../README.md#extension-points).

**Where do I report a security issue?**
See [SECURITY.md](../SECURITY.md) — please don't open a public issue for anything
credential/vulnerability-related.

**How do I contribute?**
See [CONTRIBUTING.md](../CONTRIBUTING.md) and [Testing](testing.md).
