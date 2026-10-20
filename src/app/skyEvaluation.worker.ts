/** Earth supplies the worker realm; Sky owns the evaluation protocol. */
import { installSkyEvaluationWorker, type SkyEvaluationWorkerScope } from "@foss-earth/sky";
import { skyWorkerConfig } from "./skyWorkerConfig";

const { kernel, threads } = skyWorkerConfig(self.name);

installSkyEvaluationWorker({
  scope: self as unknown as SkyEvaluationWorkerScope,
  kernel,
  threads,
  // Only the native kernels fetch and compile a core, on the first evaluation;
  // the single core is also the threaded kernel's fallback.
  loadNumericCore: kernel === "single" || kernel === "threaded" ? () => import("@foss-earth/sky/sky-WASM").then(module => module.loadSkyCore()) : undefined,
  // The shared core runs its coordinator here; helpers join as the page starts them.
  loadThreadedCore: kernel === "threaded" ? () => import("@foss-earth/sky/sky-WASM/shared")
    .then(async module => module.createSharedSkyCore(await module.loadSharedSkyModule(), { helpers: threads - 1 })) : undefined,
  now: () => performance.now(),
  timers: { set: (callback, delayMs) => setTimeout(callback, delayMs), clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) },
});
