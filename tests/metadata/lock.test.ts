import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { acquireLock, LockConflictError, withLock } from '../../src/metadata/lock.js';
import type { LockInfo } from '../../src/metadata/lock.js';
import { pathExists } from '../../src/utils/fs.js';

function lockFile(backupDir: string): string {
  return path.join(backupDir, '.metadata', 'backup.lock');
}

/** Pre-seeds a lock file, creating `.metadata/` first since acquireLock normally does that itself. */
async function seedLock(backupDir: string, info: LockInfo): Promise<void> {
  await mkdir(path.dirname(lockFile(backupDir)), { recursive: true });
  await writeFile(lockFile(backupDir), JSON.stringify(info), 'utf8');
}

describe('metadata/lock', () => {
  let backupDir: string;

  beforeEach(async () => {
    backupDir = await mkdtemp(path.join(os.tmpdir(), 'gh-helix-lock-test-'));
  });

  afterEach(async () => {
    await rm(backupDir, { recursive: true, force: true });
  });

  it('acquires and releases a lock, writing pid/hostname/timestamp/command', async () => {
    const lock = await acquireLock(backupDir, 'backup --dry-run');
    const info = JSON.parse(await readFile(lockFile(backupDir), 'utf8')) as LockInfo;

    expect(info.pid).toBe(process.pid);
    expect(info.hostname).toBe(os.hostname());
    expect(info.command).toBe('backup --dry-run');
    expect(typeof info.timestamp).toBe('string');

    await lock.release();
    expect(await pathExists(lockFile(backupDir))).toBe(false);
  });

  it('refuses a second acquisition while a live lock is held', async () => {
    const lock = await acquireLock(backupDir, 'backup');
    await expect(acquireLock(backupDir, 'clean')).rejects.toBeInstanceOf(LockConflictError);
    await lock.release();
  });

  it('automatically reclaims a lock whose owning pid is no longer alive on this host', async () => {
    const deadLock: LockInfo = {
      pid: 999999999, // effectively guaranteed not to exist
      hostname: os.hostname(),
      timestamp: new Date().toISOString(),
      command: 'backup',
    };
    await seedLock(backupDir, deadLock);

    const lock = await acquireLock(backupDir, 'clean');
    const info = JSON.parse(await readFile(lockFile(backupDir), 'utf8')) as LockInfo;
    expect(info.pid).toBe(process.pid);
    await lock.release();
  });

  it('does not reclaim a lock from a different host until the TTL elapses', async () => {
    const remoteLock: LockInfo = {
      pid: 12345,
      hostname: 'some-other-machine',
      timestamp: new Date().toISOString(), // fresh
      command: 'backup',
    };
    await seedLock(backupDir, remoteLock);

    await expect(acquireLock(backupDir, 'clean', { staleTtlMs: 60_000 })).rejects.toBeInstanceOf(
      LockConflictError,
    );
  });

  it('reclaims a remote-host lock once it is older than the TTL', async () => {
    const remoteLock: LockInfo = {
      pid: 12345,
      hostname: 'some-other-machine',
      timestamp: new Date(Date.now() - 120_000).toISOString(),
      command: 'backup',
    };
    await seedLock(backupDir, remoteLock);

    const lock = await acquireLock(backupDir, 'clean', { staleTtlMs: 60_000 });
    await lock.release();
  });

  it('--force-lock (force option) unconditionally breaks a live-looking lock', async () => {
    const liveLock: LockInfo = {
      pid: process.pid, // genuinely alive -- would normally block
      hostname: os.hostname(),
      timestamp: new Date().toISOString(),
      command: 'backup',
    };
    await seedLock(backupDir, liveLock);

    const lock = await acquireLock(backupDir, 'restore my-repo', { force: true });
    const info = JSON.parse(await readFile(lockFile(backupDir), 'utf8')) as LockInfo;
    expect(info.command).toBe('restore my-repo');
    await lock.release();
  });

  it('treats an unreadable/corrupt lock file as stale', async () => {
    await mkdir(path.dirname(lockFile(backupDir)), { recursive: true });
    await writeFile(lockFile(backupDir), 'not valid json', 'utf8');
    const lock = await acquireLock(backupDir, 'verify');
    await lock.release();
  });

  it('withLock releases the lock even when the callback throws', async () => {
    await expect(
      withLock(backupDir, 'backup', {}, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(await pathExists(lockFile(backupDir))).toBe(false);
  });

  it('does not release a lock that was force-broken and reacquired by someone else', async () => {
    const lock = await acquireLock(backupDir, 'backup');
    // Simulate another process force-breaking and reacquiring the lock while we hold our handle.
    const otherLock: LockInfo = {
      pid: process.pid + 1,
      hostname: os.hostname(),
      timestamp: new Date().toISOString(),
      command: 'clean',
    };
    await writeFile(lockFile(backupDir), JSON.stringify(otherLock), 'utf8');

    await lock.release();

    // Our release() must not have deleted the other process's lock.
    expect(await pathExists(lockFile(backupDir))).toBe(true);
    const info = JSON.parse(await readFile(lockFile(backupDir), 'utf8')) as LockInfo;
    expect(info.command).toBe('clean');
  });

  it('refreshes the lock timestamp via heartbeat while held', async () => {
    const lock = await acquireLock(backupDir, 'backup', { heartbeatIntervalMs: 20 });
    const before = JSON.parse(await readFile(lockFile(backupDir), 'utf8')) as LockInfo;

    await new Promise((resolve) => setTimeout(resolve, 120));

    const after = JSON.parse(await readFile(lockFile(backupDir), 'utf8')) as LockInfo;
    expect(Date.parse(after.timestamp)).toBeGreaterThan(Date.parse(before.timestamp));

    await lock.release();
  });
});
