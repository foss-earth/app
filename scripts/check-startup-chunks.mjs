/** Qualify the page's startup graph, so React or the tabs' views moving back into it fails CI (docs/proposals/startup-loading.md). */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const manifest = JSON.parse(await readFile(new URL(process.argv[2] ?? '../dist/.vite/manifest.json', import.meta.url), 'utf8'));
function imports(key, found = new Set()) {
  if (found.has(key)) return found;
  assert(manifest[key], `Missing chunk ${key}`);
  found.add(key);
  for (const dependency of manifest[key].imports ?? []) imports(dependency, found);
  return found;
}
// Loaded with import() while the globe starts, and drawn once it has.
const deferred = ['src/app/GlobeOverlay.tsx', 'node_modules/react-dom/client.js'];
for (const key of deferred) assert(manifest[key]?.isDynamicEntry, `${key} must remain a separate dynamic entry`);
const react = Object.keys(manifest).filter(key => /^_react-dom-/.test(key));
for (const [key, chunk] of Object.entries(manifest)) {
  if (!chunk.isEntry) continue;
  for (const other of [...deferred, ...react]) assert(!imports(key).has(other), `Startup eagerly loads ${other}`);
}
console.log('Startup chunks verified: React and the overlay load after the page starts.');
