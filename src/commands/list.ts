import type { Command } from 'commander';
import pc from 'picocolors';
import { createClient, parseAuthMode, resolveToken } from '../api/client.js';
import { discoverReposResilient } from '../api/discover.js';
import { loadConfig } from '../config/config.js';
import { logger } from '../logger/logger.js';
import { findOrphanDirs, mirrorDirName } from '../mirror/orphans.js';
import { ExitCode } from '../utils/errors.js';
import { handleCommandError } from '../utils/errorHandling.js';
import { listSubdirectories } from '../utils/fs.js';

interface GlobalOptions {
  env?: string;
  config?: string;
  logFile?: string;
}

interface ListCommandOptions {
  refresh?: boolean;
  auth?: string;
}

type RepoStatus = 'cloned' | 'missing' | 'archived';

function colorStatus(status: RepoStatus | 'orphan'): string {
  switch (status) {
    case 'cloned':
      return pc.green(status);
    case 'missing':
      return pc.red(status);
    case 'archived':
      return pc.yellow(status);
    case 'orphan':
      return pc.magenta(status);
  }
}

/** Registers the `list` command: shows every discovered repository and its local status. */
export function registerListCommand(program: Command): void {
  program
    .command('list')
    .description('List every repository in the organization and its local backup status')
    .option('--refresh', 'Bypass the repository discovery cache and re-query the GitHub API')
    .option('--auth <mode>', 'Authentication mode: auto | token | gh', 'auto')
    .action(async (options: ListCommandOptions, command: Command) => {
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
            `Discovery is degraded: ${discovery.degradedReason}. This list may be stale.`,
          );
        }
        const remoteRepos = discovery.repos;
        const localDirs = new Set(await listSubdirectories(config.backupDirectory));
        const orphans = await findOrphanDirs(
          config.backupDirectory,
          remoteRepos.map((repo) => repo.name),
        );

        const nameWidth = Math.max(4, ...remoteRepos.map((r) => r.name.length));

        for (const repo of remoteRepos.sort((a, b) => a.name.localeCompare(b.name))) {
          const exists = localDirs.has(mirrorDirName(repo.name));
          const status: RepoStatus = repo.isArchived ? 'archived' : exists ? 'cloned' : 'missing';
          logger.plain(`${repo.name.padEnd(nameWidth)}  ${colorStatus(status)}`);
        }

        if (orphans.length > 0) {
          logger.plain('');
          logger.plain('Orphaned local directories (no longer on GitHub):');
          for (const dir of orphans.sort()) {
            logger.plain(`${dir.padEnd(nameWidth)}  ${colorStatus('orphan')}`);
          }
        }

        await logger.flush();
        process.exitCode = ExitCode.Success;
      } catch (error) {
        process.exitCode = handleCommandError(error);
        await logger.flush();
      }
    });
}
