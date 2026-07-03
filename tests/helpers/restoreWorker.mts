import { restoreFromMirror } from '../../src/mirror/restore.js';

const [, , mirrorPath, destination] = process.argv;
if (!mirrorPath || !destination) {
  console.error('usage: restoreWorker.mts <mirrorPath> <destination>');
  process.exit(2);
}

await restoreFromMirror(mirrorPath, destination);
process.exit(0);
