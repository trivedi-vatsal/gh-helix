/** Fully resolved, validated application configuration. */
export interface AppConfig {
  /** GitHub organization login to back up. */
  githubOrg: string;
  /** Absolute path to the directory that stores every mirror. */
  backupDirectory: string;
  /** Number of Git operations to run concurrently (the worker pool size). */
  maxParallel: number;
  /** Whether `git lfs fetch --all` runs after every clone/update. */
  fetchLfs: boolean;
  /**
   * Whether repositories are stored as browsable working-tree clones (true,
   * the default) with source files checked out on disk, or as bare mirrors
   * (false) -- `.git`-only, no working tree, full ref/tag/notes fidelity,
   * less disk. See {@link mirrorDirName} in `utils/paths.ts` for how this
   * affects the on-disk directory naming convention.
   */
  checkoutCode: boolean;
  /** Optional GitHub Enterprise Server hostname, used only for the `gh auth token` fallback. */
  ghHost: string | undefined;
  /** Optional GitHub Enterprise Server REST API base URL, e.g. https://github.company.com/api/v3. */
  githubApiUrl: string | undefined;
  /** Authentication mode: auto (token then gh), token-only, or gh-only. */
  authMode: 'auto' | 'token' | 'gh';
}

/** Raw, loosely-typed shape a `config.json` file may contain. Keys mirror env var names. */
export interface FileConfig {
  GITHUB_ORG?: string;
  BACKUP_DIRECTORY?: string;
  MAX_PARALLEL?: number | string;
  FETCH_LFS?: boolean | string;
  CHECKOUT_CODE?: boolean | string;
  GH_HOST?: string;
  GITHUB_API_URL?: string;
  AUTH_MODE?: string;
  GITHUB_TOKEN?: string;
  GH_TOKEN?: string;
}
