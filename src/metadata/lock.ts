import { hostname } from 'node:os';
import { open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ensureDir } from '../utils/fs.js';
import { METADATA_DIR_NAME } from '../utils/paths.js';

const LOCK_FILE_NAME = 'backup.lock';

/** How often the lock file's timestamp is refreshed while held, so long-running operations don't look stale. */
const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Staleness window applied only when the lock was written by a different host
 * (so we can't check process liveness directly). Same-host locks are instead
 * judged stale purely by whether the owning pid is still alive.
 */
const DEFAULT_STALE_TTL_MS = 15 * 60_000;

/** Contents of the on-disk lock file. */
export interface LockInfo {
  pid: number;
  hostname: string;
  timestamp: string;
  command: string;
}

/** Raised when another live process already holds the lock. */
export class LockConflictError extends Error {
  readonly lock: LockInfo;

  constructor(lockFilePath: string, lock: LockInfo) {
    super(
      'Another gh-helix process appears to be using this backup directory.\n' +
        `  Locked by: pid ${lock.pid} on ${lock.hostname}, running "${lock.command}"\n` +
        `  Since: ${lock.timestamp}\n` +
        `  Lock file: ${lockFilePath}\n` +
        "If you're sure that process is no longer running, retry with --force-lock.",
    );
    this.name = 'LockConflictError';
    this.lock = lock;
  }
}

/** A held lock. Always release it, including on error, via try/finally. */
export interface AcquiredLock {
  release(): Promise<void>;
}

/** Options for {@link acquireLock}. */
export interface AcquireLockOptions {
  /** Unconditionally break an existing lock, regardless of whether it looks stale. */
  force?: boolean;
  staleTtlMs?: number;
  /** How often the held lock's timestamp is refreshed. Defaults to 30s; mainly overridden in tests. */
  heartbeatIntervalMs?: number;
}

function lockFilePath(backupDirectory: string): string {
  return path.join(backupDirectory, METADATA_DIR_NAME, LOCK_FILE_NAME);
}

/** True if a pid is alive, checked via a zero-signal `kill` -- works cross-platform, including Windows. */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // ESRCH: definitely no such process. Anything else (e.g. EPERM, meaning
    // it exists but we can't signal it) is treated conservatively as alive.
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

async function readLock(file: string): Promise<LockInfo | undefined> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as LockInfo;
  } catch {
    return undefined;
  }
}

function isStale(lock: LockInfo, staleTtlMs: number): boolean {
  if (lock.hostname === hostname()) {
    return !isProcessAlive(lock.pid);
  }
  const age = Date.now() - Date.parse(lock.timestamp);
  return Number.isFinite(age) && age > staleTtlMs;
}

/**
 * Refreshes the lock file's contents atomically (temp file + rename), never
 * truncating it in place -- a concurrent reader (another process's
 * conflict check, or our own `release()`) must never be able to observe a
 * torn, half-written lock file mid-heartbeat.
 */
async function writeLockFile(file: string, info: LockInfo): Promise<void> {
  const tempFile = path.join(path.dirname(file), `.${path.basename(file)}.tmp-${randomUUID()}`);
  const handle = await open(tempFile, 'w');
  try {
    await handle.writeFile(JSON.stringify(info, null, 2), 'utf8');
  } finally {
    await handle.close();
  }
  await rename(tempFile, file);
}

function startHeartbeat(file: string, info: LockInfo, intervalMs: number): AcquiredLock {
  const timer = setInterval(() => {
    writeLockFile(file, { ...info, timestamp: new Date().toISOString() }).catch(() => {});
  }, intervalMs);
  timer.unref?.();

  return {
    async release() {
      clearInterval(timer);
      const current = await readLock(file);
      // Only remove the lock if it still looks like the one we wrote --
      // avoids deleting someone else's lock if ours was force-broken and
      // reacquired by another process in the meantime.
      if (!current || (current.pid === info.pid && current.hostname === info.hostname)) {
        await rm(file, { force: true }).catch(() => {});
      }
    },
  };
}

/**
 * Acquires an exclusive lock over `backupDirectory` so two processes never
 * mutate (or, for `verify`, read mid-mutation) the same set of mirrors at
 * once. Fails immediately with {@link LockConflictError} if another live
 * process already holds it -- this is a CLI tool, not a daemon, so it never
 * blocks waiting for a lock to free up.
 *
 * A lock is considered stale (and reclaimed automatically) when its owning
 * process is no longer running on the same host, or, when the lock belongs to
 * a different host and liveness can't be checked directly, once it's older
 * than `staleTtlMs`. `options.force` unconditionally breaks the lock instead.
 */
export async function acquireLock(
  backupDirectory: string,
  command: string,
  options: AcquireLockOptions = {},
): Promise<AcquiredLock> {
  await ensureDir(path.join(backupDirectory, METADATA_DIR_NAME));
  const file = lockFilePath(backupDirectory);
  const staleTtlMs = options.staleTtlMs ?? DEFAULT_STALE_TTL_MS;

  const info: LockInfo = {
    pid: process.pid,
    hostname: hostname(),
    timestamp: new Date().toISOString(),
    command,
  };

  const MAX_ATTEMPTS = 3;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      // 'wx' atomically fails with EEXIST if the file already exists --
      // this is what makes acquisition race-free between processes.
      const handle = await open(file, 'wx');
      try {
        await handle.writeFile(JSON.stringify(info, null, 2), 'utf8');
      } finally {
        await handle.close();
      }
      return startHeartbeat(file, info, options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;

      const existing = await readLock(file);
      if (!existing || options.force || isStale(existing, staleTtlMs)) {
        await rm(file, { force: true }).catch(() => {});
        continue;
      }

      throw new LockConflictError(file, existing);
    }
  }

  throw new Error(`Could not acquire lock at "${file}" after clearing a stale/conflicting lock.`);
}

/** Acquires the lock, runs `fn`, and always releases the lock afterward, even on error. */
export async function withLock<T>(
  backupDirectory: string,
  command: string,
  options: AcquireLockOptions,
  fn: () => Promise<T>,
): Promise<T> {
  const lock = await acquireLock(backupDirectory, command, options);
  try {
    return await fn();
  } finally {
    await lock.release();
  }
}
