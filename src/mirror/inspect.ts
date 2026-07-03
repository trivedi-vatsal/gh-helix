import { simpleGit } from 'simple-git';

/**
 * Reads the commit SHA that `HEAD` points at inside a mirror (i.e. the tip of
 * the repository's default branch). Returns undefined if it cannot be determined,
 * e.g. for an empty repository.
 */
export async function getLastCommitSha(mirrorPath: string): Promise<string | undefined> {
  try {
    const sha = await simpleGit(mirrorPath).revparse(['HEAD']);
    return sha.trim() || undefined;
  } catch {
    return undefined;
  }
}
