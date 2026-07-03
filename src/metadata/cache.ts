import path from 'node:path';
import type { RemoteRepo } from '../api/types.js';
import { logger } from '../logger/logger.js';
import { atomicWriteFile, ensureDir } from '../utils/fs.js';
import { quarantineCorruptFile, readJsonFile } from '../utils/jsonFile.js';
import { METADATA_DIR_NAME, mirrorDirName } from '../utils/paths.js';
import { recoverPendingTransactions } from './transaction.js';

const CACHE_FILE_NAME = 'repositories.json';
const LEGACY_STATE_FILE_NAME = '.backup-state.json';

/** Default staleness window before a cached discovery is considered outdated. */
export const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000;

/** A cached repository entry: everything discovered from the API, plus its local mirror directory. */
export interface CachedRepoEntry extends RemoteRepo {
  localDir: string;
}

/** Cached repository discovery, persisted so repeat runs don't always re-hit the GitHub API. */
export interface RepositoriesCache {
  fetchedAt: string | null;
  /** Keyed by stable GitHub repository ID -- this is how renames are detected across runs. */
  repos: Record<string, CachedRepoEntry>;
}

/** Legacy `.backup-state.json` shape from this project's earlier "gh-org-backup" 1.x release, kept only for migration. */
interface LegacyState {
  lastSyncAt: string | null;
  repos: Record<string, { name: string; nameWithOwner: string; localDir: string }>;
}

function emptyCache(): RepositoriesCache {
  return { fetchedAt: null, repos: {} };
}

function metadataDir(backupDirectory: string): string {
  return path.join(backupDirectory, METADATA_DIR_NAME);
}

/** Absolute path to `.metadata/repositories.json` for a backup directory. */
export function cachePath(backupDirectory: string): string {
  return path.join(metadataDir(backupDirectory), CACHE_FILE_NAME);
}

function legacyStatePath(backupDirectory: string): string {
  return path.join(backupDirectory, LEGACY_STATE_FILE_NAME);
}

/**
 * Migrates a pre-2.0 `.backup-state.json` file into the shape of a fresh cache.
 * Only name/ownership/localDir are known from the legacy file; the rest of each
 * entry's fields are filled in on the next successful discovery.
 */
function migrateLegacyState(legacy: LegacyState): RepositoriesCache {
  const repos: Record<string, CachedRepoEntry> = {};
  for (const [id, entry] of Object.entries(legacy.repos)) {
    repos[id] = {
      id,
      name: entry.name,
      nameWithOwner: entry.nameWithOwner,
      localDir: entry.localDir,
      sshUrl: '',
      cloneUrl: '',
      htmlUrl: '',
      isArchived: false,
      isFork: false,
      isDisabled: false,
      createdAt: null,
      updatedAt: legacy.lastSyncAt ?? '',
      pushedAt: null,
      defaultBranch: 'main',
      sizeKb: 0,
    };
  }
  return { fetchedAt: legacy.lastSyncAt, repos };
}

/**
 * Loads the repository discovery cache, migrating a legacy `.backup-state.json`
 * (from this project's earlier "gh-org-backup" 1.x release) the first time it's
 * found if no new-style cache exists yet.
 *
 * A missing file is normal (e.g. first run) and returns an empty cache silently.
 * A file that exists but fails to parse is *not* silently swallowed: it's moved
 * aside for forensics and a warning is logged, since that usually means an
 * interrupted write or disk issue rather than "nothing has run yet".
 */
export async function loadCache(backupDirectory: string): Promise<RepositoriesCache> {
  await recoverPendingTransactions(metadataDir(backupDirectory));
  const file = cachePath(backupDirectory);
  const result = await readJsonFile<Partial<RepositoriesCache>>(file);

  if (result.status === 'ok') {
    return { fetchedAt: result.value.fetchedAt ?? null, repos: result.value.repos ?? {} };
  }

  if (result.status === 'corrupt') {
    const quarantined = await quarantineCorruptFile(file);
    logger.warn(
      `Discovery cache at ${file} is corrupted (${result.error.message}) and has been reset` +
        (quarantined ? ` -- the bad file was preserved at ${quarantined}.` : '.'),
    );
    return emptyCache();
  }

  const legacyFile = legacyStatePath(backupDirectory);
  const legacyResult = await readJsonFile<LegacyState>(legacyFile);
  if (legacyResult.status === 'ok') {
    return migrateLegacyState(legacyResult.value);
  }
  if (legacyResult.status === 'corrupt') {
    logger.warn(
      `Legacy state file at ${legacyFile} is corrupted (${legacyResult.error.message}) and was ignored.`,
    );
  }

  return emptyCache();
}

/** Persists the repository discovery cache to `.metadata/repositories.json` atomically. */
export async function saveCache(backupDirectory: string, cache: RepositoriesCache): Promise<void> {
  await ensureDir(metadataDir(backupDirectory));
  await atomicWriteFile(cachePath(backupDirectory), JSON.stringify(cache, null, 2));
}

/** True if the cache was fetched within `maxAgeMs` of now. */
export function isCacheFresh(cache: RepositoriesCache, maxAgeMs: number): boolean {
  if (!cache.fetchedAt) return false;
  const age = Date.now() - Date.parse(cache.fetchedAt);
  return Number.isFinite(age) && age >= 0 && age < maxAgeMs;
}

/** Builds a fresh cache from a live discovery result. */
export function buildCache(repos: RemoteRepo[]): RepositoriesCache {
  const entries: Record<string, CachedRepoEntry> = {};
  for (const repo of repos) {
    entries[repo.id] = { ...repo, localDir: mirrorDirName(repo.name) };
  }
  return { fetchedAt: new Date().toISOString(), repos: entries };
}

/** Reconstructs `RemoteRepo` objects from a cache, for use when a live API call is skipped. */
export function cacheToRemoteRepos(cache: RepositoriesCache): RemoteRepo[] {
  return Object.values(cache.repos).map(({ localDir: _localDir, ...repo }) => repo);
}
