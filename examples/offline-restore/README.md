# Example: fully offline restore

`gh-helix restore` never contacts GitHub — this example demonstrates restoring a repository with
no network access at all (airplane mode, an isolated recovery environment, or GitHub genuinely
down). Full workflow: [../../docs/restore-workflow.md](../../docs/restore-workflow.md).

## Prerequisites

- A local mirror already exists at `BACKUP_DIRECTORY/<repo>.git` (from a prior `backup` run — the
  mirror itself must already be on the machine you're restoring on, or copied there via any
  offline means, e.g. an external drive).
- No `GITHUB_TOKEN`/`GH_TOKEN` is required — `restore` doesn't resolve a token at all.

## Command

```bash
# disconnect from the network, or just trust that restore won't use it
gh-helix restore my-repo --destination ./restored/my-repo
```

## Expected output

```
✓ Restored my-repo -> ./restored/my-repo (LFS: rehydrated)
```

or, for a repository with no LFS content:

```
✓ Restored my-repo -> ./restored/my-repo (LFS: not used)
```

Exit code `0`.

## Verifying no network was used

```bash
# Linux/macOS: block outbound network for the process, restore should still succeed
sudo iptables -A OUTPUT -m owner --uid-owner $(id -u) -j DROP   # illustrative, adjust to your setup
gh-helix restore my-repo --destination ./restored/my-repo
sudo iptables -D OUTPUT -m owner --uid-owner $(id -u) -j DROP
```

(This is a demonstration, not something you need to run routinely — the point is that `restore`'s
correctness doesn't depend on network availability, by design; see
[ADR-0002: Mirror-first architecture](../../docs/adr/0002-mirror-first-architecture.md).)

## Best practices

- Periodically rehearse an offline restore (see this example) *before* an actual incident — it's
  the only way to be confident the mirrors are genuinely usable under the conditions that matter.
- If restoring on a fresh machine, make sure `git` (and `git-lfs`, if the repository uses it) are
  installed first — `restore` still shells out to them locally, it just never reaches out to
  GitHub. See [../../docs/installation.md#prerequisites](../../docs/installation.md#prerequisites).
