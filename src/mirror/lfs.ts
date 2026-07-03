import { runGit } from '../utils/exec.js';
import { buildGitAuthEnv } from './auth.js';

/**
 * Fetches all Git LFS objects for every ref in a mirror.
 * Safe to call on repositories that don't use LFS -- `git lfs fetch --all` is a
 * no-op when there is nothing tracked by LFS, but callers should still treat
 * failures (e.g. `git-lfs` not installed) as non-fatal warnings.
 */
export async function fetchLfsAll(mirrorPath: string, token?: string): Promise<void> {
  await runGit(['lfs', 'fetch', '--all'], { cwd: mirrorPath, env: buildGitAuthEnv(token) });
}
