import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pathExists } from '../../src/utils/fs.js';

const lockWorkerPath = fileURLToPath(new URL('../helpers/lockWorker.mts', import.meta.url));
const projectRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function runLockWorker(
  backupDirectory: string,
  command: string,
  holdMs: number,
  signalFile: string,
) {
  return execa(
    process.execPath,
    ['--import', 'tsx/esm', lockWorkerPath, backupDirectory, command, String(holdMs), signalFile],
    { reject: false, cwd: projectRoot },
  );
}

async function waitForSignal(signalFile: string, timeoutMs = 10000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await pathExists(signalFile)) {
      return readFile(signalFile, 'utf8');
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for signal file ${signalFile}`);
}

describe('cross-process locking: real concurrent processes', () => {
  let backupDirectory: string;

  beforeEach(async () => {
    backupDirectory = await mkdtemp(path.join(os.tmpdir(), 'gh-helix-concurrency-test-'));
  });

  afterEach(async () => {
    await rm(backupDirectory, { recursive: true, force: true });
  });

  it('parallel backup: two processes racing for the same lock -- only one wins', async () => {
    const signalA = path.join(backupDirectory, 'signal-a.txt');
    const signalB = path.join(backupDirectory, 'signal-b.txt');

    const [resultA, resultB] = await Promise.all([
      runLockWorker(backupDirectory, 'backup', 500, signalA),
      runLockWorker(backupDirectory, 'backup', 500, signalB),
    ]);

    const [contentA, contentB] = await Promise.all([
      readFile(signalA, 'utf8'),
      readFile(signalB, 'utf8'),
    ]);
    const outcomes = [contentA, contentB];

    expect(outcomes.filter((o) => o === 'acquired')).toHaveLength(1);
    expect(outcomes.filter((o) => o.startsWith('conflict:LockConflictError'))).toHaveLength(1);

    const exitCodes = [resultA.exitCode, resultB.exitCode].sort();
    expect(exitCodes).toEqual([0, 1]);
  }, 20000);

  it('backup + clean race: clean is refused while backup holds the lock, and can proceed once it is released', async () => {
    const signalBackup = path.join(backupDirectory, 'signal-backup.txt');
    const signalClean = path.join(backupDirectory, 'signal-clean.txt');

    const backupProcess = runLockWorker(backupDirectory, 'backup', 600, signalBackup);
    await waitForSignal(signalBackup); // wait until backup actually holds the lock

    const cleanResult = await runLockWorker(backupDirectory, 'clean', 50, signalClean);
    expect(cleanResult.exitCode).toBe(1);
    expect(await readFile(signalClean, 'utf8')).toBe('conflict:LockConflictError');

    await backupProcess; // let backup finish and release

    // Now that the lock is free, clean should succeed.
    const signalCleanRetry = path.join(backupDirectory, 'signal-clean-retry.txt');
    const retryResult = await runLockWorker(backupDirectory, 'clean', 10, signalCleanRetry);
    expect(retryResult.exitCode).toBe(0);
    expect(await readFile(signalCleanRetry, 'utf8')).toBe('acquired');
  }, 20000);
});
