import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Octokit } from '@octokit/rest';
import { discoverRepos, discoverReposResilient, listOrgRepos } from '../../src/api/discover.js';

function fakeRepoItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: 'widget',
    full_name: 'org/widget',
    ssh_url: 'git@github.com:org/widget.git',
    clone_url: 'https://github.com/org/widget.git',
    html_url: 'https://github.com/org/widget',
    archived: false,
    fork: false,
    disabled: false,
    created_at: '2020-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    pushed_at: '2024-01-01T00:00:00Z',
    default_branch: 'main',
    size: 42,
    ...overrides,
  };
}

function fakeClient(items: ReturnType<typeof fakeRepoItem>[], orgAccessOk = true): Octokit {
  const listForOrg = vi.fn();
  return {
    rest: {
      repos: { listForOrg },
      orgs: {
        get: orgAccessOk
          ? vi.fn().mockResolvedValue({})
          : vi.fn().mockRejectedValue(new Error('Bad credentials')),
      },
    },
    paginate: {
      iterator: () => ({
        async *[Symbol.asyncIterator]() {
          yield { data: items };
        },
      }),
    },
  } as unknown as Octokit;
}

describe('api/discover: listOrgRepos', () => {
  it('maps API fields onto RemoteRepo', async () => {
    const client = fakeClient([fakeRepoItem()]);
    const repos = await listOrgRepos(client, 'org');

    expect(repos).toEqual([
      {
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
        sizeKb: 42,
      },
    ]);
  });
});

describe('api/discover: discoverRepos (cache integration)', () => {
  let backupDir: string;

  beforeEach(async () => {
    backupDir = await mkdtemp(path.join(os.tmpdir(), 'gh-helix-discover-test-'));
  });

  afterEach(async () => {
    await rm(backupDir, { recursive: true, force: true });
  });

  it('calls the API on a cold cache and persists the result', async () => {
    const client = fakeClient([fakeRepoItem()]);
    const repos = await discoverRepos(client, 'org', backupDir);
    expect(repos).toHaveLength(1);

    // A second call within the TTL should not need the API again --
    // proven by passing a client whose iterator would throw if invoked.
    const explodingClient = {
      rest: { repos: { listForOrg: vi.fn() } },
      paginate: {
        iterator: () => {
          throw new Error('API should not be called when the cache is fresh');
        },
      },
    } as unknown as Octokit;

    const cached = await discoverRepos(explodingClient, 'org', backupDir);
    expect(cached).toHaveLength(1);
    expect(cached[0]?.name).toBe('widget');
  });

  it('bypasses a fresh cache when forceRefresh is set', async () => {
    const client = fakeClient([fakeRepoItem()]);
    await discoverRepos(client, 'org', backupDir);

    const refreshedClient = fakeClient([
      fakeRepoItem({ id: 2, name: 'gadget', full_name: 'org/gadget' }),
    ]);
    const repos = await discoverRepos(client, 'org', backupDir, { forceRefresh: false });
    expect(repos[0]?.name).toBe('widget'); // cache still fresh, API not re-queried

    const refreshed = await discoverRepos(refreshedClient, 'org', backupDir, {
      forceRefresh: true,
    });
    expect(refreshed[0]?.name).toBe('gadget');
  });
});

describe('api/discover: discoverReposResilient', () => {
  let backupDir: string;

  beforeEach(async () => {
    backupDir = await mkdtemp(path.join(os.tmpdir(), 'gh-helix-discover-resilient-test-'));
  });

  afterEach(async () => {
    await rm(backupDir, { recursive: true, force: true });
  });

  it('reports not degraded when the API is reachable', async () => {
    const client = fakeClient([fakeRepoItem()]);
    const result = await discoverReposResilient(client, 'org', backupDir);

    expect(result.degraded).toBe(false);
    expect(result.repos).toHaveLength(1);
  });

  it('falls back to the cache when the API is unreachable but a cache exists', async () => {
    const workingClient = fakeClient([fakeRepoItem()]);
    await discoverReposResilient(workingClient, 'org', backupDir); // populate the cache

    const brokenClient = fakeClient([fakeRepoItem()], false); // orgs.get rejects
    const result = await discoverReposResilient(brokenClient, 'org', backupDir);

    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toContain('Bad credentials');
    expect(result.repos).toHaveLength(1);
    expect(result.repos[0]?.name).toBe('widget');
  });

  it('throws when the API is unreachable and there is no cache to fall back to', async () => {
    const brokenClient = fakeClient([fakeRepoItem()], false);
    await expect(discoverReposResilient(brokenClient, 'org', backupDir)).rejects.toThrow(
      'Bad credentials',
    );
  });
});
