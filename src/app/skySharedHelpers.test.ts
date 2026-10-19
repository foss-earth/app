import { afterEach, describe, expect, it, vi } from "vitest";
import { nativeCorePlan, NATIVE_THREADS_ID, NATIVE_TIER_ID, type NativeCoreId, type NativeCorePlan } from "@foss-earth/engine/settings";
import type { SkyEvaluation } from "@foss-earth/sky/babylon";
import type { SkySharedThreadsStatus } from "@foss-earth/sky";
import { describeNativeCores } from "./nativeReport";
import { startSkySharedHelpers } from "./skySharedHelpers";

const fakeWorker = () => ({ postMessage: vi.fn(), terminate: vi.fn() }) as unknown as Worker & { postMessage: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn> };

describe("shared sky helpers", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("start none where the page is not cross-origin isolated", () => {
    vi.stubGlobal("crossOriginIsolated", false);
    const start = vi.fn(fakeWorker);
    expect(startSkySharedHelpers(3, start)).toBeNull();
    expect(start).not.toHaveBeenCalled();
  });

  it("take each helper from the budget, hand it its port, and end every one together", () => {
    vi.stubGlobal("crossOriginIsolated", true);
    const workers: ReturnType<typeof fakeWorker>[] = [];
    // The budget has room for two of the three.
    const group = startSkySharedHelpers(3, index => { if (index >= 2) return null; const worker = fakeWorker(); workers.push(worker); return worker; })!;
    expect(group.ports).toHaveLength(2);
    for (const worker of workers) {
      const [message, transfer] = worker.postMessage.mock.calls[0];
      expect(message).toMatchObject({ kind: "sky-shared-port" });
      expect(transfer).toEqual([message.port]);
    }
    group.terminate();
    group.terminate();
    for (const worker of workers) expect(worker.terminate).toHaveBeenCalledOnce();
    for (const port of group.ports) port.close();
    expect(startSkySharedHelpers(2, () => null)).toBeNull();
    expect(startSkySharedHelpers(0, fakeWorker)).toBeNull();
  });
});

describe("shared sky report", () => {
  const plans = (values: Record<string, unknown>): Record<NativeCoreId, NativeCorePlan> => {
    const settings = { get: <T>(id: string) => (id in values ? values[id] : "inherit") as T };
    return Object.fromEntries((["raster", "sky", "terrain", "imagery", "google", "ground"] as const).map(core => [core, nativeCorePlan(settings, core)])) as Record<NativeCoreId, NativeCorePlan>;
  };
  const threads: SkySharedThreadsStatus = {
    actual: "threaded", retiredReason: null, sharedMemory: true, crossOriginIsolated: true, memoryBytes: 4194304, memoryGrows: false, stackBytesPerThread: 65536,
    threads: { limit: 4, connected: 4, ready: 3, helpers: [{ thread: 1, state: "ready", reason: null }, { thread: 2, state: "ready", reason: null }, { thread: 3, state: "starting", reason: null }] },
    batches: 10, parallelBatches: 6, soloBatches: 4, rows: 400, directions: 25600, rowsByThread: [200, 100, 100, 0, 0, 0, 0, 0],
    waitMs: 1.234, maxWaitMs: 0.5, lastBatch: null, copiedInBytes: 211200, copiedOutBytes: 614400,
  };

  it("reports the threads that ran over shared memory apart from the worker pools, and each other core's reason", () => {
    const evaluation = { placement: "worker", retired: null, evaluator: {
      placement: "worker", kernel: "threaded", state: "idle", failure: null, started: true, jobs: 10, lastJob: null, totals: { roundTripMs: 0, workMs: 0 },
      backend: { kernel: "threaded", actual: "threaded", state: "ready", fallbackReason: null, startupMs: 12, numeric: null, jobs: 10, threads, requestedThreads: 4 },
    } } as unknown as SkyEvaluation;
    const reports = describeNativeCores({ plans: plans({ [NATIVE_TIER_ID]: "threaded", [NATIVE_THREADS_ID]: 4 }), terrainDecode: () => null, skyEvaluation: () => evaluation });
    const sky = reports.find(report => report.core === "sky")!;
    expect(sky).toMatchObject({ kernel: "threaded", actual: "threaded (worker)", threads: 4, sharedMemory: true, threadedFallback: null, parallelism: "auto",
      shared: { actual: "threaded", crossOriginIsolated: true, memoryBytes: 4194304, threads: { requested: 4, connected: 4, ready: 3 },
        batches: { parallel: 6, solo: 4, rowsByThread: [200, 100, 100, 0, 0, 0, 0, 0], waitMs: 1.23 }, copies: { inBytes: 211200, outBytes: 614400 } } });
    for (const report of reports.filter(report => report.core !== "sky")) {
      expect(report).toMatchObject({ kernel: "threaded", threads: 1, sharedMemory: false, threadedFallback: "no-shared-build", shared: null });
    }
  });

  it("reports no shared core for a sky that fell back", () => {
    const evaluation = { placement: "worker", retired: null, evaluator: {
      placement: "worker", kernel: "threaded", state: "idle", failure: null, started: true, jobs: 1, lastJob: null, totals: { roundTripMs: 0, workMs: 0 },
      backend: { kernel: "threaded", actual: "single", state: "ready", fallbackReason: "not-cross-origin-isolated", startupMs: 12, numeric: null, jobs: 1, threads: null, requestedThreads: 4 },
    } } as unknown as SkyEvaluation;
    const sky = describeNativeCores({ plans: plans({ [NATIVE_TIER_ID]: "threaded", [NATIVE_THREADS_ID]: 4 }), terrainDecode: () => null, skyEvaluation: () => evaluation })
      .find(report => report.core === "sky")!;
    expect(sky).toMatchObject({ actual: "single (worker)", fallbackReason: "not-cross-origin-isolated", sharedMemory: true, shared: null });
  });
});
