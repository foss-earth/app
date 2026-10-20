import { createGoogleWorkerKernel, type GoogleWorkerScope } from "@foss-earth/renderer/google-WASM/worker";
import { loadGoogleCore } from "@foss-earth/renderer/google-WASM";
import { createTypeScriptGoogleCore } from "@foss-earth/renderer/google-TS";
const requestedTier = self.name === "single" ? "single" : self.name === "threaded" ? "threaded" : "typescript";
createGoogleWorkerKernel(self as unknown as GoogleWorkerScope, { requestedTier,
  start: () => requestedTier === "single" ? loadGoogleCore() : createTypeScriptGoogleCore() });
