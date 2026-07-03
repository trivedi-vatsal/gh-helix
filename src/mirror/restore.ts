import { open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CommandError, runCommand, runGit } from '../utils/exec.js';
import { pathExists } from '../utils/fs.js';

/** Raised when a restore destination already exists and is not empty. */
export class RestoreDestinationExistsError extends Error {
  constructor(destination: string) {
    super(`Restore destination already exists and is not empty: ${destination}`);
    this.name = 'RestoreDestinationExistsError';
  }
}

/**
 * Raised when a repository's Git LFS objects could not be confirmed present
 * in the restored working copy. The plain clone succeeded, but the objective
 * of `restore` is a repository that's fully usable offline -- handing back a
 * working copy that silently still contains LFS pointer files instead of
 * real binary content would not meet that bar.
 */
export class RestoreLfsError extends Error {
  constructor(cause: string) {
    super(
      `Git LFS objects could not be confirmed restored (${cause}). Fix Git LFS (see "health") ` +
        'and run restore again -- the partially-restored working copy is left in place so the ' +
        'retry can resume from it instead of re-cloning from scratch.',
    );
    this.name = 'RestoreLfsError';
  }
}

/** Result of a successful {@link restoreFromMirror} call. */
export interface RestoreResult {
  /** True if LFS objects were confirmed restored, false if pull failed, null if the repo has none. */
  lfsRestored: boolean | null;
}

async function isEmptyOrMissingDir(destination: string): Promise<boolean> {
  if (!(await pathExists(destination))) return true;
  const entries = await readdir(destination);
  return entries.length === 0;
}

function errorMessage(error: unknown): string {
  if (error instanceof CommandError) return error.stderr || error.message;
  return error instanceof Error ? error.message : String(error);
}

async function isGitLfsAvailable(): Promise<boolean> {
  try {
    await runCommand('git', ['lfs', 'version']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Recursively scans a working tree for any `.gitattributes` file (not just
 * the one at the root -- LFS tracking can be scoped to a subdirectory) that
 * enables the LFS filter. Only used as a fallback signal for whether it's
 * safe to skip LFS handling entirely when `git-lfs` itself isn't installed;
 * when `git-lfs` *is* available, restoration is verified directly via
 * `git lfs pull` / `git lfs ls-files` instead of relying on this heuristic.
 */
async function repositoryMightUseLfs(dir: string): Promise<boolean> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.name === '.git') continue;
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (await repositoryMightUseLfs(entryPath)) return true;
    } else if (entry.isFile() && entry.name === '.gitattributes') {
      try {
        const content = await readFile(entryPath, 'utf8');
        if (content.includes('filter=lfs')) return true;
      } catch {
        /* unreadable, skip */
      }
    }
  }
  return false;
}

const LFS_POINTER_SIGNATURE = 'version https://git-lfs.github.com/spec/v1';

