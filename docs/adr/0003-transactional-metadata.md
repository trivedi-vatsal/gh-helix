# 0003. Transactional, journaled metadata writes

## Status

Accepted

## Context

A single `backup` run needs to update three related files: `repositories.json` (discovery
cache/rename tracking), `manifest.json` (this run's full detail), and `last-run.json` (a light
summary). If these were written independently with plain atomic-per-file writes (temp + rename,
no coordination across files), a crash between writing the first and second file would leave
`.metadata/` internally inconsistent — e.g., a `manifest.json` reflecting a rename that
`repositories.json` hasn't recorded yet. The next run would have no reliable way to know which
files are "ahead."

## Decision

Multi-file metadata writes go through a single journaled transaction
(`writeMetadataTransaction`): every file is written to a temp sibling and fsynced, a journal
listing all pending temp→final renames is built and fsynced *before* any rename happens, then
renames are applied and the journal is deleted. Every metadata read/write path calls
`recoverPendingTransactions` first, replaying (or discarding, if corrupt) any journal left behind
by a crashed prior process. Full mechanics: [Transaction Model](../transaction-model.md).

## Alternatives considered

- **Independent atomic writes per file, no journal.** Rejected — solves single-file corruption
  but not multi-file consistency, which is the actual problem (see Context above).
- **An embedded database (SQLite).** Rejected: adds a binary dependency and a non-human-readable
  storage format for what is fundamentally a small amount of state (repository list + one run's
  manifest), in exchange for transactional guarantees that a journal-based file writer already
  provides at this scale. Losing plain-JSON greppability/diffability was judged a real cost — see
  [Architecture: Extension points](../../README.md#extension-points), which specifically depends
  on `.metadata/*.json` being directly readable by external tooling without a database driver.
- **Write-ahead log with a single combined file** (one big JSON blob instead of three files).
  Rejected: `last-run.json` exists specifically so `status` can read a small file instead of the
  full manifest on large orgs (see [Metadata: last-run.json](../metadata.md#last-runjson)) — 
  combining everything into one file would reintroduce the cost this split avoids.

## Consequences

- A crash at any point during a `backup` run's final metadata write is fully recoverable by
  simply running any gh-helix command again — no manual repair, no separate `repair` command.
- Every metadata file remains plain, versioned JSON, readable by `cat`/`jq`/any JSON parser, with
  no schema migration tooling required beyond what's already documented in
  [Metadata](../metadata.md).
- The journal mechanism adds write overhead (extra fsync calls) compared to a naive single-file
  write — judged acceptable since metadata writes happen once per `backup` run, not per
  repository.

## Tradeoffs

This trades a small amount of write-path complexity and I/O overhead for strong consistency
guarantees without adopting a database dependency — appropriate given the actual data volume
(a handful of JSON files, not a high-frequency transactional workload).
