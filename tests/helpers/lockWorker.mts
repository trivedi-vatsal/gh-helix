import { writeFile } from 'node:fs/promises';
import { acquireLock } from '../../src/metadata/lock.js';

const [, , backupDirectory, command, holdMsRaw, signalFile] = process.argv;
if (!backupDirectory || !command || !holdMsRaw || !signalFile) {
  console.error('usage: lockWorker.mts <backupDirectory> <command> <holdMs> <signalFile>');
  process.exit(2);
}

try {
  const lock = await acquireLock(backupDirectory, command);
  await writeFile(signalFile, 'acquired', 'utf8');
  await new Promise((resolve) => setTimeout(resolve, Number(holdMsRaw)));
  await lock.release();
  process.exit(0);
} catch (error) {
  await writeFile(
    signalFile,
    `conflict:${error instanceof Error ? error.name : 'unknown'}`,
    'utf8',
  );
  process.exit(1);
}
