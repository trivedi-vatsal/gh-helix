# 0001. Use `git clone --mirror` instead of a working clone

## Status

Accepted

## Context

gh-helix needs a local, on-disk copy of every repository in a GitHub organization that is
sufficient to fully reconstruct the repository if GitHub itself became unavailable. A standard
`git clone` produces a *working clone*: it checks out one branch's working tree, and by default
only tracks the branches that existed at clone time, with local remote-tracking refs
(`refs/remotes/origin/*`) rather than the full ref namespace. Tags, notes, and any refs that
aren't fetched by default are not guaranteed to be present, and further pulls/fetches can miss
newly created refs unless explicitly configured to track them.

## Decision

Every mirror is created and updated with `git clone --mirror` / `git remote update --prune`, not
a working clone.

`--mirror` clones **all** refs — every branch, tag, and note — into a bare repository, and sets
up the remote configuration so that a later `git remote update` fetches everything, including
propagating upstream deletions (`--prune`) so the mirror never accumulates refs for branches long
since deleted upstream. A bare, mirrored repository has no working tree at all, which is
irrelevant for a backup copy and saves the disk and I/O cost of maintaining one.

## Alternatives considered

- **Plain `git clone` per repository, fetching additional refs manually.** Rejected: requires
  ongoing, error-prone configuration (`remote.origin.fetch` refspecs) to approximate what
  `--mirror` gives for free, and still leaves a working tree checked out that serves no purpose
  for a backup copy.
- **`git clone --bare`.** Closer, but bare clones still default to a narrower refspec than
  mirrors and don't automatically prune deleted remote refs on update — `--mirror` is
  specifically the documented Git option for "keep a complete, byte-for-byte-equivalent copy of
  the remote's ref namespace."
- **GitHub's own repository export/migration API.** Considered and rejected as the *primary*
  mechanism — it's oriented around full-organization migration (issues, PRs, wiki, settings), not
  incremental, scheduled, Git-data-only backup; see [ADR-0009](0009-github-api.md) for the
  related decision on why gh-helix uses the plain REST API for discovery rather than a
  migration-oriented endpoint.

## Consequences

- Mirrors are true, complete copies — nothing to configure or forget to configure per repository.
- Mirrors are somewhat larger on disk than a single working clone would be, since every ref is
  present (see [Performance: Disk usage](../performance.md#disk-usage)).
- Restoring a *working* copy from a mirror is a separate, explicit step (`gh-helix restore`) —
  the mirror itself is not directly usable as a working directory. This is by design: it keeps
  the backup copy minimal and unambiguous, and makes "restore" a well-defined, testable operation
  rather than "the backup already happens to be usable, sort of."

## Tradeoffs

Bare mirrors trade a small amount of extra disk usage and an explicit restore step for
completeness and update simplicity — for a disaster-recovery tool, completeness dominates.
