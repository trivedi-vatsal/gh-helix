import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pathExists } from '../../src/utils/fs.js';
import { getOriginUrl } from '../../src/mirror/update.js';

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execa('git', args, { cwd });
  return result.stdout;
}

/** Creates a non-bare "remote" repo with one commit and a HEAD ref, so `ls-remote` succeeds against it. */
async function makeRemoteRepo(root: string, name: string): Promise<string> {
  const originPath = path.join(root, `${name}-origin.git`);
  const workPath = path.join(root, `${name}-work`);
  await git(root, ['init', '--bare', originPath]);
  await git(root, ['clone', originPath, workPath]);
  await git(workPath, ['config', 'user.email', 'test@example.com']);
  await git(workPath, ['config', 'user.name', 'Test']);
  await writeFile(path.join(workPath, 'README.md'), `${name}\n`, 'utf8');
  await git(workPath, ['add', '.']);
  await git(workPath, ['commit', '-m', 'initial commit']);
  await git(workPath, ['push', 'origin', 'HEAD:main']);
  await git(originPath, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  return originPath;
}

async function makeMirror(root: string, remoteUrl: string, mirrorName: string): Promise<string> {
  const mirrorPath = path.join(root, mirrorName);
  await git(root, ['clone', '--mirror', remoteUrl, mirrorPath]);
  return mirrorPath;
}

describe('mirror/rename: renameMirror', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'gh-helix-rename-test-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  it('updates the remote, verifies it, and moves the directory in order', async () => {
    const { renameMirror } = await import('../../src/mirror/rename.js');
    const oldRemote = await makeRemoteRepo(root, 'old-name');
    const newRemote = await makeRemoteRepo(root, 'new-name');
    const oldPath = await makeMirror(root, oldRemote, 'old-name.git');
    const newPath = path.join(root, 'new-name.git');

    const result = await renameMirror(oldPath, newPath, newRemote, undefined);

    expect(result.staleSourceRemaining).toBeUndefined();
    expect(await pathExists(oldPath)).toBe(false);
    expect(await pathExists(newPath)).toBe(true);
    expect(await getOriginUrl(newPath)).toBe(newRemote);
  }, 30000);

  it('rolls back the origin URL when the new remote cannot be verified', async () => {
    const { renameMirror, RenameVerificationError } = await import('../../src/mirror/rename.js');
    const oldRemote = await makeRemoteRepo(root, 'old-name');
    const oldPath = await makeMirror(root, oldRemote, 'old-name.git');
    const newPath = path.join(root, 'new-name.git');
    const bogusRemote = path.join(root, 'does-not-exist.git');

    await expect(renameMirror(oldPath, newPath, bogusRemote, undefined)).rejects.toBeInstanceOf(
      RenameVerificationError,
    );

    // Rolled back: still at the old path, still pointing at the original remote.
    expect(await pathExists(oldPath)).toBe(true);
    expect(await pathExists(newPath)).toBe(false);
    expect(await getOriginUrl(oldPath)).toBe(oldRemote);
  }, 30000);

  it('resumes a move that was interrupted after the URL update but before the directory move committed', async () => {
    const { renameMirror } = await import('../../src/mirror/rename.js');
    const oldRemote = await makeRemoteRepo(root, 'old-name');
    const newRemote = await makeRemoteRepo(root, 'new-name');
    const oldPath = await makeMirror(root, oldRemote, 'old-name.git');
    const newPath = path.join(root, 'new-name.git');

    // Simulate: a prior attempt already updated the URL and moved the
    // directory into a verified staging copy, then the process died before
    // committing it to newPath. oldPath is gone (already consumed).
    const staging = `${newPath}.staging`;
    const marker = `${newPath}.staging.verified`;
    await mkdir(path.dirname(staging), { recursive: true });
    await cp(oldPath, staging, { recursive: true });
    await git(staging, ['remote', 'set-url', 'origin', newRemote]);
    await writeFile(marker, JSON.stringify({ verifiedAt: new Date().toISOString() }), 'utf8');
    await rm(oldPath, { recursive: true, force: true });

    const result = await renameMirror(oldPath, newPath, newRemote, undefined);

    expect(result.staleSourceRemaining).toBeUndefined();
    expect(await pathExists(newPath)).toBe(true);
    expect(await getOriginUrl(newPath)).toBe(newRemote);
  }, 30000);

  it('recovers on a second attempt if the directory move fails to commit the first time', async () => {
    const oldRemote = await makeRemoteRepo(root, 'old-name');
    const newRemote = await makeRemoteRepo(root, 'new-name');
    const oldPath = await makeMirror(root, oldRemote, 'old-name.git');
    const newPath = path.join(root, 'new-name.git');

    vi.resetModules();
    vi.doMock('node:fs/promises', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs/promises')>();
      return {
        ...actual,
        rename: async (
          src: Parameters<typeof actual.rename>[0],
          dest: Parameters<typeof actual.rename>[1],
        ) => {
          if (String(dest) === newPath) {
            throw new Error('simulated disk-full error during commit');
          }
          return actual.rename(src, dest);
        },
      };
    });

    const failingAttempt = await import('../../src/mirror/rename.js');
    await expect(
      failingAttempt.renameMirror(oldPath, newPath, newRemote, undefined),
    ).rejects.toThrow('simulated disk-full error during commit');
    expect(await pathExists(newPath)).toBe(false);

    vi.doUnmock('node:fs/promises');
    vi.resetModules();
    const retryAttempt = await import('../../src/mirror/rename.js');
    const result = await retryAttempt.renameMirror(oldPath, newPath, newRemote, undefined);

    expect(result.staleSourceRemaining).toBeUndefined();
    expect(await pathExists(newPath)).toBe(true);
    expect(await getOriginUrl(newPath)).toBe(newRemote);
  }, 30000);
});
