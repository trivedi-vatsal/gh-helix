#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { registerBackupCommand } from './commands/backup.js';
import { registerCleanCommand } from './commands/clean.js';
import { registerHealthCommand } from './commands/health.js';
import { registerListCommand } from './commands/list.js';
import { registerRestoreCommand } from './commands/restore.js';
import { registerStatusCommand } from './commands/status.js';
import { registerVerifyCommand } from './commands/verify.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(moduleDir, '..', 'package.json'), 'utf8')) as {
  version: string;
};

const program = new Command();

program
  .name('gh-helix')
  .description(
    'A production-grade Git repository mirror and disaster recovery tool for GitHub organizations.',
  )
  .version(pkg.version)
  .option('-e, --env <path>', 'Path to a .env file (defaults to .env in the current directory)')
  .option(
    '-c, --config <path>',
    'Path to a config.json file (defaults to config.json in the current directory)',
  )
  .option('-l, --log-file <path>', 'Append all log output to this file');

registerBackupCommand(program);
registerStatusCommand(program);
registerVerifyCommand(program);
registerListCommand(program);
registerCleanCommand(program);
registerRestoreCommand(program);
registerHealthCommand(program);

async function main(): Promise<void> {
  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 4;
});
