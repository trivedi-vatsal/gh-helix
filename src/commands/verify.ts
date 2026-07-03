import path from 'node:path';
import type { Command } from 'commander';
import { loadConfig } from '../config/config.js';
import { logger } from '../logger/logger.js';
import { LockConflictError, withLock } from '../metadata/lock.js';
import { DELETED_DIR_NAME, isRepoDirectory } from '../mirror/orphans.js';
import { verifyMirror } from '../mirror/verify.js';
import { ExitCode } from '../utils/errors.js';
import { handleCommandError } from '../utils/errorHandling.js';
import { listSubdirectories } from '../utils/fs.js';

interface GlobalOptions {
  env?: string;
  config?: string;
  logFile?: string;
}

interface VerifyCommandOptions {
  forceLock?: boolean;
}

/** Registers the `verify` command: runs `git fsck` against every local mirror. */
export function registerVerifyCommand(program: Command): void {
  program
    .command('verify')
    .description('Run git fsck against every local mirror and report failures')
    .option('--force-lock', 'Break an existing lock believed to be stale and proceed')
    .action(async (options: VerifyCommandOptions, command: Command) => {
      const globalOptions = command.optsWithGlobals<GlobalOptions>();
      logger.setLogFile(globalOptions.logFile);

      try {
        const config = loadConfig({
          envFilePath: globalOptions.env,
          configFilePath: globalOptions.config,
        });

        await withLock(
          config.backupDirectory,
          process.argv.slice(2).join(' ') || 'verify',
          { force: options.forceLock },
          async () => {
            const candidates = (await listSubdirectories(config.backupDirectory))
              .filter((dir) => dir !== DELETED_DIR_NAME)
              .sort();
            const isRepo = await Promise.all(
              candidates.map((dir) => isRepoDirectory(path.join(config.backupDirectory, dir))),
            );
            const dirs = candidates.filter((_dir, index) => isRepo[index]);

            if (dirs.length === 0) {
              logger.warn('No local mirrors found. Run "backup" first.');
              process.exitCode = ExitCode.Success;
              return;
            }

            let passed = 0;
            let failed = 0;

            for (const dir of dirs) {
              const mirrorPath = path.join(config.backupDirectory, dir);
              const result = await verifyMirror(mirrorPath);
              if (result.hasOrigin && result.fsckPassed) {
                logger.success(`${dir}: OK`);
                passed += 1;
              } else {
                logger.error(`${dir}: ${result.errors.join('; ')}`);
                failed += 1;
              }
            }

            logger.heading('Verify Summary');
            logger.plain(`Checked: ${dirs.length}`);
            logger.plain(`Passed:  ${passed}`);
            logger.plain(`Failed:  ${failed}`);

            process.exitCode = failed > 0 ? ExitCode.PartialFailure : ExitCode.Success;
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
