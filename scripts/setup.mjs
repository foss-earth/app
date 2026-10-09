#!/usr/bin/env node
// Earth owns this small caller; Platform owns all setup/clone/link machinery.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const seal = JSON.parse(readFileSync(new URL('../installer-release.json', import.meta.url), 'utf8'));
const entry = fileURLToPath(import.meta.resolve('@foss-earth/dev-installer'));
const root = resolve(dirname(entry), '..');
for (const [path, expected] of Object.entries(seal.runtimeFiles)) {
  const target = resolve(root, path);
  const within = relative(root, target);
  if (within === '..' || within.startsWith('../') || isAbsolute(within)) throw new Error('Invalid installer seal path.');
  const actual = createHash('sha256').update(readFileSync(target)).digest('hex');
  if (actual !== expected) throw new Error(`Installed shared installer does not match reviewed ${seal.revision}: ${path}`);
}
const { runCli } = await import('@foss-earth/dev-installer');
// No default descriptor exists until the complete application closure is qualified.
const result = await runCli();
process.exitCode = result.exitCode;
