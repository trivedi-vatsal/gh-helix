import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadLastRun, loadManifest, writeManifest } from '../../src/metadata/manifest.js';
import type { BackupManifest } from '../../src/metadata/manifest.js';
import { logger } from '../../src/logger/logger.js';
import { pathExists } from '../../src/utils/fs.js';

function makeManifest(overrides: Partial<BackupManifest> = {}): BackupManifest {
  return {
    organization: 'my-org',
    timestamp: '2024-01-01T00:00:00Z',
    totalRepositories: 1,
    cloned: 1,
    updated: 0,
    failed: 0,
    archived: 0,
    skipped: 0,
    elapsedTimeMs: 1234,
    dryRun: false,
    discoveryDegraded: false,
    repositories: [
      {
        name: 'widget',
        defaultBranch: 'main',
        archived: false,
        mirrorPath: 'D:/backups/widget.git',
        sizeKb: 10,
        lastFetchedAt: '2024-01-01T00:00:00Z',
        lastCommitSha: 'abc123',
        lfsFetched: null,
        status: 'cloned',
      },
    ],
    ...overrides,
  };
}

describe('metadata/manifest', () => {
  let backupDir: string;

  beforeEach(async () => {
    backupDir = await mkdtemp(path.join(os.tmpdir(), 'gh-helix-manifest-test-'));
  });

  afterEach(async () => {
    await rm(backupDir, { recursive: true, force: true });
  });

  it('writes the canonical manifest and last-run summary by default', async () => {
    const manifest = makeManifest();
    await writeManifest(backupDir, manifest);

    const loadedManifest = await loadManifest(backupDir);
    expect(loadedManifest?.repositories).toHaveLength(1);

    const lastRun = await loadLastRun(backupDir);
    expect(lastRun).not.toHaveProperty('repositories');
    expect(lastRun?.cloned).toBe(1);
  });

  it('skips canonical files when canonical is false, but still writes an extra report', async () => {
    const manifest = makeManifest({ dryRun: true });
    const reportPath = path.join(backupDir, 'custom-report.json');

    await writeManifest(backupDir, manifest, { canonical: false, extraReportPath: reportPath });

    expect(await loadManifest(backupDir)).toBeUndefined();
    expect(await pathExists(reportPath)).toBe(true);
  });

  it('returns undefined when nothing has been written yet', async () => {
    expect(await loadManifest(backupDir)).toBeUndefined();
    expect(await loadLastRun(backupDir)).toBeUndefined();
  });

  it('quarantines a corrupted manifest and warns instead of silently returning undefined', async () => {
    const metadataDir = path.join(backupDir, '.metadata');
    await mkdir(metadataDir, { recursive: true });
    const manifestFile = path.join(metadataDir, 'manifest.json');
    await writeFile(manifestFile, 'not json at all', 'utf8');

    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const loaded = await loadManifest(backupDir);

    expect(loaded).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    expect(await pathExists(manifestFile)).toBe(false);
    warnSpy.mockRestore();
  });
});
