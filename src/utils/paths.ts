/** Name of the directory that holds orphaned mirrors moved off the active backup set. */
export const DELETED_DIR_NAME = '_deleted';

/** Name of the directory that holds cached discovery results and run manifests. */
export const METADATA_DIR_NAME = '.metadata';

/** Derives the on-disk directory name for a repository (plain working-tree clone). */
export function mirrorDirName(repoName: string): string {
  return repoName;
}
