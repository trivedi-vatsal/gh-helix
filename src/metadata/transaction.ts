import { open, readdir, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ensureDir, pathExists } from '../utils/fs.js';

const JOURNAL_PREFIX = '.tx-';
const JOURNAL_SUFFIX = '.json';

interface JournalEntry {
  tmp: string;
  final: string;
}

interface Journal {
  entries: JournalEntry[];
  createdAt: string;
}

/** A single file to be written as part of a {@link writeMetadataTransaction}. */
export interface MetadataFileWrite {
  path: string;
  content: string;
}

function journalPath(metadataDir: string, txId: string): string {
  return path.join(metadataDir, `${JOURNAL_PREFIX}${txId}${JOURNAL_SUFFIX}`);
}

async function fsyncWriteFile(filePath: string, content: string): Promise<void> {
  const handle = await open(filePath, 'w');
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Best-effort directory fsync, ensuring the new directory entries created by
 * the temp-file writes above are themselves durable. Not reliably supported
 * on every platform (notably Windows), so failures here are swallowed --
 * this is a durability improvement on top of, not a substitute for, the
 * journal-based recovery below, which is what actually guarantees safety.
 */
async function fsyncDirectoryBestEffort(dirPath: string): Promise<void> {
  try {
    const handle = await open(dirPath, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    /* best-effort only */
  }
}

async function applyJournal(journalFile: string, journal: Journal): Promise<void> {
  for (const entry of journal.entries) {
    if (await pathExists(entry.tmp)) {
      await rename(entry.tmp, entry.final);
    }
    // If the tmp file is already gone, this entry was already applied by an
    // earlier pass, or never got written at all -- either way `final` still
    // holds a fully valid value (its previous one, or the new one), never a
    // partial write.
  }
  await rm(journalFile, { force: true }).catch(() => {});
}

/**
 * Writes a set of files as one logical transaction: every file is written to
 * a temp sibling and fsynced, a journal recording the pending renames is
 * written and fsynced, then each temp file is renamed into place, and
 * finally the journal is removed. A crash at any point leaves every *existing*
 * file fully intact (old or new content, never truncated); calling
 * {@link recoverPendingTransactions} afterward finishes or discards the
 * journal so `.metadata/` never accumulates half-applied state.
 */
export async function writeMetadataTransaction(
  metadataDir: string,
  files: MetadataFileWrite[],
): Promise<void> {
  if (files.length === 0) return;
  await ensureDir(metadataDir);

  const txId = randomUUID();
  const entries: JournalEntry[] = files.map((file) => ({
    tmp: path.join(path.dirname(file.path), `.${path.basename(file.path)}.tmp-${txId}`),
    final: file.path,
  }));

  for (const [index, file] of files.entries()) {
    await fsyncWriteFile(entries[index]!.tmp, file.content);
  }

  const journal: Journal = { entries, createdAt: new Date().toISOString() };
  const journalFile = journalPath(metadataDir, txId);
  await fsyncWriteFile(journalFile, JSON.stringify(journal));
  await fsyncDirectoryBestEffort(metadataDir);

  await applyJournal(journalFile, journal);
}

/**
 * Finishes or discards any transaction journals left behind by a process
 * that died mid-write, so `.metadata/` is never left holding a half-applied
 * update. Safe -- and cheap -- to call unconditionally at the start of any
 * command that reads or writes metadata.
 */
export async function recoverPendingTransactions(metadataDir: string): Promise<void> {
  let names: string[];
  try {
    names = await readdir(metadataDir);
  } catch {
    return;
  }

  for (const name of names) {
    if (!name.startsWith(JOURNAL_PREFIX) || !name.endsWith(JOURNAL_SUFFIX)) continue;
    const journalFile = path.join(metadataDir, name);
    try {
      const journal = JSON.parse(await readFile(journalFile, 'utf8')) as Journal;
      await applyJournal(journalFile, journal);
    } catch {
      // Corrupt or unreadable journal -- nothing safe to replay from it.
      await rm(journalFile, { force: true }).catch(() => {});
    }
  }
}
