import { installGroundBvhWorker, type GroundBvhWorkerScope } from "@foss-earth/engine/browser";
const kernel = self.name === "single" ? "single" : self.name === "threaded" ? "threaded" : "typescript";
installGroundBvhWorker({ scope: self as unknown as GroundBvhWorkerScope, kernel, now: () => performance.now(),
  timers: { set: (callback, ms) => setTimeout(callback, ms), clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) },
  loadNumericCore: kernel === "single" ? async () => {
    const { loadGroundCore } = await import("@foss-earth/native-ground");
    return loadGroundCore();
  } : undefined,
});
