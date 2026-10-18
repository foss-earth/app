/**
 * Qualify the page's startup graph, so React, the tabs' views, Babylon's PBR materials, its MeshBuilder or a lazy
 * feature moving back into it fails CI (docs/proposals/startup-loading.md).
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
// MeshBuilder holds every builder; startup code calls the few it uses (CreateSphere, CreatePlane…) by name.
// Its object is the one place a builder is a property; Mesh's legacy stubs are assignments.
const MESH_BUILDER = /[{,]\s*CreateTorusKnot\s*:/;
for (const [key, chunk] of Object.entries(manifest)) {
  if (!chunk.isEntry) continue;
  for (const file of [...imports(key)].map(found => manifest[found].file)) {
    const code = await readFile(new URL(`../${file}`, manifestUrl), 'utf8');
    assert(!PBR_MATERIAL.test(code), `Startup loads Babylon's PBR material in ${file}`);
    assert(!MESH_BUILDER.test(code), `Startup loads Babylon's MeshBuilder in ${file}`);
  }
}
// Each lazy feature the page names (vite/lazyFeatures.ts) still has chunks of its own to fetch.
const page = await readFile(new URL('../index.html', manifestUrl), 'utf8');
const map = page.match(/<script type="application\/json" id="foss-earth-lazy-features">([^<]*)<\/script>/)?.[1];
assert(map, 'The page names no lazy features');
const features = JSON.parse(map);
for (const id of ['gamepad-editor', 'pose-editor', 'scene-thumbnails']) {
  assert(features[id]?.urls.length > 0, `Lazy feature ${id} is missing from the page or loads with it`);
}
console.log("Startup chunks verified: React, the overlay, Babylon's PBR materials, its MeshBuilder and the lazy features load after the page starts.");
