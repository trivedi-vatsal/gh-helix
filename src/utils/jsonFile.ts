import { readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { pathExists } from './fs.js';

/** Outcome of attempting to read and parse a JSON file that may not exist or may be corrupt. */
export type JsonReadResult<T> =
  { status: 'missing' } | { status: 'ok'; value: T } | { status: 'corrupt'; error: Error };

/**
 * Reads and parses a JSON file, distinguishing "never existed" (normal, e.g. first
 * run) from "exists but is not valid JSON" (abnormal -- a crash, disk-full event,
 * or manual edit). Callers must not treat the two the same way: a missing file is
 * silently fine, but corruption should be surfaced, not swallowed.
 */
export async function readJsonFile<T>(filePath: string): Promise<JsonReadResult<T>> {
  if (!(await pathExists(filePath))) return { status: 'missing' };
  try {
    const raw = await readFile(filePath, 'utf8');
    return { status: 'ok', value: JSON.parse(raw) as T };
  } catch (error) {
    return { status: 'corrupt', error: error instanceof Error ? error : new Error(String(error)) };
  }
}

/**
 * Moves a corrupt file aside (`<name>.corrupt-<timestamp>`) instead of leaving it
 * to be silently overwritten, so there's forensic evidence of what went wrong.
 * Best-effort: failures here must not block the caller's own error handling.
 */
export async function quarantineCorruptFile(filePath: string): Promise<string | undefined> {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const destination = path.join(
      path.dirname(filePath),
      `${path.basename(filePath)}.corrupt-${timestamp}`,
    );
    await rename(filePath, destination);
    return destination;
  } catch {
    return undefined;
  }
}
