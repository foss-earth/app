/**
 * `foss-earth/vite`: what an app built on FOSS Earth adds to its Vite
 * config. `appFiles()` keeps the app's own files on the visitor's device and
 * stamps each page with its build; `localSource()` serves linked checkouts with
 * live updates; `builtFrom()` writes what the app is built
 * from into each page, for its About tab; `babylonBarrels()` bundles only the
 * Babylon modules the app uses; `babylonShaderChunks()` gives an app that loads
 * the globe lazily Babylon's shaders as two chunks, not hundreds;
 * `headsetEmulator()` gives `npm run dev` an emulated VR headset; `lazyFeatures()` names each lazy feature's
 * chunks in the page, so it can fetch them while idle; `crossOriginIsolation()`
 * isolates the dev and preview pages when FOSS_EARTH_ISOLATION asks, so a
 * threaded WebAssembly core can share memory.
 */
export * from "./appFiles.ts";
export * from "./babylonShaderChunks.ts";
export * from "./builtFrom.ts";
export * from "./crossOriginIsolation.ts";
export * from "./headsetEmulator.ts";
export * from "./lazyFeatures.ts";
export * from "./localSource.ts";
