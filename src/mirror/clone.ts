import { runGit } from '../utils/exec.js';
import { buildGitAuthEnv } from './auth.js';

/**
 * Creates a working-tree clone of a repository at `destPath`, fetching all
 * branches (`--no-single-branch`) so every branch is available offline.
 * Unlike a bare mirror this produces a normal directory with visible source
 * files; `origin` points at the GitHub HTTPS URL so future fetches go to
 * the real remote, not a local copy.
 */
export async function cloneMirror(
  cloneUrl: string,
  destPath: string,
  token?: string,
): Promise<void> {
  await runGit(['clone', '--no-single-branch', cloneUrl, destPath], { env: buildGitAuthEnv(token) });
}
