import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const serverRoot = path.resolve(import.meta.dirname, '..');
const sourceDir = path.join(serverRoot, 'src', 'services', 'word-service', 'dictionaries');
const targetDir = path.join(serverRoot, 'dist', 'services', 'word-service', 'dictionaries');

const run = async () => {
  await mkdir(targetDir, { recursive: true });
  await cp(sourceDir, targetDir, { recursive: true, force: true });
};

run().catch((error) => {
  globalThis.console.error('[copy-word-dictionaries] Failed to copy dictionaries.');
  globalThis.console.error(error);
  process.exit(1);
});
