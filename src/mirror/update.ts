import { runGit } from '../utils/exec.js';
import { buildGitAuthEnv } from './auth.js';

/** Reads the configured `origin` remote URL for a repo, or undefined if unset. */
export async function getOriginUrl(mirrorPath: string): Promise<string | undefined> {
  try {
    const result = await runGit(['remote', 'get-url', 'origin'], { cwd: mirrorPath });
    return result.stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Repoints a repo's `origin` remote at a new clone URL. */
export async function setOriginUrl(mirrorPath: string, cloneUrl: string): Promise<void> {
  await runGit(['remote', 'set-url', 'origin', cloneUrl], { cwd: mirrorPath });
}

/**
 * Updates an existing working-tree clone: ensures `origin` points at the
 * canonical GitHub URL (handles migration), fetches all branches with pruning,
 * then hard-resets the working tree to the tip of the default branch.
 */
export async function updateMirror(
  mirrorPath: string,
  cloneUrl: string,
  defaultBranch: string,
  token?: string,
): Promise<void> {
  await setOriginUrl(mirrorPath, cloneUrl);
  await runGit(['fetch', '--all', '--prune'], { cwd: mirrorPath, env: buildGitAuthEnv(token) });
  try {
    await runGit(['checkout', defaultBranch], { cwd: mirrorPath });
    await runGit(['reset', '--hard', `origin/${defaultBranch}`], { cwd: mirrorPath });
  } catch {
    // Empty repo or branch not yet on remote — skip working-tree update.
  }
}
