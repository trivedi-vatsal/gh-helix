/** Converts a simple `*`/`?` glob pattern into a case-insensitive RegExp. */
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

/** Returns true if `value` matches any of the given glob patterns. */
function matchesAny(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => globToRegExp(pattern).test(value));
}

/** Options for {@link shouldIncludeRepo}. */
export interface FilterOptions {
  include?: string[];
  exclude?: string[];
}

/**
 * Decides whether a repository should be processed, given optional include/exclude glob lists.
 * Matching is attempted against both the bare repo name and `owner/name`.
 * Exclude always wins over include.
 */
export function shouldIncludeRepo(
  name: string,
  nameWithOwner: string,
  options: FilterOptions,
): boolean {
  const candidates = [name, nameWithOwner];
  const { include, exclude } = options;

  if (exclude && exclude.length > 0) {
    if (candidates.some((candidate) => matchesAny(candidate, exclude))) return false;
  }
  if (include && include.length > 0) {
    return candidates.some((candidate) => matchesAny(candidate, include));
  }
  return true;
}
