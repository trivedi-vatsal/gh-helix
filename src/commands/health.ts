import { statfs, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Command } from 'commander';
import { checkApiConnectivity, createClient, parseAuthMode, resolveToken } from '../api/client.js';
import type { AuthMode } from '../api/client.js';
import { loadConfig } from '../config/config.js';
import { logger } from '../logger/logger.js';
import { AuthenticationError } from '../utils/errors.js';
import { handleCommandError } from '../utils/errorHandling.js';
import { CommandError, runCommand, runGit } from '../utils/exec.js';
import { ensureDir, formatBytes } from '../utils/fs.js';

interface GlobalOptions {
  env?: string;
  config?: string;
  logFile?: string;
}

interface HealthCommandOptions {
  auth?: string;
}

type CheckStatus = 'pass' | 'warn' | 'fail';

interface HealthCheck {
  name: string;
  status: CheckStatus;
  message: string;
}

function logCheck(check: HealthCheck): void {
  const line = `${check.name}: ${check.message}`;
  if (check.status === 'pass') logger.success(line);
  else if (check.status === 'warn') logger.warn(line);
  else logger.error(line);
}

async function checkGitInstalled(): Promise<HealthCheck> {
  try {
    const result = await runGit(['--version']);
    return { name: 'Git', status: 'pass', message: result.stdout.trim() };
  } catch {
    return { name: 'Git', status: 'fail', message: 'git not found on PATH' };
  }
}

async function checkGitLfsInstalled(fetchLfsEnabled: boolean): Promise<HealthCheck> {
  try {
    const result = await runCommand('git', ['lfs', 'version']);
    return { name: 'Git LFS', status: 'pass', message: result.stdout.trim() };
  } catch {
    return {
      name: 'Git LFS',
      status: fetchLfsEnabled ? 'fail' : 'warn',
      message: fetchLfsEnabled
        ? 'git-lfs not found on PATH but FETCH_LFS=true'
        : 'git-lfs not found on PATH (FETCH_LFS=false, not required)',
    };
  }
}

async function checkBackupDirectory(backupDirectory: string): Promise<HealthCheck> {
  try {
    await ensureDir(backupDirectory);
    return { name: 'Backup directory', status: 'pass', message: backupDirectory };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { name: 'Backup directory', status: 'fail', message };
  }
}

async function checkDiskPermissions(backupDirectory: string): Promise<HealthCheck> {
  const probePath = path.join(backupDirectory, `.health-check-${Date.now()}.tmp`);
  try {
    await writeFile(probePath, 'ok', 'utf8');
    await unlink(probePath);
    return { name: 'Disk permissions', status: 'pass', message: 'read/write OK' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { name: 'Disk permissions', status: 'fail', message };
  }
}

const LOW_DISK_SPACE_BYTES = 1024 * 1024 * 1024; // 1 GB

async function checkDiskSpace(backupDirectory: string): Promise<HealthCheck> {
  try {
    const stats = await statfs(backupDirectory);
    const freeBytes = stats.bavail * stats.bsize;
    return {
      name: 'Available disk space',
      status: freeBytes < LOW_DISK_SPACE_BYTES ? 'warn' : 'pass',
      message: formatBytes(freeBytes),
    };
  } catch {
    return {
      name: 'Available disk space',
      status: 'warn',
      message: 'could not be determined on this platform',
    };
  }
}

async function checkAuthentication(
  configOptions: { envFilePath?: string; configFilePath?: string },
  ghHost?: string,
  authMode: AuthMode = 'auto',
): Promise<{ check: HealthCheck; token?: string }> {
  try {
    const token = await resolveToken(configOptions, ghHost, authMode);
    return { check: { name: 'Authentication', status: 'pass', message: 'token resolved' }, token };
  } catch (error) {
    const message = error instanceof AuthenticationError ? error.message : errorMessage(error);
    return { check: { name: 'Authentication', status: 'fail', message } };
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof CommandError) return error.stderr || error.message;
  return error instanceof Error ? error.message : String(error);
}

/** Registers the `health` command: checks the environment this tool depends on. */
export function registerHealthCommand(program: Command): void {
  program
    .command('health')
    .description('Check Git, Git LFS, authentication, API connectivity, and disk health')
    .option('--auth <mode>', 'Authentication mode: auto | token | gh', 'auto')
    .action(async (options: HealthCommandOptions, command: Command) => {
      const globalOptions = command.optsWithGlobals<GlobalOptions>();
      logger.setLogFile(globalOptions.logFile);

      try {
        const config = loadConfig({
          envFilePath: globalOptions.env,
          configFilePath: globalOptions.config,
        });
        const configOptions = {
          envFilePath: globalOptions.env,
          configFilePath: globalOptions.config,
        };
        const authMode = parseAuthMode(options.auth ?? config.authMode);

        logger.heading('Health Report');

        const checks: HealthCheck[] = [];
        checks.push(await checkGitInstalled());
        checks.push(await checkGitLfsInstalled(config.fetchLfs));
        checks.push(await checkBackupDirectory(config.backupDirectory));
        checks.push(await checkDiskPermissions(config.backupDirectory));
        checks.push(await checkDiskSpace(config.backupDirectory));

        const { check: authCheck, token } = await checkAuthentication(
          configOptions,
          config.ghHost,
          authMode,
        );
        checks.push(authCheck);

        if (token) {
          const client = createClient(token, config.githubApiUrl);
          const connectivity = await checkApiConnectivity(client);
          checks.push({
            name: 'API connectivity',
            status: connectivity.ok ? 'pass' : 'fail',
            message: connectivity.message,
          });
        } else {
          checks.push({
            name: 'API connectivity',
            status: 'fail',
            message: 'skipped -- no token available',
          });
        }

        for (const check of checks) logCheck(check);

        const failed = checks.filter((c) => c.status === 'fail').length;
        const warned = checks.filter((c) => c.status === 'warn').length;

        logger.heading('Health Summary');
        logger.plain(`Checks passed: ${checks.length - failed - warned}/${checks.length}`);
        logger.plain(`Warnings:      ${warned}`);
        logger.plain(`Failures:      ${failed}`);

        await logger.flush();
        process.exitCode = failed > 0 ? 1 : 0;
      } catch (error) {
        process.exitCode = handleCommandError(error);
        await logger.flush();
      }
    });
}