/** Reads just enough of a file to check whether it's still an LFS pointer rather than real content. */
async function isUnresolvedLfsPointer(filePath: string): Promise<boolean> {
  try {
    const handle = await open(filePath, 'r');
    try {
      const buffer = Buffer.alloc(200);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      return buffer.toString('utf8', 0, bytesRead).startsWith(LFS_POINTER_SIGNATURE);
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

async function listLfsTrackedFiles(workingDir: string): Promise<string[]> {
  const result = await runGit(['lfs', 'ls-files', '--name-only'], { cwd: workingDir });
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

async function findUnresolvedLfsPointers(
  workingDir: string,
  trackedFiles: string[],
): Promise<string[]> {
  const unresolved: string[] = [];
  for (const relativePath of trackedFiles) {
    const filePath = path.join(workingDir, relativePath);
    if (await isUnresolvedLfsPointer(filePath)) {
      unresolved.push(relativePath);
    }
  }
  return unresolved;
}

/**
 * Clones into `workingDir` and verifies Git LFS content. Git LFS objects are
 * always verified, rather than gating that check on a shallow root-level
 * `.gitattributes` inspection (LFS tracking can be configured in a nested
 * `.gitattributes`, which a root-only check would miss): `git lfs pull` is
 * run, and every file `git lfs ls-files` reports as tracked is checked to
 * confirm it's real content and not still a pointer. A repository with
 * nothing LFS-tracked ("no LFS objects") is treated as a success with
 * nothing to restore; anything else not fully rehydrated throws
 * {@link RestoreLfsError} instead of returning a silent partial result.
 */
async function cloneAndVerifyLfs(mirrorPath: string, workingDir: string): Promise<boolean | null> {
  // Skip LFS smudging during the plain clone so a missing-object failure
  // can't abort the whole clone -- LFS rehydration is handled explicitly
  // below, where a failure is reported as a precise RestoreLfsError.
  await runGit(['clone', mirrorPath, workingDir], { env: { GIT_LFS_SKIP_SMUDGE: '1' } });

  if (!(await isGitLfsAvailable())) {
    if (await repositoryMightUseLfs(workingDir)) {
      throw new RestoreLfsError(
        'this repository appears to use Git LFS (found "filter=lfs" in a .gitattributes file) ' +
          'but git-lfs is not installed on this machine',
      );
    }
    return null;
  }

  try {
    await runGit(['lfs', 'pull'], { cwd: workingDir });
  } catch (error) {
    throw new RestoreLfsError(errorMessage(error));
  }

  const trackedFiles = await listLfsTrackedFiles(workingDir);
  if (trackedFiles.length === 0) {
    return null; // "No LFS objects" -- acceptable.
  }

  const unresolved = await findUnresolvedLfsPointers(workingDir, trackedFiles);
  if (unresolved.length > 0) {
    const preview = unresolved.slice(0, 5).join(', ');
    const suffix = unresolved.length > 5 ? `, and ${unresolved.length - 5} more` : '';
    throw new RestoreLfsError(`LFS-tracked file(s) not rehydrated: ${preview}${suffix}`);
  }

  return true;
}

interface RestoreMarker {
  lfsRestored: boolean | null;
}

/**
 * Restores a working clone from a local mirror -- entirely offline, no GitHub
 * access required. The mirror's `HEAD` already tracks the repository's default
 * branch, so a plain clone checks out the right branch automatically.
 *
 * The destination may be a missing path or an existing *empty* directory --
 * ordinary `git clone` semantics -- but not an existing non-empty one, so a
 * restore never overwrites other data.
 *
 * The clone and LFS verification happen in a staging directory beside the
 * destination (`<destination>.restoring`), committed into place only once
 * fully verified. This makes restore itself crash-safe: if the process dies
 * mid-clone or mid-LFS-pull, `destination` is never left holding a partial
 * checkout, and calling `restoreFromMirror` again resumes from the staged
 * copy instead of requiring the caller to manually delete anything first.
 */
export async function restoreFromMirror(
  mirrorPath: string,
  destination: string,
): Promise<RestoreResult> {
  if (!(await isEmptyOrMissingDir(destination))) {
    throw new RestoreDestinationExistsError(destination);
  }

  const staging = `${destination}.restoring`;
  const marker = `${staging}.verified`;

  let lfsRestored: boolean | null;
  if ((await pathExists(staging)) && (await pathExists(marker))) {
    // Resuming: a prior attempt already produced a fully verified clone.
    const parsed = JSON.parse(await readFile(marker, 'utf8')) as RestoreMarker;
    lfsRestored = parsed.lfsRestored;
  } else {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
    await rm(marker, { force: true }).catch(() => {});
    lfsRestored = await cloneAndVerifyLfs(mirrorPath, staging);
    await writeFile(marker, JSON.stringify({ lfsRestored } satisfies RestoreMarker), 'utf8');
  }

  if (await pathExists(destination)) {
    await rm(destination, { recursive: true, force: true }); // known empty, or just vacated by a fresh attempt
  }
  await rename(staging, destination);
  await rm(marker, { force: true }).catch(() => {});

  return { lfsRestored };
}
