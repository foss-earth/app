/** Qualify emitted imports, so moving an optional renderer into shared code fails CI. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const manifest = JSON.parse(await readFile(new URL('../dist/.vite/manifest.json', import.meta.url), 'utf8'));
function entry(name) {
  const match = Object.entries(manifest).find(([, chunk]) => chunk.name === name && chunk.isDynamicEntry);
  assert(match, `${name} must remain a separate dynamic entry`);
  return match[0];
}
function imports(key, found = new Set()) {
  if (found.has(key)) return found;
  assert(manifest[key], `Missing chunk ${key}`);
  found.add(key);
  for (const dependency of manifest[key].imports ?? []) imports(dependency, found);
  return found;
}
const optional = ['thumbnailBackend', 'thumbnailWebGpu', 'thumbnailWebGl', 'miniViewerCpu'].map(entry);
for (const [key, chunk] of Object.entries(manifest)) {
  if (!chunk.isEntry) continue;
  for (const backend of optional) assert(!imports(key).has(backend), `Startup eagerly loads ${backend}`);
}
for (const backend of optional) {
  for (const other of optional) {
    if (other !== backend) assert(!imports(backend).has(other), `${backend} eagerly loads ${other}`);
  }
}
console.log('Thumbnail chunks verified: no backend at startup; GPU branches never import the CPU fallback or one another.');
