import { CommandError, runGit } from '../utils/exec.js';
import type { MoveVerifier } from '../utils/safeMove.js';
import { getOriginUrl } from './update.js';

/** Result of validating a single local mirror. */
export interface VerifyResult {
  hasOrigin: boolean;
  fsckPassed: boolean;
  fsckOutput: string;
  errors: string[];
}

/**
 * Validates a local mirror: confirms the `origin` remote is configured and runs
 * `git fsck` to check object database integrity. Continues past failures so the
 * caller can process the remaining repositories in a batch.
 */
export async function verifyMirror(mirrorPath: string): Promise<VerifyResult> {
  const errors: string[] = [];

  const originUrl = await getOriginUrl(mirrorPath);
  const hasOrigin = Boolean(originUrl);
  if (!hasOrigin) errors.push('origin remote is missing');

  let fsckPassed = true;
  let fsckOutput: string;
  try {
    const result = await runGit(['fsck', '--full'], { cwd: mirrorPath });
    fsckOutput = `${result.stdout}${result.stderr}`.trim();
  } catch (error) {
    fsckPassed = false;
    fsckOutput = error instanceof CommandError ? error.stderr || error.message : String(error);
    errors.push(`git fsck failed: ${fsckOutput.split('\n')[0]}`);
  }

  return { hasOrigin, fsckPassed, fsckOutput, errors };
}

/**
 * A {@link MoveVerifier} that treats a staged copy of a mirror as trustworthy
 * only if it has an `origin` remote and passes `git fsck` -- used by
 * `safeMoveDirectory` whenever it has to fall back to a cross-volume copy
 * instead of an atomic rename, so a corrupted copy is never committed over
 * (or instead of) a known-good mirror.
 */
export function createMirrorMoveVerifier(): MoveVerifier {
  return async (stagingPath: string) => {
    const result = await verifyMirror(stagingPath);
    if (!result.hasOrigin || !result.fsckPassed) {
      return { ok: false, reason: result.errors.join('; ') || 'mirror verification failed' };
    }
    return { ok: true };
  };
}
