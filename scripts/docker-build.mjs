#!/usr/bin/env node
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf-8'));
const version = pkg.version;

console.log(`Building Docker images for version ${version}...`);

execSync('docker compose build', {
  stdio: 'inherit',
  cwd: rootDir,
  env: { ...process.env, APP_VERSION: version },
});
