import { installTerrainHeightBatchKernel, type HeightBatchWorkerScope } from "@foss-earth/engine/browser";
import { boundedComputeModule, installComputePreparation } from "./computeWorker";
const kernel = self.name === "single" ? "single" : self.name === "threaded" ? "threaded" : "typescript";
const load = async () => { const { loadTerrainCore } = await import("@foss-earth/engine/terrain-WASM"); return loadTerrainCore(); };
let loading: ReturnType<typeof load> | undefined;
const native = () => loading ??= load();
installComputePreparation(() => kernel === "single" ? loading = boundedComputeModule(native()) : Promise.resolve());
installTerrainHeightBatchKernel({ scope: self as unknown as HeightBatchWorkerScope, kernel, now: () => performance.now(),
  loadNative: kernel === "single" ? native : undefined,
});
