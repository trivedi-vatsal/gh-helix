import { constants } from 'node:fs';
import { access, mkdir, readdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** Returns true if a path exists on disk (file or directory). */
export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** Creates a directory (and parents) if it does not already exist. */
export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

/** Lists immediate subdirectory names of a directory. Returns [] if the directory is missing. */
export async function listSubdirectories(dirPath: string): Promise<string[]> {
  if (!(await pathExists(dirPath))) return [];
  const entries = await readdir(dirPath, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

/** Recursively computes the total size in bytes of a directory. */
export async function directorySize(dirPath: string): Promise<number> {
  let total = 0;
  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += await directorySize(entryPath);
    } else if (entry.isFile()) {
      try {
        const info = await stat(entryPath);
        total += info.size;
      } catch {
        /* file may have been removed concurrently; skip it */
      }
    }
  }
  return total;
}

/** Formats a byte count as a human-readable string (KB/MB/GB/TB). */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  return `${value.toFixed(exponent === 0 ? 0 : 2)} ${units[exponent]}`;
}

/**
 * Writes a file atomically: the content is written to a temporary sibling file
 * first, then renamed into place. `rename` within the same directory is atomic
 * on both POSIX and Windows, so readers never observe a partially-written file
 * and a crash mid-write cannot corrupt the previous contents.
 */
export async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.tmp-${randomUUID()}`,
  );
  await writeFile(tempPath, content, 'utf8');
  await rename(tempPath, filePath);
}
