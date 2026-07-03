import { CommandError, runGit } from '../utils/exec.js';
import { pathExists } from '../utils/fs.js';
import { safeMoveDirectory } from '../utils/safeMove.js';
import type { SafeMoveResult } from '../utils/safeMove.js';
import { buildGitAuthEnv } from './auth.js';
import { getOriginUrl, setOriginUrl } from './update.js';
import { createMirrorMoveVerifier } from './verify.js';

/** Raised when the new remote URL couldn't be verified reachable; the URL change is rolled back. */
export class RenameVerificationError extends Error {
  constructor(mirrorPath: string, cause: string) {
    super(
      `Could not verify the new remote for the mirror at "${mirrorPath}" (${cause}). ` +
        'The rename was rolled back and the mirror still points at its previous remote.',
    );
    this.name = 'RenameVerificationError';
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof CommandError) return error.stderr || error.message;
  return error instanceof Error ? error.message : String(error);
}

export type RenameMirrorResult = SafeMoveResult;

/**
 * Transactionally renames a local mirror to match a repository that was
 * renamed on GitHub, in the required order: update the `origin` URL, verify
 * it's actually reachable, *then* move the directory. If verification or the
 * move fails, the URL change is rolled back so a mirror is never left
 * pointing at an obsolete remote (URL updated but directory not moved) nor
 * silently broken (directory moved but URL still stale).
 *
 * The whole operation is resumable: if a prior attempt already got past the
 * URL-update-and-verify step (recognizable because `oldPath` no longer
 * exists but the move to `newPath` never committed), it picks up directly
 * from the move step via `safeMoveDirectory`'s own resumption logic, rather
 * than trying to re-run steps against a directory that isn't there anymore.
 */
export async function renameMirror(
  oldPath: string,
  newPath: string,
  newCloneUrl: string,
  token: string | undefined,
): Promise<RenameMirrorResult> {
  const oldExists = await pathExists(oldPath);

  if (oldExists) {
    const originalUrl = await getOriginUrl(oldPath);
    await setOriginUrl(oldPath, newCloneUrl);

    try {
      await runGit(['ls-remote', '--exit-code', 'origin', 'HEAD'], {
        cwd: oldPath,
        env: buildGitAuthEnv(token),
        timeoutMs: 30_000,
      });
    } catch (error) {
      if (originalUrl) await setOriginUrl(oldPath, originalUrl).catch(() => {});
      throw new RenameVerificationError(oldPath, errorMessage(error));
    }
  }
  // If oldPath no longer exists, a prior attempt already completed the
  // URL-update-and-verify step (that URL travels with the directory through
  // any subsequent move) -- only the move itself remains to be resumed.

  return safeMoveDirectory(oldPath, newPath, { verify: createMirrorMoveVerifier() });
}
