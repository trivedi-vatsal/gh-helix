import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  restoreFromMirror,
  RestoreDestinationExistsError,
  RestoreLfsError,
} from '../../src/mirror/restore.js';
import { pathExists } from '../../src/utils/fs.js';

const restoreWorkerPath = fileURLToPath(new URL('../helpers/restoreWorker.mts', import.meta.url));

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execa('git', args, { cwd });
  return result.stdout;
}

/** Normalizes line endings before comparing file content, since a destination
 * clone may apply core.autocrlf checkout conversion depending on the platform's
 * Git configuration -- irrelevant to what this test is actually verifying. */
async function readTextNormalized(filePath: string): Promise<string> {
  return (await readFile(filePath, 'utf8')).replace(/\r\n/g, '\n');
}

async function makePlainMirror(root: string): Promise<string> {
  const originPath = path.join(root, 'origin.git');
  const workPath = path.join(root, 'work');
  await git(root, ['init', '--bare', originPath]);
  await git(root, ['clone', originPath, workPath]);
  await git(workPath, ['config', 'user.email', 'test@example.com']);
  await git(workPath, ['config', 'user.name', 'Test']);
  await writeFile(path.join(workPath, 'README.md'), 'hello\n', 'utf8');
  await git(workPath, ['add', '.']);
  await git(workPath, ['commit', '-m', 'initial commit']);
  await git(workPath, ['push', 'origin', 'HEAD:main']);
  // Bare repos default their HEAD symref to whatever init.defaultBranch was at
  // creation time, which may not be the branch we actually pushed -- point it
  // at "main" explicitly so clones of the mirror check out a working tree.
  await git(originPath, ['symbolic-ref', 'HEAD', 'refs/heads/main']);

  const mirrorPath = path.join(root, 'mirror.git');
  await git(root, ['clone', '--mirror', originPath, mirrorPath]);
  return mirrorPath;
}

let lfsAvailable = true;
try {
  await execa('git', ['lfs', 'version']);
} catch {
  lfsAvailable = false;
}

async function makeLfsMirror(root: string, options: { fetchLfs: boolean }): Promise<string> {
  const originPath = path.join(root, 'origin.git');
  const workPath = path.join(root, 'work');
  await git(root, ['init', '--bare', originPath]);
  await git(root, ['clone', originPath, workPath]);
  await git(workPath, ['config', 'user.email', 'test@example.com']);
  await git(workPath, ['config', 'user.name', 'Test']);
  await git(workPath, ['lfs', 'install', '--local']);
  await git(workPath, ['lfs', 'track', '*.bin']);
  await writeFile(path.join(workPath, 'asset.bin'), 'binary-content-not-a-pointer\n', 'utf8');
  await git(workPath, ['add', '.']);
  await git(workPath, ['commit', '-m', 'add lfs asset']);
  await git(workPath, ['push', 'origin', 'HEAD:main']);
  // Bare repos default their HEAD symref to whatever init.defaultBranch was at
  // creation time, which may not be the branch we actually pushed -- point it
  // at "main" explicitly so clones of the mirror check out a working tree.
  await git(originPath, ['symbolic-ref', 'HEAD', 'refs/heads/main']);

  const mirrorPath = path.join(root, 'mirror.git');
  await git(root, ['clone', '--mirror', originPath, mirrorPath]);
  if (options.fetchLfs) {
    await git(mirrorPath, ['lfs', 'fetch', '--all']);
  }
  return mirrorPath;
}

