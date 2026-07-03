import path from 'node:path';
import type { Command } from 'commander';
import pLimit from 'p-limit';
import pc from 'picocolors';
import { createClient, parseAuthMode, resolveToken } from '../api/client.js';
import { discoverReposResilient } from '../api/discover.js';
import type { RemoteRepo } from '../api/types.js';
import { loadConfig } from '../config/config.js';
import { logger } from '../logger/logger.js';
import { buildCache, cachePath, loadCache } from '../metadata/cache.js';
import type { CachedRepoEntry } from '../metadata/cache.js';
import { LockConflictError, withLock } from '../metadata/lock.js';
import { loadManifest, writeManifest } from '../metadata/manifest.js';
import type { BackupManifest, RepoManifestEntry, RepoStatus } from '../metadata/manifest.js';
import type { MetadataFileWrite } from '../metadata/transaction.js';
import { selectCloneUrl } from '../mirror/auth.js';
import { cloneMirror } from '../mirror/clone.js';
import { getLastCommitSha } from '../mirror/inspect.js';
import { fetchLfsAll } from '../mirror/lfs.js';
import { findOrphanDirs, mirrorDirName, moveToDeleted } from '../mirror/orphans.js';
import { renameMirror } from '../mirror/rename.js';
import { updateMirror } from '../mirror/update.js';
import { verifyMirror } from '../mirror/verify.js';
import type { AppConfig } from '../config/types.js';
import { ExitCode } from '../utils/errors.js';
import { handleCommandError } from '../utils/errorHandling.js';
import { shouldIncludeRepo } from '../utils/filter.js';
import { ensureDir, pathExists } from '../utils/fs.js';
import { parsePositiveInt } from '../utils/number.js';
import { retry } from '../utils/retry.js';
import { formatElapsed, nowIso } from '../utils/time.js';

/** Options accepted by the `backup` command. */
interface BackupCommandOptions {
  dryRun?: boolean;
  include?: string[];
  exclude?: string[];
  report?: string;
  retries?: string;
  refresh?: boolean;
  forceLock?: boolean;
  auth?: string;
}

