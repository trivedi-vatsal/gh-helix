import type { Command } from 'commander';
import { createClient, parseAuthMode, resolveToken } from '../api/client.js';
import { discoverReposResilient } from '../api/discover.js';
import { loadConfig } from '../config/config.js';
import { logger } from '../logger/logger.js';
import { LockConflictError, withLock } from '../metadata/lock.js';
import { findOrphanDirs, moveToDeleted } from '../mirror/orphans.js';
import { ExitCode } from '../utils/errors.js';
import { handleCommandError } from '../utils/errorHandling.js';

interface GlobalOptions {
  env?: string;
  config?: string;
  logFile?: string;
}

interface CleanCommandOptions {
  dryRun?: boolean;
  refresh?: boolean;
  forceLock?: boolean;
  auth?: string;
}

/** Registers the `clean` command: moves orphaned local mirrors into `_deleted/`. */
export function registerCleanCommand(program: Command): void {
  program
    .command('clean')
    .description('Move local mirrors whose repository no longer exists on GitHub into _deleted/')
    .option('--dry-run', 'Show what would be moved without moving anything')
    .option('--refresh', 'Bypass the repository discovery cache and re-query the GitHub API')
    .option('--force-lock', 'Break an existing lock believed to be stale and proceed')
    .option('--auth <mode>', 'Authentication mode: auto | token | gh', 'auto')
    .action(async (options: CleanCommandOptions, command: Command) => {
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

        await withLock(
          config.backupDirectory,
          process.argv.slice(2).join(' ') || 'clean',
          { force: options.forceLock },
          async () => {
            const discovery = await discoverReposResilient(
              client,
              config.githubOrg,
              config.backupDirectory,
              { forceRefresh: options.refresh },
            );
            if (discovery.degraded) {
              logger.error(
                `Discovery is degraded: ${discovery.degradedReason}. Refusing to move anything ` +
                  'to _deleted/ based on stale data -- retry once the GitHub API is reachable again.',
              );
              process.exitCode = ExitCode.PartialFailure;
              return;
            }

            const orphans = await findOrphanDirs(
              config.backupDirectory,
              discovery.repos.map((repo) => repo.name),
            );

            if (orphans.length === 0) {
              logger.success('No orphaned repositories found.');
              process.exitCode = ExitCode.Success;
              return;
            }

            for (const dir of orphans) {
              if (options.dryRun) {
                logger.warn(`Would move "${dir}" to _deleted/ (dry run)`);
                continue;
              }
              const result = await moveToDeleted(config.backupDirectory, dir);
              logger.warn(`Moved "${dir}" to ${result.destination}`);
              if (result.staleSourceRemaining) {
                logger.warn(
                  `Could not remove the original copy at ${result.staleSourceRemaining} after the ` +
                    'move -- both copies currently exist; safe to delete the original manually.',
                );
              }
            }

            logger.heading('Clean Summary');
            logger.plain(`Orphans ${options.dryRun ? 'found' : 'moved'}: ${orphans.length}`);
            process.exitCode = ExitCode.Success;
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
