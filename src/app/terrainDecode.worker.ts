/** Earth supplies the worker realm; Engine owns the terrain decode protocol. */
import { installTerrainDecodeWorkerKernel, type TerrainDecodeWorkerKernelPorts } from "@foss-earth/engine/browser";

installTerrainDecodeWorkerKernel({
  scope: self as unknown as TerrainDecodeWorkerKernelPorts["scope"],
  // Safari before 16.4 has no OffscreenCanvas in workers: the page then decodes.
  createImageBitmap: typeof createImageBitmap === "function" ? (blob, options) => createImageBitmap(blob, options) : null,
  createCanvas: (width, height) => typeof OffscreenCanvas === "function" ? new OffscreenCanvas(width, height) : null,
  onError: error => console.error("Earth terrain decode worker", error),
});
