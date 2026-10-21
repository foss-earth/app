import { createGoogleWorkerKernel, type GoogleWorkerScope } from "@foss-earth/renderer/google-WASM/worker";
import { loadGoogleCore } from "@foss-earth/renderer/google-WASM";
import { createTypeScriptGoogleCore } from "@foss-earth/renderer/google-TS";
import { boundedComputeModule, installComputePreparation } from "./computeWorker";
const requestedTier = self.name === "single" ? "single" : self.name === "threaded" ? "threaded" : "typescript";
let loading: ReturnType<typeof loadGoogleCore> | undefined;
const load = () => loading ??= loadGoogleCore();
installComputePreparation(() => requestedTier === "single" ? loading = boundedComputeModule(load()) : Promise.resolve());
createGoogleWorkerKernel(self as unknown as GoogleWorkerScope, { requestedTier,
  start: () => requestedTier === "single" ? load() : createTypeScriptGoogleCore() });
