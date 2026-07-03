import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findOrphanDirs, mirrorDirName, moveToDeleted } from '../../src/mirror/orphans.js';
import { pathExists } from '../../src/utils/fs.js';

describe('mirror/orphans', () => {
  let backupDir: string;

  beforeEach(async () => {
    backupDir = await mkdtemp(path.join(os.tmpdir(), 'gh-helix-orphans-test-'));
  });

  afterEach(async () => {
    await rm(backupDir, { recursive: true, force: true });
  });

  /** Repos are ordinary working-tree clones, so a `.git` subdirectory is what marks a real repo. */
  async function makeRepoDir(name: string): Promise<void> {
    await mkdir(path.join(backupDir, name, '.git'), { recursive: true });
  }

  it('derives repository directory names (no suffix -- these are working-tree clones)', () => {
    expect(mirrorDirName('widget')).toBe('widget');
  });

  it('finds local repo directories that no longer exist remotely', async () => {
    await makeRepoDir('widget');
    await makeRepoDir('gadget');

    const orphans = await findOrphanDirs(backupDir, ['widget']);
    expect(orphans).toEqual(['gadget']);
  });

  it('ignores directories that are not actually Git repositories', async () => {
    // No `.git` subdirectory -- e.g. leftover clutter, not something backup ever created.
    await mkdir(path.join(backupDir, 'not-a-repo'), { recursive: true });

    const orphans = await findOrphanDirs(backupDir, []);
    expect(orphans).toEqual([]);
  });

  it('ignores the _deleted directory itself', async () => {
    await mkdir(path.join(backupDir, '_deleted'));
    const orphans = await findOrphanDirs(backupDir, []);
    expect(orphans).toEqual([]);
  });

  it('moves an orphan into _deleted', async () => {
    await makeRepoDir('gadget');
    const result = await moveToDeleted(backupDir, 'gadget');

    expect(await pathExists(result.destination)).toBe(true);
    expect(await pathExists(path.join(backupDir, 'gadget'))).toBe(false);
    expect(result.destination).toContain('_deleted');
    expect(result.staleSourceRemaining).toBeUndefined();
  });
});
