import path from 'node:path';
import type { Command } from 'commander';
import { loadConfig } from '../config/config.js';
import { logger } from '../logger/logger.js';
import { LockConflictError, withLock } from '../metadata/lock.js';
import { mirrorDirName } from '../mirror/orphans.js';
import {
  restoreFromMirror,
  RestoreDestinationExistsError,
  RestoreLfsError,
} from '../mirror/restore.js';
import { ExitCode } from '../utils/errors.js';
import { handleCommandError } from '../utils/errorHandling.js';
import { pathExists } from '../utils/fs.js';

interface GlobalOptions {
  env?: string;
  config?: string;
  logFile?: string;
}

interface RestoreCommandOptions {
  destination?: string;
  forceLock?: boolean;
}

/**
 * Registers the `restore` command: clones a working copy from a local mirror,
 * entirely offline (no GitHub access required), rehydrating Git LFS objects
 * when the repository uses them.
 */
export function registerRestoreCommand(program: Command): void {
  program
    .command('restore <repository>')
    .description('Restore a working clone from a local mirror (offline, no GitHub access needed)')
    .option('--destination <path>', 'Where to clone the working copy (defaults to ./<repository>)')
    .option('--force-lock', 'Break an existing lock believed to be stale and proceed')
    .action(async (repository: string, options: RestoreCommandOptions, command: Command) => {
      const globalOptions = command.optsWithGlobals<GlobalOptions>();
      logger.setLogFile(globalOptions.logFile);

      try {
        const config = loadConfig({
          envFilePath: globalOptions.env,
          configFilePath: globalOptions.config,
        });

        await withLock(
          config.backupDirectory,
          process.argv.slice(2).join(' ') || 'restore',
          { force: options.forceLock },
          async () => {
            const mirrorPath = path.join(config.backupDirectory, mirrorDirName(repository));

            if (!(await pathExists(mirrorPath))) {
              logger.error(`No local mirror found for "${repository}". Run "backup" first.`);
              process.exitCode = ExitCode.FatalError;
              return;
            }

            const destination = path.resolve(
              options.destination ?? path.join(process.cwd(), repository),
            );
            const result = await restoreFromMirror(mirrorPath, destination);

            if (result.lfsRestored === true) {
              logger.success(
                `Restored "${repository}" to ${destination} (Git LFS objects rehydrated)`,
              );
            } else {
              logger.success(`Restored "${repository}" to ${destination}`);
            }
            process.exitCode = ExitCode.Success;
          },
        );
        await logger.flush();
      } catch (error) {
        if (error instanceof RestoreDestinationExistsError) {
          logger.error(error.message);
          process.exitCode = ExitCode.FatalError;
        } else if (error instanceof RestoreLfsError) {
          logger.error(error.message);
          process.exitCode = ExitCode.PartialFailure;
        } else if (error instanceof LockConflictError) {
          logger.error(error.message);
          process.exitCode = ExitCode.FatalError;
        } else {
          process.exitCode = handleCommandError(error);
        }
        await logger.flush();
      }
    });
}
