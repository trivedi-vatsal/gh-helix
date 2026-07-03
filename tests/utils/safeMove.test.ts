import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pathExists } from '../../src/utils/fs.js';

const state = vi.hoisted(() => ({
  forceCrossDeviceIntoStaging: false,
  failRmForPath: undefined as string | undefined,
  failCommitWithEnospc: false,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rename: async (
      src: Parameters<typeof actual.rename>[0],
      dest: Parameters<typeof actual.rename>[1],
    ) => {
      if (state.forceCrossDeviceIntoStaging && String(dest).endsWith('.staging')) {
        const error = new Error('EXDEV: cross-device link not permitted') as NodeJS.ErrnoException;
        error.code = 'EXDEV';
        throw error;
      }
      if (state.failCommitWithEnospc && !String(dest).endsWith('.staging')) {
        const error = new Error('ENOSPC: no space left on device') as NodeJS.ErrnoException;
        error.code = 'ENOSPC';
        throw error;
      }
      return actual.rename(src, dest);
    },
    rm: async (
      target: Parameters<typeof actual.rm>[0],
      options?: Parameters<typeof actual.rm>[1],
    ) => {
      if (state.failRmForPath && String(target) === state.failRmForPath) {
        throw new Error('simulated permission error');
      }
      return actual.rm(target, options);
    },
  };
});

const { safeMoveDirectory, SafeMoveVerificationError } =
  await import('../../src/utils/safeMove.js');