/** A mirror with enough files that a clone takes a non-instant amount of time, so it can be interrupted mid-flight. */
async function makeLargishMirror(root: string): Promise<string> {
  const originPath = path.join(root, 'origin.git');
  const workPath = path.join(root, 'work');
  await git(root, ['init', '--bare', originPath]);
  await git(root, ['clone', originPath, workPath]);
  await git(workPath, ['config', 'user.email', 'test@example.com']);
  await git(workPath, ['config', 'user.name', 'Test']);
  const content = 'x'.repeat(64 * 1024);
  for (let i = 0; i < 40; i++) {
    await writeFile(path.join(workPath, `file-${i}.txt`), content, 'utf8');
  }
  await git(workPath, ['add', '.']);
  await git(workPath, ['commit', '-m', 'bulk content']);
  await git(workPath, ['push', 'origin', 'HEAD:main']);
  await git(originPath, ['symbolic-ref', 'HEAD', 'refs/heads/main']);

  const mirrorPath = path.join(root, 'mirror.git');
  await git(root, ['clone', '--mirror', originPath, mirrorPath]);
  return mirrorPath;
}

describe('mirror/restore: plain repositories', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'gh-helix-restore-test-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('clones from the local mirror into a missing destination', async () => {
    const mirrorPath = await makePlainMirror(root);
    const destination = path.join(root, 'restored');

    const result = await restoreFromMirror(mirrorPath, destination);

    expect(result.lfsRestored).toBeNull();
    expect(await readTextNormalized(path.join(destination, 'README.md'))).toBe('hello\n');
  }, 30000);

  it('clones into an existing empty destination directory', async () => {
    const mirrorPath = await makePlainMirror(root);
    const destination = path.join(root, 'restored-empty');
    await mkdir(destination, { recursive: true });

    await restoreFromMirror(mirrorPath, destination);
    expect(await readTextNormalized(path.join(destination, 'README.md'))).toBe('hello\n');
  }, 30000);

  it('refuses to clone into a non-empty destination', async () => {
    const mirrorPath = await makePlainMirror(root);
    const destination = path.join(root, 'restored-nonempty');
    await mkdir(destination, { recursive: true });
    await writeFile(path.join(destination, 'existing-file.txt'), 'do not touch\n', 'utf8');

    await expect(restoreFromMirror(mirrorPath, destination)).rejects.toBeInstanceOf(
      RestoreDestinationExistsError,
    );
  }, 30000);
});

describe.skipIf(!lfsAvailable)('mirror/restore: LFS rehydration', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'gh-helix-restore-lfs-test-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('rehydrates LFS objects when the mirror has them', async () => {
    const mirrorPath = await makeLfsMirror(root, { fetchLfs: true });
    const destination = path.join(root, 'restored');

    const result = await restoreFromMirror(mirrorPath, destination);

    expect(result.lfsRestored).toBe(true);
    const content = await readTextNormalized(path.join(destination, 'asset.bin'));
    expect(content).toBe('binary-content-not-a-pointer\n');
    expect(content).not.toContain('git-lfs.github.com/spec');
  }, 30000);

  it('fails loudly instead of silently restoring LFS pointer files', async () => {
    // Mirror was never `lfs fetch`-ed, so its own LFS storage is empty --
    // this is the exact scenario the P0 fix guards against.
    const mirrorPath = await makeLfsMirror(root, { fetchLfs: false });
    const destination = path.join(root, 'restored');

    await expect(restoreFromMirror(mirrorPath, destination)).rejects.toBeInstanceOf(
      RestoreLfsError,
    );
  }, 30000);

  it('detects and restores LFS content tracked only by a nested .gitattributes', async () => {
    const originPath = path.join(root, 'origin.git');
    const workPath = path.join(root, 'work');
    await git(root, ['init', '--bare', originPath]);
    await git(root, ['clone', originPath, workPath]);
    await git(workPath, ['config', 'user.email', 'test@example.com']);
    await git(workPath, ['config', 'user.name', 'Test']);
    await git(workPath, ['lfs', 'install', '--local']);

    // Root has no LFS tracking at all -- only the "assets" subdirectory does,
    // which a root-.gitattributes-only check (the old detection method) would miss.
    await mkdir(path.join(workPath, 'assets'), { recursive: true });
    await writeFile(path.join(workPath, 'README.md'), 'no lfs here\n', 'utf8');
    await git(path.join(workPath, 'assets'), ['lfs', 'track', '*.bin']);
    await writeFile(path.join(workPath, 'assets', 'nested.bin'), 'nested-binary-content\n', 'utf8');

    await git(workPath, ['add', '.']);
    await git(workPath, ['commit', '-m', 'nested lfs asset']);
    await git(workPath, ['push', 'origin', 'HEAD:main']);
    await git(originPath, ['symbolic-ref', 'HEAD', 'refs/heads/main']);

    const mirrorPath = path.join(root, 'mirror.git');
    await git(root, ['clone', '--mirror', originPath, mirrorPath]);
    await git(mirrorPath, ['lfs', 'fetch', '--all']);

    const destination = path.join(root, 'restored');
    const result = await restoreFromMirror(mirrorPath, destination);

    expect(result.lfsRestored).toBe(true);
    const content = await readTextNormalized(path.join(destination, 'assets', 'nested.bin'));
    expect(content).toBe('nested-binary-content\n');
  }, 30000);
});

