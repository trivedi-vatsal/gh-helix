import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RemoteRepo } from '../../src/api/types.js';
import {
  buildCache,
  cacheToRemoteRepos,
  isCacheFresh,
  loadCache,
  saveCache,
} from '../../src/metadata/cache.js';
import { pathExists } from '../../src/utils/fs.js';
import { logger } from '../../src/logger/logger.js';

function makeRepo(overrides: Partial<RemoteRepo> = {}): RemoteRepo {
  return {
    id: '1',
    name: 'widget',
    nameWithOwner: 'org/widget',
    sshUrl: 'git@github.com:org/widget.git',
    cloneUrl: 'https://github.com/org/widget.git',
    htmlUrl: 'https://github.com/org/widget',
    isArchived: false,
    isFork: false,
    isDisabled: false,
    createdAt: '2020-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    pushedAt: '2024-01-01T00:00:00Z',
    defaultBranch: 'main',
    sizeKb: 100,
    ...overrides,
  };
}

describe('metadata/cache', () => {
  let backupDir: string;

  beforeEach(async () => {
    backupDir = await mkdtemp(path.join(os.tmpdir(), 'gh-helix-cache-test-'));
  });

  afterEach(async () => {
    await rm(backupDir, { recursive: true, force: true });
  });

  it('builds a cache with a localDir derived from repo name', () => {
    const cache = buildCache([makeRepo()]);
    expect(cache.repos['1']?.localDir).toBe('widget');
    expect(cache.fetchedAt).not.toBeNull();
  });

  it('round-trips through save and load', async () => {
    const cache = buildCache([makeRepo()]);
    await saveCache(backupDir, cache);
    const loaded = await loadCache(backupDir);
    expect(loaded.repos['1']?.name).toBe('widget');
  });

  it('returns an empty cache when nothing has been saved yet', async () => {
    const loaded = await loadCache(backupDir);
    expect(loaded.fetchedAt).toBeNull();
    expect(loaded.repos).toEqual({});
  });

  it('migrates a legacy .backup-state.json when no new cache exists', async () => {
    const legacy = {
      lastSyncAt: '2023-06-01T00:00:00Z',
      repos: {
        '42': {
          name: 'legacy-repo',
          nameWithOwner: 'org/legacy-repo',
          localDir: 'legacy-repo.git',
        },
      },
    };
    await writeFile(path.join(backupDir, '.backup-state.json'), JSON.stringify(legacy), 'utf8');

    const loaded = await loadCache(backupDir);
    expect(loaded.fetchedAt).toBe('2023-06-01T00:00:00Z');
    expect(loaded.repos['42']?.name).toBe('legacy-repo');
    expect(loaded.repos['42']?.localDir).toBe('legacy-repo.git');
  });

  it('reconstructs RemoteRepo objects from a cache', () => {
    const cache = buildCache([makeRepo()]);
    const repos = cacheToRemoteRepos(cache);
    expect(repos).toHaveLength(1);
    expect(repos[0]).not.toHaveProperty('localDir');
    expect(repos[0]?.name).toBe('widget');
  });

  it('quarantines a corrupted cache file and warns instead of silently returning empty', async () => {
    const metadataDir = path.join(backupDir, '.metadata');
    await mkdir(metadataDir, { recursive: true });
    const cacheFile = path.join(metadataDir, 'repositories.json');
    await writeFile(cacheFile, '{ this is not json', 'utf8');

    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const loaded = await loadCache(backupDir);

    expect(loaded.fetchedAt).toBeNull();
    expect(loaded.repos).toEqual({});
    expect(warnSpy).toHaveBeenCalled();
    expect(await pathExists(cacheFile)).toBe(false); // moved aside, not left in place
    warnSpy.mockRestore();
  });

  it('treats a cache as fresh only within the max age window', () => {
    const fresh = buildCache([makeRepo()]);
    expect(isCacheFresh(fresh, 60_000)).toBe(true);

    const stale = { fetchedAt: new Date(Date.now() - 120_000).toISOString(), repos: {} };
    expect(isCacheFresh(stale, 60_000)).toBe(false);

    expect(isCacheFresh({ fetchedAt: null, repos: {} }, 60_000)).toBe(false);
  });
});
