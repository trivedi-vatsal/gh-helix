# Testing

## Test architecture

Tests live under `tests/`, mirroring `src/`'s layout, and run on [Vitest](https://vitest.dev/).

```
tests/
    api/discover.test.ts          # discovery, caching, degraded-mode fallback
    config/config.test.ts          # precedence, defaults, validation errors
    metadata/
        cache.test.ts               # repositories.json read/write, corruption handling
        lock.test.ts                  # staleness rules, force-lock, heartbeat
        manifest.test.ts               # manifest.json / last-run.json read/write
        transaction.test.ts             # journal write + crash-recovery replay
    mirror/
        auth.test.ts                 # ephemeral token injection env vars
        orphans.test.ts               # orphan detection + move-to-_deleted
        rename.test.ts                 # transactional rename (URL update, verify, move, rollback)
        restore.test.ts                 # offline restore, LFS pointer verification, resume-after-crash
    utils/
        filter.test.ts, fs.test.ts, jsonFile.test.ts, number.test.ts,
        retry.test.ts, safeMove.test.ts, time.test.ts
    integration/
        concurrency.test.ts            # real cross-process concurrency, via subprocess workers
    helpers/
        lockWorker.mts, restoreWorker.mts   # standalone worker scripts spawned by the integration test
```

### Unit tests

One file per source module (`api/`, `config/`, `metadata/`, `mirror/`, `utils/`), mocking I/O
where appropriate. These cover the logic documented in
[Architecture](architecture.md), [Locking](locking.md), [Transaction Model](transaction-model.md),
and [Repository Discovery](repository-discovery.md) — staleness rules, journal replay after a
simulated crash, corruption quarantine behavior, rename detection, LFS pointer-file scanning, and
so on.

### Integration tests

`tests/integration/concurrency.test.ts` is the one test in the suite that spawns **real separate
Node.js processes** (via `tests/helpers/lockWorker.mts` and `restoreWorker.mts`) rather than
simulating concurrency in-process. This is deliberate: the guarantees in
[Locking](locking.md) and the resumable staging logic in
[restore](restore-workflow.md) and [safe moves](architecture.md#failure-recovery) are
specifically about *cross-process* races (two independent `gh-helix` invocations, or a killed
process followed by a fresh one) — an in-process mock of `fs` calls wouldn't actually exercise the
atomic-filesystem-operation guarantees these features depend on.

### What's covered where

| Concern | Test file |
| --- | --- |
| Lock staleness (same-host PID check, cross-host TTL) | `metadata/lock.test.ts` |
| Lock force-break, heartbeat refresh | `metadata/lock.test.ts` |
| Two processes racing to acquire the same lock | `integration/concurrency.test.ts` |
| Metadata journal write + crash recovery | `metadata/transaction.test.ts` |
| Corrupt cache/manifest quarantine behavior | `metadata/cache.test.ts`, `metadata/manifest.test.ts` |
| Discovery cache freshness + degraded-mode fallback | `api/discover.test.ts` |
| Config precedence (env > .env > config.json) and validation | `config/config.test.ts` |
| Token injection never touching argv/`.git/config` | `mirror/auth.test.ts` |
| Orphan detection + safe move into `_deleted/` | `mirror/orphans.test.ts`, `utils/safeMove.test.ts` |
| Transactional rename (URL update → verify → move → rollback on failure) | `mirror/rename.test.ts` |
| Restore: LFS pointer detection, resume-after-crash via staging+marker | `mirror/restore.test.ts` |
| A restore interrupted and resumed across process boundaries | `integration/concurrency.test.ts` (via `restoreWorker.mts`) |
| `--include`/`--exclude` glob filtering, exclude-wins-over-include | `utils/filter.test.ts` |
| Exponential backoff timing/attempt count | `utils/retry.test.ts` |

## Running tests

```bash
npm test          # vitest run -- single pass, used in CI
npm run test:watch   # vitest -- watch mode for local development
```

Run a single file or pattern:

```bash
npx vitest run tests/metadata/lock.test.ts
npx vitest run -t "stale lock"
```

## Other local checks

These run alongside tests in CI ([.github/workflows/ci.yml](../.github/workflows/ci.yml)) and are
worth running locally before opening a PR:

```bash
npm run typecheck      # tsc --noEmit
npm run lint            # eslint
npm run format:check     # prettier --check .
npm run build              # tsc -p tsconfig.json, compiles to dist/
```

Auto-fixable issues:

```bash
npm run lint:fix
npm run format
```

## Writing new tests

- Put a new test next to its source module's mirrored path (e.g. a new function in
  `src/mirror/verify.ts` gets its test in `tests/mirror/verify.test.ts`, creating that file if it
  doesn't exist yet).
- Prefer a unit test unless the behavior specifically depends on real cross-process filesystem
  semantics (atomic rename races, lock acquisition races, resumable staging across a killed
  process) — those belong in `integration/concurrency.test.ts`, following the existing
  worker-script pattern in `tests/helpers/`.
- If you're testing crash-recovery behavior (transaction replay, resumable restore/move), assert
  both that recovery succeeds *and* that a partially-completed operation left the original data
  untouched until the final atomic commit — that's the actual guarantee being tested, not just
  "recovery ran without throwing."

## CI matrix

Tests run on both `ubuntu-latest` and `windows-latest` (see
[.github/workflows/ci.yml](../.github/workflows/ci.yml)) — this matters specifically because
directory-fsync behavior, cross-volume move fallbacks, and path handling differ between the two
platforms; see [Installation: Platform notes](installation.md#platform-notes).

## See also

- [CONTRIBUTING.md](../CONTRIBUTING.md)
- [Release Process](release-process.md)
- [Architecture: Failure recovery](architecture.md#failure-recovery)