describe('safeMoveDirectory', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'gh-helix-safemove-test-'));
    state.forceCrossDeviceIntoStaging = false;
    state.failRmForPath = undefined;
    state.failCommitWithEnospc = false;
  });

  afterEach(async () => {
    state.forceCrossDeviceIntoStaging = false;
    state.failRmForPath = undefined;
    state.failCommitWithEnospc = false;
    await rm(root, { recursive: true, force: true });
  });

  async function makeSourceDir(name: string, fileContent = 'hello'): Promise<string> {
    const source = path.join(root, name);
    await mkdir(source, { recursive: true });
    await writeFile(path.join(source, 'data.txt'), fileContent, 'utf8');
    return source;
  }

  it('moves via a fast atomic rename on the same volume', async () => {
    const source = await makeSourceDir('source');
    const destination = path.join(root, 'destination');

    const result = await safeMoveDirectory(source, destination);

    expect(result.staleSourceRemaining).toBeUndefined();
    expect(await pathExists(source)).toBe(false);
    expect(await readFile(path.join(destination, 'data.txt'), 'utf8')).toBe('hello');
  });

  it('falls back to copy+verify+commit on a cross-device error', async () => {
    const source = await makeSourceDir('source');
    const destination = path.join(root, 'destination');
    state.forceCrossDeviceIntoStaging = true;

    const result = await safeMoveDirectory(source, destination);

    expect(result.staleSourceRemaining).toBeUndefined();
    expect(await pathExists(source)).toBe(false);
    expect(await readFile(path.join(destination, 'data.txt'), 'utf8')).toBe('hello');
    expect(await pathExists(`${destination}.staging`)).toBe(false);
    expect(await pathExists(`${destination}.staging.verified`)).toBe(false);
  });

  it('leaves the source completely untouched when verification fails', async () => {
    const source = await makeSourceDir('source');
    const destination = path.join(root, 'destination');
    state.forceCrossDeviceIntoStaging = true;

    await expect(
      safeMoveDirectory(source, destination, {
        verify: async () => ({ ok: false, reason: 'simulated verification failure' }),
      }),
    ).rejects.toBeInstanceOf(SafeMoveVerificationError);

    expect(await pathExists(source)).toBe(true);
    expect(await readFile(path.join(source, 'data.txt'), 'utf8')).toBe('hello');
    expect(await pathExists(destination)).toBe(false);
    expect(await pathExists(`${destination}.staging`)).toBe(false);
  });

  it('resumes from a verified staging copy left by an interrupted prior attempt', async () => {
    const source = path.join(root, 'source'); // does not exist -- simulates a prior crash that already consumed it
    const destination = path.join(root, 'destination');
    const staging = `${destination}.staging`;
    const marker = `${destination}.staging.verified`;

    await mkdir(staging, { recursive: true });
    await writeFile(path.join(staging, 'data.txt'), 'resumed-content', 'utf8');
    await writeFile(marker, JSON.stringify({ verifiedAt: new Date().toISOString() }), 'utf8');

    const result = await safeMoveDirectory(source, destination);

    expect(result.staleSourceRemaining).toBeUndefined();
    expect(await readFile(path.join(destination, 'data.txt'), 'utf8')).toBe('resumed-content');
    expect(await pathExists(staging)).toBe(false);
    expect(await pathExists(marker)).toBe(false);
  });

  it('discards an unverified staging leftover and restarts cleanly from source', async () => {
    const source = await makeSourceDir('source', 'real-content');
    const destination = path.join(root, 'destination');
    const staging = `${destination}.staging`;

    // Garbage from an attempt that crashed before verification completed --
    // no marker file, so it must not be trusted.
    await mkdir(staging, { recursive: true });
    await writeFile(path.join(staging, 'data.txt'), 'garbage', 'utf8');

    const result = await safeMoveDirectory(source, destination);

    expect(result.staleSourceRemaining).toBeUndefined();
    expect(await readFile(path.join(destination, 'data.txt'), 'utf8')).toBe('real-content');
  });

  it('is idempotent when destination already exists and source is already gone', async () => {
    const source = path.join(root, 'source'); // never existed
    const destination = path.join(root, 'destination');
    await mkdir(destination, { recursive: true });
    await writeFile(path.join(destination, 'data.txt'), 'already-there', 'utf8');

    const result = await safeMoveDirectory(source, destination);

    expect(result).toEqual({});
    expect(await readFile(path.join(destination, 'data.txt'), 'utf8')).toBe('already-there');
  });

  it('reports a stale source instead of losing either copy when cleanup fails', async () => {
    const source = await makeSourceDir('source');
    const destination = path.join(root, 'destination');
    await mkdir(destination, { recursive: true });
    await writeFile(path.join(destination, 'data.txt'), 'committed', 'utf8');
    state.failRmForPath = source;

    const result = await safeMoveDirectory(source, destination);

    expect(result.staleSourceRemaining).toBe(source);
    expect(await pathExists(source)).toBe(true); // stale original still present
    expect(await readFile(path.join(destination, 'data.txt'), 'utf8')).toBe('committed'); // valid copy also present
  });

  it('throws when neither source nor destination exist', async () => {
    const source = path.join(root, 'nope-source');
    const destination = path.join(root, 'nope-destination');
    await expect(safeMoveDirectory(source, destination)).rejects.toThrow(/neither path exists/);
  });

  it('disk full during the final commit: loses nothing, and a retry succeeds once space is free', async () => {
    const source = await makeSourceDir('source');
    const destination = path.join(root, 'destination');
    state.failCommitWithEnospc = true;

    await expect(safeMoveDirectory(source, destination)).rejects.toThrow(/ENOSPC/);

    // Neither the original nor the verified staged copy was deleted.
    expect(await pathExists(source)).toBe(false); // consumed into staging by the fast rename path
    expect(await pathExists(`${destination}.staging`)).toBe(true);
    expect(await pathExists(destination)).toBe(false);

    // "Disk space freed up" -- retrying resumes from the staged copy and commits cleanly.
    state.failCommitWithEnospc = false;
    const result = await safeMoveDirectory(source, destination);

    expect(result.staleSourceRemaining).toBeUndefined();
    expect(await readFile(path.join(destination, 'data.txt'), 'utf8')).toBe('hello');
    expect(await pathExists(`${destination}.staging`)).toBe(false);
  });
});
