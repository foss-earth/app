/** Earth supplies the worker realm; Engine owns the terrain decode protocol. */
import { createTerrainWasmDecoder, installTerrainDecodeWorkerKernel, type TerrainDecodeWorkerKernelPorts } from "@foss-earth/engine/browser";
import { loadRasterCore } from "@foss-earth/engine/raster-WASM";
import { terrainWasmWorkerConfig } from "./terrainWasmWorkerConfig";
import { boundedComputeModule, installComputePreparation } from "./computeWorker";

const { sharedHeights, ...config } = terrainWasmWorkerConfig(self.name);
let loading: ReturnType<typeof loadRasterCore> | undefined;
const load = () => loading ??= loadRasterCore();
installComputePreparation(() => config.requestedTier === "single" || config.requestedTier === "auto" ? loading = boundedComputeModule(load()) : Promise.resolve());
const wasm = createTerrainWasmDecoder({
  ...config, start: load,
  timers: { setTimeout: (callback, delay) => setTimeout(callback, delay), clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) },
});

installTerrainDecodeWorkerKernel({
  scope: self as unknown as TerrainDecodeWorkerKernelPorts["scope"],
  // Safari before 16.4 has no OffscreenCanvas in workers: the page then decodes.
  createImageBitmap: typeof createImageBitmap === "function" ? (blob, options) => createImageBitmap(blob, options) : null,
  createCanvas: (width, height) => typeof OffscreenCanvas === "function" ? new OffscreenCanvas(width, height) : null,
  onError: error => console.error("Earth terrain decode worker", error),
  decodeTerrarium: wasm.decode,
  decodeBackendStatus: wasm.status,
  // Shared memory exists only in a cross-origin isolated realm.
  sharedHeights: sharedHeights && self.crossOriginIsolated === true,
});
