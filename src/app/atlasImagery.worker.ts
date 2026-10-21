/** Earth supplies the worker realm; Engine owns the preparation protocol. */
import { installAtlasImageryWorkerKernel, type AtlasImageryWorkerKernelPorts } from "@foss-earth/engine/browser";
import { createCanvasRgbaSurface } from "@foss-earth/images/browser";
import { installComputePreparation } from "./computeWorker";
installComputePreparation(() => Promise.resolve());

installAtlasImageryWorkerKernel({
  scope: self as unknown as AtlasImageryWorkerKernelPorts["scope"],
  decode: (bytes, mimeType) => createImageBitmap(new Blob([
    new Uint8Array(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength),
  ], { type: mimeType }), { premultiplyAlpha: "none", colorSpaceConversion: "default" }),
  createSurface: (width, height) => createCanvasRgbaSurface({ width, height,
    createCanvas: (w, h) => new OffscreenCanvas(w, h),
  }),
  onError: error => console.error("Earth imagery worker", error),
});
