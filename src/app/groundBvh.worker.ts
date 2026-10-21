import { installGroundBvhWorker, type GroundBvhWorkerScope } from "@foss-earth/engine/browser";
import { boundedComputeModule, installComputePreparation } from "./computeWorker";
const kernel = self.name === "single" ? "single" : self.name === "threaded" ? "threaded" : "typescript";
const load = async () => { const { loadGroundCore } = await import("@foss-earth/engine/ground-WASM"); return loadGroundCore(); };
let loading: ReturnType<typeof load> | undefined;
const native = () => loading ??= load();
installComputePreparation(() => kernel === "single" ? loading = boundedComputeModule(native()) : Promise.resolve());
installGroundBvhWorker({ scope: self as unknown as GroundBvhWorkerScope, kernel, now: () => performance.now(),
  timers: { set: (callback, ms) => setTimeout(callback, ms), clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) },
  loadNumericCore: kernel === "single" ? native : undefined,
});
