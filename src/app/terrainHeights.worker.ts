import { installTerrainHeightBatchKernel, type HeightBatchWorkerScope } from "@foss-earth/engine/browser";
const kernel = self.name === "single" ? "single" : self.name === "threaded" ? "threaded" : "typescript";
installTerrainHeightBatchKernel({ scope: self as unknown as HeightBatchWorkerScope, kernel, now: () => performance.now(),
  loadNative: kernel === "single" ? async () => {
    const { loadTerrainCore } = await import("@foss-earth/native-terrain");
    return loadTerrainCore();
  } : undefined,
});
