import path from 'node:path';
import { logger } from '../logger/logger.js';
import { atomicWriteFile, ensureDir } from '../utils/fs.js';
import { quarantineCorruptFile, readJsonFile } from '../utils/jsonFile.js';
import { METADATA_DIR_NAME } from '../utils/paths.js';
import { recoverPendingTransactions, writeMetadataTransaction } from './transaction.js';
import type { MetadataFileWrite } from './transaction.js';

const MANIFEST_FILE_NAME = 'manifest.json';
const LAST_RUN_FILE_NAME = 'last-run.json';

/** Outcome of processing a single repository during a backup run. */
export type RepoStatus =
  | 'cloned'
  | 'updated'
  | 'skipped-archived'
  | 'skipped-filtered'
  | 'would-clone'
  | 'would-update'
  | 'failed';

/** Per-repository record in a {@link BackupManifest}. */
export interface RepoManifestEntry {
  name: string;
  defaultBranch: string;
  archived: boolean;
  mirrorPath: string;
  /** Approximate size in KB, as reported by the GitHub API at discovery time. */
  sizeKb: number;
  lastFetchedAt: string | null;
  lastCommitSha: string | null;
  status: RepoStatus;
  /** Whether `git lfs fetch --all` succeeded this run. `null` when LFS fetching is disabled. */
  lfsFetched: boolean | null;
  error?: string;
  renamedFrom?: string;
}

/** Full record of a backup run, written to `.metadata/manifest.json` after every run. */
export interface BackupManifest {
  organization: string;
  timestamp: string;
  totalRepositories: number;
  cloned: number;
  updated: number;
  failed: number;
  archived: number;
  skipped: number;
  elapsedTimeMs: number;
  dryRun: boolean;
  /**
   * True if the GitHub API was unreachable/unauthorized this run and processing
   * fell back to the last cached discovery instead of aborting. New, renamed, and
   * deleted repositories cannot be detected while this is true.
   */
  discoveryDegraded: boolean;
  repositories: RepoManifestEntry[];
}

/** Lightweight summary of the most recent run, for fast reads by `status`. */
export type LastRunSummary = Omit<BackupManifest, 'repositories'>;

function metadataDir(backupDirectory: string): string {
  return path.join(backupDirectory, METADATA_DIR_NAME);
}

/** Absolute path to `.metadata/manifest.json` for a backup directory. */
export function manifestFilePath(backupDirectory: string): string {
  return path.join(metadataDir(backupDirectory), MANIFEST_FILE_NAME);
}

/** Absolute path to `.metadata/last-run.json` for a backup directory. */
export function lastRunFilePath(backupDirectory: string): string {
  return path.join(metadataDir(backupDirectory), LAST_RUN_FILE_NAME);
}

/** Options for {@link writeManifest}. */
export interface WriteManifestOptions {
  /** Also write a copy of the manifest to this path (the `--report` flag). */
  extraReportPath?: string;
  /**
   * Whether to write the canonical `.metadata/manifest.json` and `last-run.json`.
   * Set to false during dry runs so nothing about the tracked backup state changes.
   */
  canonical?: boolean;
  /**
   * Additional files (e.g. the repositories cache) to write as part of the
   * *same* metadata transaction as `manifest.json`/`last-run.json`, so all of
   * `.metadata/` reflects one run atomically rather than several independent
   * writes that a crash could leave inconsistent with each other.
   */
  extraTransactionFiles?: MetadataFileWrite[];
}

/**
 * Writes the full backup manifest to `.metadata/manifest.json`, a lightweight
 * `.metadata/last-run.json` summary, and optionally a copy at a custom path
 * (the `--report` flag). The canonical files (plus any `extraTransactionFiles`)
 * are committed as one metadata transaction -- see {@link writeMetadataTransaction}.
 */
export async function writeManifest(
  backupDirectory: string,
  manifest: BackupManifest,
  options: WriteManifestOptions = {},
): Promise<void> {
  const canonical = options.canonical ?? true;

  if (canonical) {
    const dir = metadataDir(backupDirectory);
    await recoverPendingTransactions(dir);
    const { repositories: _repositories, ...summary } = manifest;
    const files: MetadataFileWrite[] = [
      { path: manifestFilePath(backupDirectory), content: JSON.stringify(manifest, null, 2) },
      { path: lastRunFilePath(backupDirectory), content: JSON.stringify(summary, null, 2) },
      ...(options.extraTransactionFiles ?? []),
    ];
    await writeMetadataTransaction(dir, files);
  }

  if (options.extraReportPath) {
    await ensureDir(path.dirname(path.resolve(options.extraReportPath)));
    await atomicWriteFile(options.extraReportPath, JSON.stringify(manifest, null, 2));
  }
}

/**
 * Reads the full manifest from the most recent run, or undefined if none exists yet.
 * A missing file is normal; a file that exists but fails to parse is quarantined
 * and logged rather than silently treated as "no manifest".
 */
export async function loadManifest(backupDirectory: string): Promise<BackupManifest | undefined> {
  await recoverPendingTransactions(metadataDir(backupDirectory));
  const file = manifestFilePath(backupDirectory);
  const result = await readJsonFile<BackupManifest>(file);
  if (result.status === 'ok') return result.value;
  if (result.status === 'corrupt') {
    const quarantined = await quarantineCorruptFile(file);
    logger.warn(
      `Manifest at ${file} is corrupted (${result.error.message}) and was ignored` +
        (quarantined ? ` -- the bad file was preserved at ${quarantined}.` : '.'),
    );
  }
  return undefined;
}

/**
 * Reads the lightweight last-run summary without parsing the full manifest.
 * See {@link loadManifest} for the missing-vs-corrupt handling policy.
 */
export async function loadLastRun(backupDirectory: string): Promise<LastRunSummary | undefined> {
  await recoverPendingTransactions(metadataDir(backupDirectory));
  const file = lastRunFilePath(backupDirectory);
  const result = await readJsonFile<LastRunSummary>(file);
  if (result.status === 'ok') return result.value;
  if (result.status === 'corrupt') {
    const quarantined = await quarantineCorruptFile(file);
    logger.warn(
      `Last-run summary at ${file} is corrupted (${result.error.message}) and was ignored` +
        (quarantined ? ` -- the bad file was preserved at ${quarantined}.` : '.'),
    );
  }
  return undefined;
}
