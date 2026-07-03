import { ConfigError } from './errors.js';

/**
 * Parses a positive integer from a string or number, falling back when unset.
 * Throws {@link ConfigError} for anything present but not a valid positive integer
 * -- callers should never receive `NaN` and silently misbehave (e.g. a retry loop
 * that never runs because `attempt <= NaN` is always false).
 */
export function parsePositiveInt(
  value: string | number | undefined,
  fallback: number,
  label = 'value',
): number {
  if (value === undefined) return fallback;
  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    throw new ConfigError(`Invalid ${label} "${value}". Expected a positive integer.`);
  }
  return parsed;
}
