/**
 * Qualify the page's startup graph, so React, the tabs' views or Babylon's PBR materials moving back into it fails
 * CI (docs/proposals/startup-loading.md).
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const manifestUrl = new URL(process.argv[2] ?? '../dist/.vite/manifest.json', import.meta.url);
const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
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
// Only glTF models (3D Tiles, loaded later) use PBR materials; the globe tells them by class name. The class's
// serialize() is the one place that writes this, wherever a minifier leaves it.
const PBR_MATERIAL = /customType\s*=\s*[`'"]BABYLON\.PBRMaterial[`'"]/;
for (const [key, chunk] of Object.entries(manifest)) {
  if (!chunk.isEntry) continue;
  for (const file of [...imports(key)].map(found => manifest[found].file)) {
    assert(!PBR_MATERIAL.test(await readFile(new URL(`../${file}`, manifestUrl), 'utf8')), `Startup loads Babylon's PBR material in ${file}`);
  }
}
console.log("Startup chunks verified: React, the overlay and Babylon's PBR materials load after the page starts.");
