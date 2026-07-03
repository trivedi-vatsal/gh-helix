# Performance

## Design decisions that affect performance

- **Paginated, cached discovery** — repository listing never materializes an entire org's worth
  of pages in memory at once, and is cached for 10 minutes so back-to-back commands don't
  re-query the API. See [Repository Discovery](repository-discovery.md).
- **Incremental mirrors** — after the first run, every subsequent `backup` only clones what's
  missing and fetches what changed (`git remote update --prune`), not a full re-clone.
- **Parallel workers** — Git operations across repositories run concurrently, bounded by
  `MAX_PARALLEL` (default 5).
- **`status` avoids a filesystem walk** — disk usage comes from GitHub's own reported repository
  size (`sizeKb`), not `du`-style recursion through every mirror's object files. This is what
  keeps `status` fast at large repository counts, at the cost of being an approximation (GitHub's
  size figure vs. actual on-disk size, which includes LFS objects and Git's own packing
  overhead).

## Benchmark methodology

**Status: no benchmark numbers have been captured yet on this codebase.** The table below is a
placeholder structure — every number in it needs to be filled in by actually running the
scenarios described, not assumed. This section documents *how* to produce trustworthy numbers,
so the first real benchmark run can fill in the table without redesigning the methodology.

### How to run a benchmark

1. Pick (or synthesize) an organization with a known repository count and LFS mix.
2. Record hardware: CPU (cores), RAM, disk type (SSD/HDD/network volume), network bandwidth to
   GitHub, OS.
3. Clear any existing `BACKUP_DIRECTORY` and discovery cache (a first run is a cold-start
   measurement; a second run against the same org, unchanged, is a warm/incremental measurement —
   report both, they differ by roughly an order of magnitude).
4. Time the run:
   ```bash
   time gh-helix backup --report bench-report.json
   ```
5. Record from `bench-report.json` / the printed summary: `elapsedTimeMs`, `totalRepositories`,
   `cloned`, `updated`, `failed`, and cross-reference with `du -sh BACKUP_DIRECTORY` for actual
   on-disk size (separately from GitHub's reported `sizeKb` total from `status`).
6. Repeat at a few `MAX_PARALLEL` values (e.g. 3, 5, 10, 20) to find the knee of the curve for
   your network/disk combination — see [Parallel worker recommendations](#parallel-worker-recommendations)
   below.
7. Monitor peak memory (`/usr/bin/time -v` on Linux, Task Manager on Windows) and peak disk usage
   during the run, not just at the end.

### Benchmark matrix (placeholder — fill in from real runs)

| Repository count | Hardware | Cold-start runtime | Warm/incremental runtime | Peak memory | Disk usage |
| --- | --- | --- | --- | --- | --- |
| 100 | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ |
| 1,000 | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ |
| 5,000 | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ |
| 10,000 | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ |

If you run this benchmark, please contribute your numbers (with hardware/network details) via a
PR to this file — see [../CONTRIBUTING.md](../CONTRIBUTING.md). Real numbers from real orgs,
across different hardware and network conditions, are far more useful here than a single
maintainer-run synthetic benchmark would be.

## Parallel worker recommendations

`MAX_PARALLEL` (default `5`) is the main performance tuning knob. General guidance, to be
validated against the benchmark matrix above once real numbers exist:

- **Low values (2-5)**: safer default for constrained environments (shared CI runners, limited
  bandwidth, rate-limit-sensitive tokens). Lower risk of overwhelming disk I/O on spinning disks
  or slow network shares.
- **Higher values (10-20+)**: worthwhile on fast local SSDs with good bandwidth to GitHub and a
  large repository count, where the bottleneck is more likely to be per-request latency than
  local resource contention.
- GitHub's REST API has its own rate limits (see `gh-helix health`'s API connectivity check,
  which reports `remaining/limit`) — very high parallelism mostly helps the Git clone/fetch
  phase, not discovery (which is a small, fixed number of paginated list calls regardless of
  `MAX_PARALLEL`).
- LFS fetches run per-repository after that repository's clone/update, inheriting the same
  concurrency bound — an LFS-heavy org may see more benefit from tuning this than a
  small-repositories, no-LFS org.

There's no single correct value — start at the default, watch host CPU/disk/network utilization
during a real run, and adjust from there.

## Memory usage

Discovery pagination (`client.paginate.iterator`) is specifically designed to avoid holding every
page of an org's repository list in memory simultaneously — this is the main scale lever for
memory on very large orgs. Per-repository processing (clone/update/LFS/verify) shells out to
`git`/`git-lfs` subprocesses rather than doing Git object manipulation in-process, so gh-helix's
own Node.js heap usage does not scale with repository *size* (only with repository *count*, and
even then only proportionally to `MAX_PARALLEL` in-flight operations at once).

## Disk usage

Mirrors (`git clone --mirror`) store every ref, branch, tag, and note — this is by design (see
[ADR-0001](adr/0001-use-git-mirror.md)) and will generally be somewhat larger than a single
working clone's `.git` directory, though Git's own packing keeps this close to the size of the
underlying object data rather than the size of an equivalent number of separate clones. LFS
objects, when fetched, are stored per-mirror and are not deduplicated across repositories.

## See also

- [Configuration: MAX_PARALLEL](configuration.md#max_parallel)
- [Repository Discovery](repository-discovery.md)
- [Testing](testing.md) for how to run the existing test suite, which is a reasonable proxy for
  "is the local dev environment fast enough to iterate on this."
