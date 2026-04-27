#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const BUMP_TYPES = ['patch', 'minor', 'major'];

const bumpType = process.argv[2];
if (!bumpType || !BUMP_TYPES.includes(bumpType)) {
  console.error(`Usage: node scripts/release.mjs <patch|minor|major>`);
  process.exit(1);
}

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = resolve(rootDir, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

const [major, minor, patch] = pkg.version.split('.').map(Number);

let newVersion;
if (bumpType === 'major') newVersion = `${major + 1}.0.0`;
else if (bumpType === 'minor') newVersion = `${major}.${minor + 1}.0`;
else newVersion = `${major}.${minor}.${patch + 1}`;

const oldVersion = pkg.version;
pkg.version = newVersion;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');

console.log(`Version bumped: ${oldVersion} → ${newVersion}`);

const tag = `v${newVersion}`;

try {
  execSync('git add package.json', { stdio: 'inherit', cwd: rootDir });
  execSync(`git commit -m "chore(release): release ${tag}"`, { stdio: 'inherit', cwd: rootDir });
  execSync(`git tag ${tag}`, { stdio: 'inherit', cwd: rootDir });
  console.log(`Git tag created: ${tag}`);
} catch (err) {
  console.error('Git error:', err.message);
  process.exit(1);
}
