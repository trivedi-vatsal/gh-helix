import type { Command } from 'commander';
import { createClient, parseAuthMode, resolveToken } from '../api/client.js';
import { discoverReposResilient } from '../api/discover.js';
import { loadConfig } from '../config/config.js';
import { logger } from '../logger/logger.js';
import { loadLastRun } from '../metadata/manifest.js';
import { findOrphanDirs, mirrorDirName } from '../mirror/orphans.js';
import { ExitCode } from '../utils/errors.js';
import { handleCommandError } from '../utils/errorHandling.js';
import { formatBytes, listSubdirectories } from '../utils/fs.js';

interface GlobalOptions {
  env?: string;
  config?: string;
  logFile?: string;
}

interface StatusCommandOptions {
  refresh?: boolean;
  auth?: string;
}

/** Registers the `status` command: reports counts, disk usage, and drift from GitHub. */
export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show repository counts, disk usage, last sync time, and drift from GitHub')
    .option('--refresh', 'Bypass the repository discovery cache and re-query the GitHub API')
    .option('--auth <mode>', 'Authentication mode: auto | token | gh', 'auto')
    .action(async (options: StatusCommandOptions, command: Command) => {
      const globalOptions = command.optsWithGlobals<GlobalOptions>();
      logger.setLogFile(globalOptions.logFile);

      try {
        const config = loadConfig({
          envFilePath: globalOptions.env,
          configFilePath: globalOptions.config,
        });
        const authMode = parseAuthMode(options.auth ?? config.authMode);
        const token = await resolveToken(
          { envFilePath: globalOptions.env, configFilePath: globalOptions.config },
          config.ghHost,
          authMode,
        );
        const client = createClient(token, config.githubApiUrl);

        const discovery = await discoverReposResilient(
          client,
          config.githubOrg,
          config.backupDirectory,
          { forceRefresh: options.refresh },
        );
        if (discovery.degraded) {
          logger.warn(
            `Discovery is degraded: ${discovery.degradedReason}. Figures below may be stale.`,
          );
        }
        const remoteRepos = discovery.repos;
        const localDirs = new Set(await listSubdirectories(config.backupDirectory));
        const lastRun = await loadLastRun(config.backupDirectory);

        const mirroredCount = remoteRepos.filter((repo) =>
          localDirs.has(mirrorDirName(repo.name)),
        ).length;
        const missing = remoteRepos.filter((repo) => !localDirs.has(mirrorDirName(repo.name)));
        const orphans = await findOrphanDirs(
          config.backupDirectory,
          remoteRepos.map((repo) => repo.name),
        );
        const archivedCount = remoteRepos.filter((repo) => repo.isArchived).length;
        const totalSizeBytes = remoteRepos.reduce((sum, repo) => sum + repo.sizeKb * 1024, 0);

        const withCreatedAt = remoteRepos.filter((repo) => repo.createdAt);
        const oldest = withCreatedAt.reduce<(typeof remoteRepos)[number] | undefined>(
          (acc, repo) => (!acc || repo.createdAt! < acc.createdAt! ? repo : acc),
          undefined,
        );
        const newest = withCreatedAt.reduce<(typeof remoteRepos)[number] | undefined>(
          (acc, repo) => (!acc || repo.createdAt! > acc.createdAt! ? repo : acc),
          undefined,
        );

        logger.heading(`Status: ${config.githubOrg}`);
        logger.plain(`Repository count:      ${remoteRepos.length}`);
        logger.plain(`Mirrored count:        ${mirroredCount}`);
        logger.plain(`Failed count (last run): ${lastRun?.failed ?? 'unknown'}`);
        logger.plain(`Orphaned count:        ${orphans.length}`);
        logger.plain(`Archived count:        ${archivedCount}`);
        logger.plain(
          `Total disk usage:      ${formatBytes(totalSizeBytes)} (approximate, from GitHub)`,
        );
        logger.plain(`Last sync:             ${lastRun?.timestamp ?? 'never'}`);
        logger.plain(
          `Oldest repository:     ${oldest ? `${oldest.name} (${oldest.createdAt})` : 'n/a'}`,
        );
        logger.plain(
          `Newest repository:     ${newest ? `${newest.name} (${newest.createdAt})` : 'n/a'}`,
        );

        if (missing.length > 0) {
          logger.plain(`Missing repositories:  ${missing.length}`);
          for (const repo of missing) logger.warn(`  missing: ${repo.name}`);
        }
        if (orphans.length > 0) {
          for (const dir of orphans) logger.warn(`  orphan: ${dir}`);
        }

        await logger.flush();
        process.exitCode = ExitCode.Success;
      } catch (error) {
        process.exitCode = handleCommandError(error);
        await logger.flush();
      }
    });
}