interface GlobalOptions {
  env?: string;
  config?: string;
  logFile?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface ProcessContext {
  config: AppConfig;
  token: string | undefined;
  dryRun: boolean;
  retries: number;
  previousRepos: Record<string, CachedRepoEntry>;
  previousManifestByName: Map<string, RepoManifestEntry>;
}

async function processRepo(repo: RemoteRepo, ctx: ProcessContext): Promise<RepoManifestEntry> {
  const localDirName = mirrorDirName(repo.name);
  const localPath = path.join(ctx.config.backupDirectory, localDirName);
  let renamedFrom: string | undefined;

  const previous = ctx.previousRepos[repo.id];
  if (previous && previous.localDir !== localDirName && !(await pathExists(localPath))) {
    const oldPath = path.join(ctx.config.backupDirectory, previous.localDir);
    if (ctx.dryRun) {
      if (await pathExists(oldPath)) {
        logger.warn(`Would rename "${previous.name}" -> "${repo.name}" (dry run)`);
        renamedFrom = previous.name;
      }
    } else {
      try {
        const result = await renameMirror(
          oldPath,
          localPath,
          selectCloneUrl(repo, ctx.token),
          ctx.token,
        );
        logger.warn(`Renamed "${previous.name}" -> "${repo.name}"`);
        if (result.staleSourceRemaining) {
          logger.warn(
            `Could not remove the old directory at ${result.staleSourceRemaining} after ` +
              'renaming -- both copies currently exist; safe to delete the original manually.',
          );
        }
        renamedFrom = previous.name;
      } catch (error) {
        logger.error(
          `Failed to rename "${previous.name}" -> "${repo.name}": ${errorMessage(error)}`,
        );
      }
    }
  }

  const exists = await pathExists(localPath);
  const previousManifestEntry = ctx.previousManifestByName.get(repo.name);
  const baseEntry = {
    name: repo.name,
    defaultBranch: repo.defaultBranch,
    archived: repo.isArchived,
    mirrorPath: localPath,
    sizeKb: repo.sizeKb,
    renamedFrom,
  };

  if (repo.isArchived && exists) {
    logger.warn(`Archived repo skipped: ${repo.name}`);
    return {
      ...baseEntry,
      status: 'skipped-archived',
      lfsFetched: previousManifestEntry?.lfsFetched ?? null,
      lastFetchedAt: previousManifestEntry?.lastFetchedAt ?? null,
      lastCommitSha: previousManifestEntry?.lastCommitSha ?? null,
    };
  }

  if (ctx.dryRun) {
    const status: RepoStatus = exists ? 'would-update' : 'would-clone';
    logger.info(`Would ${exists ? 'update' : 'clone'} ${repo.name} (dry run)`);
    return {
      ...baseEntry,
      status,
      lfsFetched: previousManifestEntry?.lfsFetched ?? null,
      lastFetchedAt: previousManifestEntry?.lastFetchedAt ?? null,
      lastCommitSha: previousManifestEntry?.lastCommitSha ?? null,
    };
  }

  const cloneUrl = selectCloneUrl(repo, ctx.token);
  let lfsFetched: boolean | null = null;
  let lfsError: string | undefined;

  try {
    if (!exists) {
      await retry(() => cloneMirror(cloneUrl, localPath, ctx.token), { retries: ctx.retries });
      logger.success(`Cloned ${repo.name}`);
    } else {
      await retry(() => updateMirror(localPath, cloneUrl, repo.defaultBranch ?? 'main', ctx.token), { retries: ctx.retries });
      logger.success(`Updated ${repo.name}`);
    }

    if (ctx.config.fetchLfs) {
      try {
        await retry(() => fetchLfsAll(localPath, ctx.token), { retries: 2 });
        lfsFetched = true;
      } catch (error) {
        // A "successful" backup that's missing LFS objects is not actually
        // disaster-recoverable, so this counts as a real failure, not a warning.
        lfsFetched = false;
        lfsError = errorMessage(error);
        logger.error(`LFS fetch failed for ${repo.name}: ${lfsError}`);
      }
    }

    const validation = await verifyMirror(localPath);
    const lastCommitSha = (await getLastCommitSha(localPath)) ?? null;

    const problems = [...validation.errors];
    if (lfsError) problems.push(`LFS fetch failed: ${lfsError}`);

    if (problems.length > 0) {
      const error = problems.join('; ');
      if (!lfsError || validation.errors.length > 0) {
        logger.error(
          `Validation failed for ${repo.name}: ${validation.errors.join('; ') || error}`,
        );
      }
      return {
        ...baseEntry,
        status: 'failed',
        error,
        lfsFetched,
        lastFetchedAt: nowIso(),
        lastCommitSha,
      };
    }

    return {
      ...baseEntry,
      status: exists ? 'updated' : 'cloned',
      lfsFetched,
      lastFetchedAt: nowIso(),
      lastCommitSha,
    };
  } catch (error) {
    const message = errorMessage(error);
    logger.error(`Failed to ${exists ? 'update' : 'clone'} ${repo.name}: ${message}`);
    return {
      ...baseEntry,
      status: 'failed',
      error: message,
      lfsFetched,
      lastFetchedAt: previousManifestEntry?.lastFetchedAt ?? null,
      lastCommitSha: previousManifestEntry?.lastCommitSha ?? null,
    };
  }
}

function printSummary(manifest: BackupManifest, renamedCount: number): void {
  logger.heading(manifest.dryRun ? 'Backup Summary (dry run)' : 'Backup Summary');
  if (manifest.discoveryDegraded) {
    logger.plain(
      pc.yellow('Discovery:            degraded (GitHub API unreachable, used cached data)'),
    );
  }
  logger.plain(`Repositories Found:   ${manifest.totalRepositories}`);
  logger.plain(`Repositories Cloned:  ${manifest.cloned}`);
  logger.plain(`Repositories Updated: ${manifest.updated}`);
  logger.plain(`Repositories Archived: ${manifest.archived}`);
  logger.plain(`Repositories Skipped: ${manifest.skipped}`);
  logger.plain(`Repositories Renamed: ${renamedCount}`);
  logger.plain(
    manifest.failed > 0
      ? pc.red(`Repositories Failed:  ${manifest.failed}`)
      : `Repositories Failed:  ${manifest.failed}`,
  );
  logger.plain(`Elapsed Time:         ${formatElapsed(manifest.elapsedTimeMs)}`);
}

/** Registers the `backup` command: discovers and mirrors every repo in the org. */
export function registerBackupCommand(program: Command): void {
  program
    .command('backup')
    .description('Synchronize local mirrors with every repository in the configured organization')
    .option('--dry-run', 'Show what would happen without cloning, updating, or moving anything')
    .option('--include <patterns...>', 'Only process repositories matching these glob patterns')
    .option('--exclude <patterns...>', 'Skip repositories matching these glob patterns')
    .option('--report <path>', 'Also write the backup manifest to this path')
    .option('--retries <n>', 'Retry attempts for transient clone/update failures', '3')
    .option('--refresh', 'Bypass the repository discovery cache and re-query the GitHub API')
    .option('--force-lock', 'Break an existing lock believed to be stale and proceed')
    .option('--auth <mode>', 'Authentication mode: auto | token | gh', 'auto')
    .action(async (options: BackupCommandOptions, command: Command) => {
      const globalOptions = command.optsWithGlobals<GlobalOptions>();
      logger.setLogFile(globalOptions.logFile);
      const dryRun = options.dryRun ?? false;

      try {
        const config = loadConfig({
          envFilePath: globalOptions.env,
          configFilePath: globalOptions.config,
        });
        const configOptions = {
          envFilePath: globalOptions.env,
          configFilePath: globalOptions.config,
        };
        const retries = parsePositiveInt(options.retries, 3, '--retries');
        const authMode = parseAuthMode(options.auth ?? config.authMode);
        const token = await resolveToken(configOptions, config.ghHost, authMode);
        const client = createClient(token, config.githubApiUrl);
        await ensureDir(config.backupDirectory);

        await withLock(
          config.backupDirectory,
          process.argv.slice(2).join(' ') || 'backup',
          { force: options.forceLock },
          async () => {
            const startedAt = Date.now();
            const previousCache = await loadCache(config.backupDirectory);
            const previousManifest = await loadManifest(config.backupDirectory);
            const previousManifestByName = new Map(
              (previousManifest?.repositories ?? []).map((entry) => [entry.name, entry]),
            );

            logger.info(`Discovering repositories in "${config.githubOrg}"...`);
            const discovery = await discoverReposResilient(
              client,
              config.githubOrg,
              config.backupDirectory,
              { forceRefresh: options.refresh, persistCache: false },
            );
            const remoteRepos = discovery.repos;
            if (discovery.degraded) {
              logger.warn(
                `Discovery is degraded: ${discovery.degradedReason}. Proceeding with ` +
                  'previously known repositories only -- orphan detection is skipped this run.',
              );
            }
            logger.info(`Found ${remoteRepos.length} repositories`);

            const filteredRepos = remoteRepos.filter((repo) =>
              shouldIncludeRepo(repo.name, repo.nameWithOwner, {
                include: options.include,
                exclude: options.exclude,
              }),
            );
            const skippedFiltered = remoteRepos.length - filteredRepos.length;
            if (skippedFiltered > 0) {
              logger.info(
                `Skipped ${skippedFiltered} repositories excluded by include/exclude filters`,
              );
            }

            const limit = pLimit(config.maxParallel);
            const ctx: ProcessContext = {
              config,
              token,
              dryRun,
              retries,
              previousRepos: previousCache.repos,
              previousManifestByName,
            };

            const repositories: RepoManifestEntry[] = await Promise.all(
              filteredRepos.map((repo) => limit(() => processRepo(repo, ctx))),
            );

            // Orphan detection relies on the remote list being ground truth;
            // skip it when discovery fell back to a stale cache, or repos
            // could be moved to _deleted based on data that no longer
            // reflects GitHub.
            let orphansMoved = 0;
            if (!discovery.degraded) {
              const orphanDirs = await findOrphanDirs(
                config.backupDirectory,
                remoteRepos.map((repo) => repo.name),
              );
              for (const dir of orphanDirs) {
                if (dryRun) {
                  logger.warn(`Would move orphaned repository "${dir}" to _deleted/ (dry run)`);
                } else {
                  const result = await moveToDeleted(config.backupDirectory, dir);
                  logger.warn(
                    `Orphaned repository "${dir}" no longer exists on GitHub -- moved to ${result.destination}`,
                  );
                  if (result.staleSourceRemaining) {
                    logger.warn(
                      `Could not remove the original copy at ${result.staleSourceRemaining} -- ` +
                        'both copies currently exist; safe to delete the original manually.',
                    );
                  }
                }
                orphansMoved += 1;
              }
            }

            const renamedCount = repositories.filter((r) => Boolean(r.renamedFrom)).length;
            const manifest: BackupManifest = {
              organization: config.githubOrg,
              timestamp: nowIso(),
              totalRepositories: remoteRepos.length,
              cloned: repositories.filter((r) => r.status === 'cloned').length,
              updated: repositories.filter((r) => r.status === 'updated').length,
              failed: repositories.filter((r) => r.status === 'failed').length,
              archived: remoteRepos.filter((r) => r.isArchived).length,
              skipped:
                skippedFiltered +
                repositories.filter((r) => r.status === 'skipped-archived').length,
              elapsedTimeMs: Date.now() - startedAt,
              dryRun,
              discoveryDegraded: discovery.degraded,
              repositories,
            };

            // repositories.json, manifest.json, and last-run.json are
            // committed together as one metadata transaction (requirement
            // #5): the cache is only included when discovery was live (never
            // rewrite it with stale data) and only outside dry runs (which
            // must leave all tracked state untouched).
            const extraTransactionFiles: MetadataFileWrite[] = [];
            if (!discovery.degraded && !dryRun) {
              extraTransactionFiles.push({
                path: cachePath(config.backupDirectory),
                content: JSON.stringify(buildCache(remoteRepos), null, 2),
              });
            }

            await writeManifest(config.backupDirectory, manifest, {
              extraReportPath: options.report,
              canonical: !dryRun,
              extraTransactionFiles,
            });
            if (options.report) logger.info(`Report written to ${options.report}`);
            if (orphansMoved > 0) logger.info(`Orphans moved: ${orphansMoved}`);

            printSummary(manifest, renamedCount);
            process.exitCode =
              manifest.failed > 0 || manifest.discoveryDegraded
                ? ExitCode.PartialFailure
                : ExitCode.Success;
          },
        );
        await logger.flush();
      } catch (error) {
        if (error instanceof LockConflictError) {
          logger.error(error.message);
          process.exitCode = ExitCode.FatalError;
        } else {
          process.exitCode = handleCommandError(error);
        }
        await logger.flush();
      }
    });
}
