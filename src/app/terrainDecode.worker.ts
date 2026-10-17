/** Earth supplies the worker realm; Engine owns the terrain decode protocol. */
import { createTerrainNativeDecoder, installTerrainDecodeWorkerKernel, type TerrainDecodeWorkerKernelPorts } from "@foss-earth/engine/browser";
import { loadRasterCore } from "@foss-earth/native-raster";
import { terrainNativeWorkerConfig } from "./terrainNativeWorkerConfig";

const native = createTerrainNativeDecoder({
  ...terrainNativeWorkerConfig(self.name), start: loadRasterCore,
  timers: { setTimeout: (callback, delay) => setTimeout(callback, delay), clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) },
});

installTerrainDecodeWorkerKernel({
  scope: self as unknown as TerrainDecodeWorkerKernelPorts["scope"],
  // Safari before 16.4 has no OffscreenCanvas in workers: the page then decodes.
  createImageBitmap: typeof createImageBitmap === "function" ? (blob, options) => createImageBitmap(blob, options) : null,
  createCanvas: (width, height) => typeof OffscreenCanvas === "function" ? new OffscreenCanvas(width, height) : null,
  onError: error => console.error("Earth terrain decode worker", error),
  decodeTerrarium: native.decode,
  decodeBackendStatus: native.status,
});
