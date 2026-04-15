import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(import.meta.dirname, '..');
const sharedPackageDir = path.join(repoRoot, 'packages', 'shared');
const sharedDistDir = path.join(sharedPackageDir, 'dist');
const rebuildCommand = 'npm run build -w @skribbl/shared';

const listFilesRecursively = async (directory, baseDir = directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursively(absolutePath, baseDir)));
      continue;
    }

    if (entry.isFile()) {
      files.push(path.relative(baseDir, absolutePath).replaceAll('\\', '/'));
    }
  }

  files.sort();
  return files;
};

const compareDirectories = async (leftDir, rightDir) => {
  const leftFiles = await listFilesRecursively(leftDir);
  const rightFiles = await listFilesRecursively(rightDir);

  if (leftFiles.length !== rightFiles.length) {
    return false;
  }

  for (let index = 0; index < leftFiles.length; index += 1) {
    const leftRelativePath = leftFiles[index];
    const rightRelativePath = rightFiles[index];

    if (leftRelativePath !== rightRelativePath) {
      return false;
    }

    const [leftContent, rightContent] = await Promise.all([
      readFile(path.join(leftDir, leftRelativePath)),
      readFile(path.join(rightDir, rightRelativePath)),
    ]);

    if (!leftContent.equals(rightContent)) {
      return false;
    }
  }

  return true;
};

const failWithInstruction = (message) => {
  globalThis.console.error('\n[check:dist-sync] ' + message);
  globalThis.console.error('[check:dist-sync] Чтобы пересобрать dist, запустите:');
  globalThis.console.error(`[check:dist-sync]   ${rebuildCommand}\n`);
  process.exit(1);
};

const ensureDistExists = async () => {
  try {
    const stats = await stat(sharedDistDir);
    if (!stats.isDirectory()) {
      failWithInstruction('Ожидалась директория packages/shared/dist, но найден не каталог.');
    }
  } catch {
    failWithInstruction('Директория packages/shared/dist не найдена.');
  }
};

const generateSharedBuildInTemp = (outputDirectory) => {
  const npmCliPath = process.env.npm_execpath;
  const command = npmCliPath ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const commandArgs = npmCliPath
    ? [npmCliPath, 'run', 'build', '-w', '@skribbl/shared', '--', '--outDir', outputDirectory]
    : ['run', 'build', '-w', '@skribbl/shared', '--', '--outDir', outputDirectory];
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  });

  if (result.status !== 0) {
    globalThis.console.error(
      '\n[check:dist-sync] Не удалось собрать временный build для проверки sync.',
    );
    if (result.error) {
      globalThis.console.error(result.error.message);
    }
    if (result.stdout) {
      globalThis.console.error(result.stdout.trim());
    }
    if (result.stderr) {
      globalThis.console.error(result.stderr.trim());
    }
    failWithInstruction('Проверка не выполнена из-за ошибки сборки @skribbl/shared.');
  }
};

const run = async () => {
  await ensureDistExists();

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'skribbl-shared-dist-check-'));
  const generatedDistDir = path.join(tempRoot, 'dist');

  try {
    generateSharedBuildInTemp(generatedDistDir);
    const isSynced = await compareDirectories(sharedDistDir, generatedDistDir);

    if (!isSynced) {
      failWithInstruction('Обнаружен рассинхрон между packages/shared/src и packages/shared/dist.');
    }

    globalThis.console.log('[check:dist-sync] packages/shared/dist синхронизирован.');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
};

run().catch((error) => {
  globalThis.console.error('\n[check:dist-sync] Непредвиденная ошибка проверки.');
  globalThis.console.error(error);
  failWithInstruction('Проверка завершилась с ошибкой.');
});