describe('mirror/restore: crash recovery', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'gh-helix-restore-crash-test-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('resumes from a verified staged clone left by an interrupted attempt', async () => {
    const mirrorPath = await makePlainMirror(root);
    const destination = path.join(root, 'restored');
    const staging = `${destination}.restoring`;
    const marker = `${staging}.verified`;

    // Simulate: a prior attempt already finished cloning and verifying into
    // the staging directory but died before committing it to `destination`.
    await git(root, ['clone', mirrorPath, staging]);
    await writeFile(marker, JSON.stringify({ lfsRestored: null }), 'utf8');

    const result = await restoreFromMirror(mirrorPath, destination);

    expect(result.lfsRestored).toBeNull();
    expect(await readTextNormalized(path.join(destination, 'README.md'))).toBe('hello\n');
    expect(await pathExists(staging)).toBe(false);
    expect(await pathExists(marker)).toBe(false);
  }, 30000);

  it('discards an unverified staged clone and restarts cleanly', async () => {
    const mirrorPath = await makePlainMirror(root);
    const destination = path.join(root, 'restored');
    const staging = `${destination}.restoring`;

    // Garbage from an attempt that crashed mid-clone, before verification --
    // no marker file, so it must not be trusted or reused.
    await mkdir(staging, { recursive: true });
    await writeFile(path.join(staging, 'incomplete'), 'partial', 'utf8');

    const result = await restoreFromMirror(mirrorPath, destination);

    expect(result.lfsRestored).toBeNull();
    expect(await readTextNormalized(path.join(destination, 'README.md'))).toBe('hello\n');
    expect(await pathExists(path.join(destination, 'incomplete'))).toBe(false);
  }, 30000);

  it('recovers correctly after a real process is killed mid-restore', async () => {
    const mirrorPath = await makeLargishMirror(root);
    const destination = path.join(root, 'restored');

    // Invoke node directly with tsx's loader (rather than via `npx`, which
    // spawns an extra wrapper process) so SIGKILL lands on the exact process
    // actually running the worker, not just an intermediary.
    const child = execa(
      process.execPath,
      ['--import', 'tsx/esm', restoreWorkerPath, mirrorPath, destination],
      {
        reject: false,
        cwd: path.resolve(fileURLToPath(new URL('../..', import.meta.url))),
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    child.kill('SIGKILL');
    await child;

    try {
      const result = await restoreFromMirror(mirrorPath, destination);
      expect(result.lfsRestored).toBeNull();
    } catch (error) {
      // The killed process may have already finished before the signal
      // landed -- if so, a second restore correctly refuses to clobber the
      // already-complete destination, which is also a valid, safe outcome.
      expect(error).toBeInstanceOf(RestoreDestinationExistsError);
    }

    expect(await readTextNormalized(path.join(destination, 'file-0.txt'))).toBe(
      'x'.repeat(64 * 1024),
    );
    // No leftover staging artifacts from the killed attempt.
    expect(await pathExists(`${destination}.restoring`)).toBe(false);
    expect(await pathExists(`${destination}.restoring.verified`)).toBe(false);
  }, 60000);
});
