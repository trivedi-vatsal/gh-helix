import path from 'node:path';
import { listSubdirectories, pathExists } from '../utils/fs.js';
import { safeMoveDirectory } from '../utils/safeMove.js';
import type { SafeMoveResult } from '../utils/safeMove.js';
import { DELETED_DIR_NAME, mirrorDirName } from '../utils/paths.js';
import { createMirrorMoveVerifier } from './verify.js';

export { DELETED_DIR_NAME, mirrorDirName };
const RESERVED_DIR_NAMES = new Set([DELETED_DIR_NAME]);

/**
 * True if `dirPath` looks like a Git repository -- i.e. it has a `.git`
 * subdirectory. Local repos are stored as ordinary working-tree clones (not
 * bare mirrors), so this -- rather than a directory-name suffix -- is what
 * distinguishes a repository directory from `.metadata/`, `_deleted/`, or
 * anything else that might exist under the backup directory.
 */
export async function isRepoDirectory(dirPath: string): Promise<boolean> {
  return pathExists(path.join(dirPath, '.git'));
}

/**
 * Finds local repository directories that no longer correspond to any
 * repository name in `knownNames`. These are candidates to be moved into
 * `_deleted/` rather than removed outright. Only performs a single shallow
 * directory listing plus one `.git`-presence check per candidate -- never a
 * recursive scan.
 */
export async function findOrphanDirs(
  backupDirectory: string,
  knownNames: Iterable<string>,
): Promise<string[]> {
  const localDirs = await listSubdirectories(backupDirectory);
  const expected = new Set(Array.from(knownNames, (name) => mirrorDirName(name)));

  const candidates = localDirs.filter((dir) => !RESERVED_DIR_NAMES.has(dir) && !expected.has(dir));
  const isRepo = await Promise.all(
    candidates.map((dir) => isRepoDirectory(path.join(backupDirectory, dir))),
  );
  return candidates.filter((_dir, index) => isRepo[index]);
}

/** Result of {@link moveToDeleted}. */
export interface MoveToDeletedResult extends SafeMoveResult {
  destination: string;
}

/**
 * Moves an orphaned mirror directory into `_deleted/`, appending a timestamp
 * suffix if a directory with the same name was already moved there before.
 * The move is transactional (see {@link safeMoveDirectory}): a mirror is
 * never deleted from its original location until a verified copy exists at
 * the destination.
 */
export async function moveToDeleted(
  backupDirectory: string,
  dirName: string,
): Promise<MoveToDeletedResult> {
  const source = path.join(backupDirectory, dirName);
  const deletedRoot = path.join(backupDirectory, DELETED_DIR_NAME);
  let destination = path.join(deletedRoot, dirName);

  if (await pathExists(destination)) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    destination = path.join(deletedRoot, `${dirName}.${timestamp}`);
  }

  const result = await safeMoveDirectory(source, destination, {
    verify: createMirrorMoveVerifier(),
  });
  return { ...result, destination };
}
