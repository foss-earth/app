import { createGoogleWorkerKernel, type GoogleWorkerScope } from "@foss-earth/native-google/worker";
import { createTypeScriptGoogleCore, loadGoogleCore } from "@foss-earth/native-google";
const requestedTier = self.name === "single" ? "single" : self.name === "threaded" ? "threaded" : "typescript";
createGoogleWorkerKernel(self as unknown as GoogleWorkerScope, { requestedTier,
  start: () => requestedTier === "single" ? loadGoogleCore() : createTypeScriptGoogleCore() });
