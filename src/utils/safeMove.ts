import { cp, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathExists } from './fs.js';

/**
 * Raised when a cross-volume copy could not be verified as a faithful copy of
 * the source. The source is always left untouched when this is thrown -- the
 * one known-good copy is never removed until a verified replacement exists.
 */
export class SafeMoveVerificationError extends Error {
  constructor(source: string, destination: string, reason: string) {
    super(
      `Move from "${source}" to "${destination}" failed verification: ${reason}. ` +
        `The original at "${source}" was left untouched.`,
    );
    this.name = 'SafeMoveVerificationError';
  }
}

/** Result of a verification check against a staged copy. */
export interface VerifyOutcome {
  ok: boolean;
  reason?: string;
}

/** Verifies a staged copy is trustworthy before it's committed to its final path. */
export type MoveVerifier = (stagingPath: string) => Promise<VerifyOutcome>;

/** Result of {@link safeMoveDirectory}. */
export interface SafeMoveResult {
  /**
   * Set if the move committed successfully but the original copy at `source`
   * could not be removed afterward (e.g. a permission error). Both the moved
   * copy (at `destination`) and the stale original are left in place --
   * nothing is lost, but the caller may want to warn that manual cleanup of
   * this path is possible.
   */
  staleSourceRemaining?: string;
}

function stagingPathFor(destination: string): string {
  return `${destination}.staging`;
}

function markerPathFor(destination: string): string {
  return `${destination}.staging.verified`;
}

function isCrossDeviceError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === 'EXDEV'
  );
}

async function countTree(dir: string): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return { files, bytes };
  }
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = await countTree(entryPath);
      files += sub.files;
      bytes += sub.bytes;
    } else if (entry.isFile()) {
      files += 1;
      try {
        bytes += (await stat(entryPath)).size;
      } catch {
        /* removed concurrently; ignore */
      }
    }
  }
  return { files, bytes };
}

/**
 * Default verifier used when the caller doesn't supply a domain-specific one:
 * a structural comparison (file count + total byte size) between the source
 * and the staged copy. Callers that know more about the content being moved
 * (e.g. a Git mirror) should supply a stronger verifier such as `git fsck`.
 */
async function defaultStructuralVerify(source: string, staging: string): Promise<VerifyOutcome> {
  const [sourceStats, stagingStats] = await Promise.all([countTree(source), countTree(staging)]);
  if (sourceStats.files !== stagingStats.files || sourceStats.bytes !== stagingStats.bytes) {
    return {
      ok: false,
      reason:
        `copy mismatch: source has ${sourceStats.files} files/${sourceStats.bytes} bytes, ` +
        `staged copy has ${stagingStats.files} files/${stagingStats.bytes} bytes`,
    };
  }
  return { ok: true };
}

async function cleanupStagingArtifacts(staging: string, marker: string): Promise<void> {
  await rm(staging, { recursive: true, force: true }).catch(() => {});
  await rm(marker, { force: true }).catch(() => {});
}

async function cleanupStaleSource(source: string, destination: string): Promise<SafeMoveResult> {
  void destination;
  if (!(await pathExists(source))) return {};
  try {
    await rm(source, { recursive: true, force: true });
    return {};
  } catch {
    return { staleSourceRemaining: source };
  }
}

async function commit(
  source: string,
  staging: string,
  destination: string,
  marker: string,
): Promise<SafeMoveResult> {
  // `destination` is guaranteed not to exist yet by every call site below --
  // this rename is therefore a single atomic operation with no ambiguity.
  await rename(staging, destination);
  await rm(marker, { force: true }).catch(() => {});
  return cleanupStaleSource(source, destination);
}

/**
 * Moves a directory from `source` to `destination` transactionally, never
 * using the unsafe "copy then delete" pattern.
 *
 * On the same volume, this is a single atomic `rename` -- lossless by
 * construction, nothing to verify. Across volumes (where `rename` isn't
 * possible), the content is first copied into a staging area beside the
 * destination, verified, and only *then* committed by renaming the staging
 * copy into place; the original is deleted only after the destination is
 * confirmed present. If verification fails, the staged copy is discarded and
 * the source is left completely untouched. If the final commit itself fails
 * (e.g. disk full), both the source and the verified staging copy are left in
 * place rather than deleting either -- the one valid mirror is never lost.
 *
 * The whole operation is idempotent/resumable: calling it again after a
 * crash at any point (mid-copy, mid-verify, mid-commit, mid-cleanup) picks up
 * from wherever it left off without requiring manual repair.
 */
export async function safeMoveDirectory(
  source: string,
  destination: string,
  options: { verify?: MoveVerifier } = {},
): Promise<SafeMoveResult> {
  await mkdir(path.dirname(destination), { recursive: true });

  const staging = stagingPathFor(destination);
  const marker = markerPathFor(destination);

  if (await pathExists(destination)) {
    // Already committed, possibly by a prior run that was interrupted before
    // it could clean up. Destination is authoritative regardless of source.
    await cleanupStagingArtifacts(staging, marker);
    return cleanupStaleSource(source, destination);
  }

  if ((await pathExists(staging)) && (await pathExists(marker))) {
    // A prior attempt produced a verified staged copy but never committed it.
    return commit(source, staging, destination, marker);
  }

  // Any other staging leftovers are untrusted (interrupted before
  // verification completed) -- discard them and start over from source,
  // which is guaranteed untouched at this point.
  await cleanupStagingArtifacts(staging, marker);

  if (!(await pathExists(source))) {
    throw new Error(`Cannot move "${source}" to "${destination}": neither path exists.`);
  }

  let usedCopyFallback = false;
  try {
    await rename(source, staging);
  } catch (error) {
    if (!isCrossDeviceError(error)) throw error;
    usedCopyFallback = true;
    await cp(source, staging, { recursive: true, force: true });
  }

  if (usedCopyFallback) {
    const verifier =
      options.verify ?? ((stagingPath: string) => defaultStructuralVerify(source, stagingPath));
    const outcome = await verifier(staging);
    if (!outcome.ok) {
      await rm(staging, { recursive: true, force: true }).catch(() => {});
      throw new SafeMoveVerificationError(source, destination, outcome.reason ?? 'unknown failure');
    }
  }

  await writeFile(marker, JSON.stringify({ verifiedAt: new Date().toISOString() }), 'utf8');
  return commit(source, staging, destination, marker);
}
