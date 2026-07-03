import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pathExists } from '../../src/utils/fs.js';

const state = vi.hoisted(() => ({ failRenameOnCall: -1, renameCallCount: 0 }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rename: async (
      src: Parameters<typeof actual.rename>[0],
      dest: Parameters<typeof actual.rename>[1],
    ) => {
      state.renameCallCount += 1;
      if (state.failRenameOnCall === state.renameCallCount) {
        throw new Error('simulated crash during metadata transaction');
      }
      return actual.rename(src, dest);
    },
  };
});

const { writeMetadataTransaction, recoverPendingTransactions } =
  await import('../../src/metadata/transaction.js');

async function journalFiles(metadataDir: string): Promise<string[]> {
  try {
    return (await readdir(metadataDir)).filter((name) => name.startsWith('.tx-'));
  } catch {
    return [];
  }
}

describe('metadata transactions', () => {
  let metadataDir: string;

  beforeEach(async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'gh-helix-transaction-test-'));
    metadataDir = path.join(root, '.metadata');
    await mkdir(metadataDir, { recursive: true });
    state.failRenameOnCall = -1;
    state.renameCallCount = 0;
  });

  afterEach(async () => {
    state.failRenameOnCall = -1;
    state.renameCallCount = 0;
    await rm(path.dirname(metadataDir), { recursive: true, force: true });
  });

  it('writes every file in the set and leaves no journal behind', async () => {
    await writeMetadataTransaction(metadataDir, [
      { path: path.join(metadataDir, 'a.json'), content: '{"a":1}' },
      { path: path.join(metadataDir, 'b.json'), content: '{"b":2}' },
    ]);

    expect(await readFile(path.join(metadataDir, 'a.json'), 'utf8')).toBe('{"a":1}');
    expect(await readFile(path.join(metadataDir, 'b.json'), 'utf8')).toBe('{"b":2}');
    expect(await journalFiles(metadataDir)).toEqual([]);
  });

  it('never leaves an existing file partially written -- old content survives an early crash', async () => {
    const fileA = path.join(metadataDir, 'a.json');
    const fileB = path.join(metadataDir, 'b.json');
    await writeFile(fileA, '{"a":"old"}', 'utf8');
    await writeFile(fileB, '{"b":"old"}', 'utf8');

    // Crash on the very first rename in the apply phase (before file A is updated).
    state.failRenameOnCall = 1;
    await expect(
      writeMetadataTransaction(metadataDir, [
        { path: fileA, content: '{"a":"new"}' },
        { path: fileB, content: '{"b":"new"}' },
      ]),
    ).rejects.toThrow('simulated crash');

    // Neither file was touched -- both still hold their prior, fully valid content.
    expect(await readFile(fileA, 'utf8')).toBe('{"a":"old"}');
    expect(await readFile(fileB, 'utf8')).toBe('{"b":"old"}');
    expect(await journalFiles(metadataDir)).toHaveLength(1); // journal left behind for recovery
  });

  it('recovers a transaction that crashed partway through applying renames', async () => {
    const fileA = path.join(metadataDir, 'a.json');
    const fileB = path.join(metadataDir, 'b.json');
    await writeFile(fileA, '{"a":"old"}', 'utf8');
    await writeFile(fileB, '{"b":"old"}', 'utf8');

    // Let the first rename (file A) succeed, crash on the second (file B).
    state.failRenameOnCall = 2;
    await expect(
      writeMetadataTransaction(metadataDir, [
        { path: fileA, content: '{"a":"new"}' },
        { path: fileB, content: '{"b":"new"}' },
      ]),
    ).rejects.toThrow('simulated crash');

    expect(await readFile(fileA, 'utf8')).toBe('{"a":"new"}'); // already applied
    expect(await readFile(fileB, 'utf8')).toBe('{"b":"old"}'); // not yet applied
    expect(await journalFiles(metadataDir)).toHaveLength(1);

    // "Restart": recovery should finish the interrupted transaction.
    state.failRenameOnCall = -1;
    await recoverPendingTransactions(metadataDir);

    expect(await readFile(fileA, 'utf8')).toBe('{"a":"new"}');
    expect(await readFile(fileB, 'utf8')).toBe('{"b":"new"}');
    expect(await journalFiles(metadataDir)).toEqual([]);
  });

  it('is a no-op when there is nothing to recover', async () => {
    await expect(recoverPendingTransactions(metadataDir)).resolves.toBeUndefined();
  });

  it('is a no-op when the metadata directory does not exist yet', async () => {
    await expect(
      recoverPendingTransactions(path.join(metadataDir, 'does-not-exist')),
    ).resolves.toBeUndefined();
  });

  it('discards an unreadable/corrupt journal instead of crashing', async () => {
    await writeFile(path.join(metadataDir, '.tx-broken.json'), 'not valid json', 'utf8');
    await expect(recoverPendingTransactions(metadataDir)).resolves.toBeUndefined();
    expect(await journalFiles(metadataDir)).toEqual([]);
  });

  it('recovery is idempotent -- calling it twice in a row is safe', async () => {
    const fileA = path.join(metadataDir, 'a.json');
    await writeFile(fileA, '{"a":"old"}', 'utf8');

    state.failRenameOnCall = 1;
    await expect(
      writeMetadataTransaction(metadataDir, [{ path: fileA, content: '{"a":"new"}' }]),
    ).rejects.toThrow('simulated crash');
    state.failRenameOnCall = -1;

    await recoverPendingTransactions(metadataDir);
    await recoverPendingTransactions(metadataDir); // second call: nothing left to do

    expect(await readFile(fileA, 'utf8')).toBe('{"a":"new"}');
    expect(await pathExists(fileA)).toBe(true);
  });
});
