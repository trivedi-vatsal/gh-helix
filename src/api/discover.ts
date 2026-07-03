import type { Octokit } from '@octokit/rest';
import {
  buildCache,
  cacheToRemoteRepos,
  DEFAULT_CACHE_TTL_MS,
  isCacheFresh,
  loadCache,
  saveCache,
} from '../metadata/cache.js';
import { verifyApiAccess } from './client.js';
import type { RemoteRepo } from './types.js';

/** Shape of a single item returned by `octokit.rest.repos.listForOrg`, inferred from the client. */
type OctokitRepo = Awaited<ReturnType<Octokit['rest']['repos']['listForOrg']>>['data'][number];

function mapRepo(item: OctokitRepo): RemoteRepo {
  return {
    id: String(item.id),
    name: item.name,
    nameWithOwner: item.full_name ?? item.name,
    sshUrl: item.ssh_url ?? '',
    cloneUrl: item.clone_url ?? item.html_url ?? '',
    htmlUrl: item.html_url ?? '',
    isArchived: item.archived ?? false,
    isFork: item.fork ?? false,
    isDisabled: item.disabled ?? false,
    createdAt: item.created_at ?? null,
    updatedAt: item.updated_at ?? '',
    pushedAt: item.pushed_at ?? null,
    defaultBranch: item.default_branch ?? 'main',
    sizeKb: item.size ?? 0,
  };
}

/**
 * Discovers every repository in a GitHub organization via the REST API,
 * paginating through results without materializing raw API pages in memory
 * longer than necessary -- important for organizations with 10,000+ repos.
 */
export async function listOrgRepos(client: Octokit, org: string): Promise<RemoteRepo[]> {
  const repos: RemoteRepo[] = [];
  const iterator = client.paginate.iterator(client.rest.repos.listForOrg, {
    org,
    type: 'all',
    per_page: 100,
  });

  for await (const { data } of iterator) {
    for (const item of data) {
      repos.push(mapRepo(item));
    }
  }

  return repos;
}

/** Options for {@link discoverRepos}. */
export interface DiscoverOptions {
  /** Bypass the cache and always call the GitHub API. */
  forceRefresh?: boolean;
  /** How long a cached discovery is considered fresh. Defaults to 10 minutes. */
  maxAgeMs?: number;
  /**
   * Whether a fresh discovery result is immediately persisted to
   * `.metadata/repositories.json`. Defaults to true. The `backup` command
   * sets this to false so it can instead include the cache in the same
   * metadata transaction as the run's manifest -- see requirement #5.
   */
  persistCache?: boolean;
}

/**
 * Discovers organization repositories, reusing a cached result from
 * `.metadata/repositories.json` when it's fresh enough -- avoiding a full API
 * listing call on every invocation, which matters for organizations with
 * thousands of repositories and for frequently-scheduled backup runs.
 */
export async function discoverRepos(
  client: Octokit,
  org: string,
  backupDirectory: string,
  options: DiscoverOptions = {},
): Promise<RemoteRepo[]> {
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_CACHE_TTL_MS;

  if (!options.forceRefresh) {
    const cache = await loadCache(backupDirectory);
    if (isCacheFresh(cache, maxAgeMs)) {
      return cacheToRemoteRepos(cache);
    }
  }

  const repos = await listOrgRepos(client, org);
  if (options.persistCache !== false) {
    await saveCache(backupDirectory, buildCache(repos));
  }
  return repos;
}

/** Result of {@link discoverReposResilient}. */
export interface ResilientDiscoverResult {
  repos: RemoteRepo[];
  /**
   * True if the GitHub API was unreachable or unauthorized and the result came
   * from the last cached discovery instead. New, renamed, and deleted repos
   * cannot be detected while this is true, and callers should avoid acting on
   * it as ground truth (e.g. orphan detection/deletion).
   */
  degraded: boolean;
  degradedReason?: string;
}

/**
 * Verifies API access and discovers repositories, but falls back to the last
 * cached discovery (ignoring cache freshness) instead of hard-failing when the
 * GitHub API is unreachable or the token has expired. A disaster-recovery tool
 * should still be able to update/verify previously known mirrors during a
 * GitHub outage rather than doing nothing at all -- it just can't detect
 * anything that changed on GitHub since the cache was last refreshed.
 *
 * Throws only when the API is unavailable *and* there is no cache to fall back
 * to (e.g. the very first run against an unreachable API).
 */
export async function discoverReposResilient(
  client: Octokit,
  org: string,
  backupDirectory: string,
  options: DiscoverOptions = {},
): Promise<ResilientDiscoverResult> {
  try {
    await verifyApiAccess(client, org);
    const repos = await discoverRepos(client, org, backupDirectory, options);
    return { repos, degraded: false };
  } catch (error) {
    const cache = await loadCache(backupDirectory);
    const cachedRepos = cacheToRemoteRepos(cache);
    if (cachedRepos.length === 0) throw error;

    const message = error instanceof Error ? error.message : String(error);
    return {
      repos: cachedRepos,
      degraded: true,
      degradedReason: `${message} (using cached discovery from ${cache.fetchedAt ?? 'an unknown time'})`,
    };
  }
}
