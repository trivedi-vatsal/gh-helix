/** A repository as discovered via the GitHub REST API. */
export interface RemoteRepo {
  /** Stable GitHub repository ID (stringified), used to detect renames across runs. */
  id: string;
  /** Bare repository name, e.g. "widget". */
  name: string;
  /** "owner/name", e.g. "my-org/widget". */
  nameWithOwner: string;
  /** SSH clone URL. */
  sshUrl: string;
  /** HTTPS clone URL. */
  cloneUrl: string;
  /** HTML URL of the repository. */
  htmlUrl: string;
  isArchived: boolean;
  isFork: boolean;
  isDisabled: boolean;
  createdAt: string | null;
  updatedAt: string;
  pushedAt: string | null;
  /** Default branch name, e.g. "main". */
  defaultBranch: string;
  /** Approximate repository size in KB, as reported by the GitHub API. */
  sizeKb: number;
}
