# GitHub Enterprise Server

gh-helix works against GitHub Enterprise Server (GHES) as well as github.com — nothing about the
core backup/restore logic is github.com-specific; only the API base URL and, optionally, the `gh`
CLI fallback host need to be told where your instance lives.

## Configuration

| Variable | Purpose |
| --- | --- |
| `GITHUB_API_URL` | REST API base URL, passed straight through as Octokit's `baseUrl`. For GHES this is typically `https://github.mycompany.com/api/v3`. |
| `GH_HOST` | Bare hostname (no scheme, no path), used **only** as the `gh auth token` CLI fallback's target host — irrelevant if you're providing `GITHUB_TOKEN`/`GH_TOKEN` directly. |

```bash
# .env
GITHUB_ORG=my-org
BACKUP_DIRECTORY=D:/GitHubBackups
GITHUB_API_URL=https://github.mycompany.com/api/v3
GH_HOST=github.mycompany.com
GITHUB_TOKEN=ghp_xxx
```

`GITHUB_API_URL` is never hardcoded anywhere in gh-helix — when it's unset, Octokit's own default
(`https://api.github.com`) applies automatically, which is why github.com requires no extra
configuration at all.

## Token

Generate a personal access token **from your GHES instance**, not github.com — the two are
separate credential systems even if your organization has both. Scope requirements are the same
as github.com: read access to the organization's repositories. See
[Authentication](authentication.md).

If you're relying on the `gh auth token` fallback (no `GITHUB_TOKEN`/`GH_TOKEN` set), you must
first run `gh auth login --hostname <your-ghes-host>` so the `gh` CLI has a session for that host;
`GH_HOST` then tells gh-helix's fallback which host's session to ask for.

## Cloning

Git clone/fetch URLs come from the repository objects returned by the GHES REST API itself
(`cloneUrl`/`sshUrl`), so they automatically point at your GHES instance — no separate Git host
configuration is needed beyond `GITHUB_API_URL`.

## Verifying the setup

```bash
gh-helix health
```

The "API connectivity" check calls `rateLimit.get()` against whatever `GITHUB_API_URL` resolves
to, so a `pass` here confirms the Enterprise endpoint (and token) are both correctly configured
before you run a real backup.

## See also

- [Configuration](configuration.md)
- [Authentication](authentication.md)
- [examples/github-enterprise](../examples/github-enterprise/)
