/** What each converted core was asked to run and what it actually ran, for Component execution and Copy report. */
import { NATIVE_CORES, type NativeCoreId, type NativeCorePlan } from "@foss-earth/engine/settings";
import type { TerrainMeshWorkerPoolStats, TerrainNativeDecoderStatus, WorkerPoolStats, TerrainHeightBatchStats } from "@foss-earth/engine/browser";
import type { GooglePreparationStatus } from "@foss-earth/renderer/google-preparation";
import type { GroundAccelerationStatus } from "@foss-earth/engine/babylon";
import type { SkyEvaluation } from "@foss-earth/sky/babylon";
import type { SkySharedThreadsStatus } from "@foss-earth/sky";

export interface NativeCoreReport {
  core: NativeCoreId;
  label: string;
  scope: string;
  /** The startup selection: the tier asked for, by which setting, and `auto`'s choice. */
  requested: NativeCorePlan["requested"];
  requestedBy: string;
  resolved: NativeCorePlan["resolved"];
  autoReason: string | null;
  placement: NativeCorePlan["placement"];
  kernel: NativeCorePlan["kernel"];
  parallelism: NativeCorePlan["parallelism"];
  /** Cooperating shared-memory threads asked for, the coordinator included; 1 without a shared request. */
  threads: NativeCorePlan["threads"];
  /** Whether shared WebAssembly memory was asked for, and why a threaded request cannot have it before startup. */
  sharedMemory: NativeCorePlan["sharedMemory"];
  threadedFallback: NativeCorePlan["threadedFallback"];
  /**
   * The shared-memory core as it ran, from its own status: cooperating
   * threads over one memory, never the independent-job worker pools. Null
   * where none was asked for or none started.
   */
  shared: NativeSharedReport | null;
  /**
   * What ran, from the core's own status, never from the request: "single"
   * only once WASM output passed its first comparison. "not started" while the
   * core has had no work, so nothing of it was loaded.
   */
  actual: string;
  state: string;
  parity: unknown;
  fallbackReason: string | null;
  /** Jobs, timings and copies the core measures. */
  detail: unknown;
}

export interface NativeSharedReport {
  actual: "threaded" | "retired";
  retiredReason: string | null;
  crossOriginIsolated: boolean | null;
  memoryBytes: number;
  memoryGrows: false;
  /** Threads that took part, the coordinator included: limit, connected and ready. */
  threads: { requested: number; limit: number; connected: number; ready: number; helpers: Array<{ thread: number; state: string; reason: string | null }> };
  batches: { total: number; parallel: number; solo: number; rows: number; directions: number; rowsByThread: number[]; waitMs: number; maxWaitMs: number };
  /** Bytes copied into and out of shared memory; the tables are written once per atmosphere. */
  copies: { inBytes: number; outBytes: number };
  lastBatch: unknown;
}

export interface NativeReportSources {
  plans: Readonly<Record<NativeCoreId, NativeCorePlan>> | null;
  terrainDecode(): (WorkerPoolStats & { pageDecodes: number; sharedHeights?: number; parity: string; nativeWorkers: TerrainNativeDecoderStatus[] }) | null;
  skyEvaluation(): SkyEvaluation | null;
  terrainMesh?(): TerrainMeshWorkerPoolStats | null;
  terrainHeights?(): TerrainHeightBatchStats | null;
  googlePreparation?(): GooglePreparationStatus | null;
  groundAcceleration?(): GroundAccelerationStatus | null;
}

const distinct = <T>(values: readonly T[]): T[] => [...new Set(values)];
const summary = (values: readonly string[], none: string): string => {
  const seen = distinct(values);
  return seen.length === 0 ? none : seen.length === 1 ? seen[0] : `mixed: ${seen.join(", ")}`;
};

function rasterReport(plan: NativeCorePlan, stats: ReturnType<NativeReportSources["terrainDecode"]>): Omit<NativeCoreReport, keyof NativeCorePlan | "label" | "scope" | "shared"> & { shared?: NativeSharedReport | null } {
  const workers = stats?.nativeWorkers ?? [];
  const reasons = distinct(workers.map(worker => worker.fallbackReason).filter((reason): reason is NonNullable<typeof reason> => reason !== null));
  return {
    actual: summary(workers.map(worker => worker.actualTier), stats && stats.pageDecodes > 0 && workers.length === 0 ? "typescript (page)" : "not started"),
    state: summary(workers.map(worker => worker.state), "idle"),
    parity: summary(workers.map(worker => worker.parity), plan.kernel === "typescript" ? "not compared" : "unchecked"),
    fallbackReason: reasons.length ? reasons.join(", ") : null,
    detail: stats && {
      workers: stats.workers, completed: stats.completed, losses: stats.losses, pageDecodes: stats.pageDecodes, sharedHeights: stats.sharedHeights ?? 0,
      pageWorkerParity: stats.parity, perWorker: stats.perWorker.map(worker => ({ tasks: worker.tasks, meanMs: Math.round(worker.meanMs * 100) / 100 })),
      backends: workers.map(worker => ({ id: worker.workerId, requested: worker.requestedTier, actual: worker.actualTier, state: worker.state, parity: worker.parity,
        fallbackReason: worker.fallbackReason, nativeAttempts: worker.nativeAttempts, nativeDecodes: worker.nativeDecodes, typescriptDecodes: worker.typescriptDecodes })),
    },
  };
}

function sharedReport(backend: { requestedThreads?: number; threads?: SkySharedThreadsStatus | null } | null): NativeSharedReport | null {
  const threads = backend?.threads;
  if (!threads) return null;
  return {
    actual: threads.actual, retiredReason: threads.retiredReason, crossOriginIsolated: threads.crossOriginIsolated,
    memoryBytes: threads.memoryBytes, memoryGrows: false,
    threads: { requested: backend.requestedThreads ?? threads.threads.limit, ...threads.threads },
    batches: { total: threads.batches, parallel: threads.parallelBatches, solo: threads.soloBatches, rows: threads.rows, directions: threads.directions,
      rowsByThread: threads.rowsByThread, waitMs: Math.round(threads.waitMs * 100) / 100, maxWaitMs: Math.round(threads.maxWaitMs * 100) / 100 },
    copies: { inBytes: threads.copiedInBytes, outBytes: threads.copiedOutBytes },
    lastBatch: threads.lastBatch,
  };
}

function skyReport(plan: NativeCorePlan, evaluation: SkyEvaluation | null): Omit<NativeCoreReport, keyof NativeCorePlan | "label" | "scope" | "shared"> & { shared?: NativeSharedReport | null } {
  const evaluator = evaluation?.evaluator ?? null;
  const backend = evaluator?.backend ?? null;
  const numeric = backend?.numeric ?? null;
  if (!evaluation) return { actual: "not started", state: "idle", parity: "not compared", fallbackReason: null, shared: null, detail: null };
  if (evaluation.placement === "page" && !evaluator) {
    return { actual: "typescript (page)", state: plan.placement === "original" ? "original" : "fallback", parity: "not compared", fallbackReason: evaluation.retired, shared: null, detail: null };
  }
  const actual = evaluation.placement === "page" ? "typescript (page)"
    : !evaluator?.started ? "not started"
      : backend ? `${backend.actual} (worker)` : "starting";
  return {
    actual,
    state: evaluation.placement === "page" ? "retired" : backend?.state ?? evaluator?.state ?? "idle",
    // The dome's batched fans are compared once per mode (one thread, several) before they are trusted.
    parity: numeric ? { tables: numeric.tableParity, ...numeric.parity, ...(numeric.batches ? { fanRows: numeric.batches.parity } : {}) } : plan.kernel === "typescript" ? "not compared" : "unchecked",
    fallbackReason: evaluation.retired ?? backend?.fallbackReason ?? null,
    shared: sharedReport(backend),
    detail: evaluator && {
      worker: evaluator.state, jobs: evaluator.jobs, startupMs: backend?.startupMs ?? null, nativeCalls: numeric?.nativeCalls ?? null,
      fanRows: numeric?.batches ?? null,
      lastJob: evaluator.lastJob, totals: evaluator.totals,
      meanRoundTripMs: evaluator.jobs ? Math.round((evaluator.totals.roundTripMs / evaluator.jobs) * 100) / 100 : null,
      meanWorkMs: evaluator.jobs ? Math.round((evaluator.totals.workMs / evaluator.jobs) * 100) / 100 : null,
    },
  };
}

function terrainReport(plan: NativeCorePlan, stats: TerrainMeshWorkerPoolStats | null): Omit<NativeCoreReport, keyof NativeCorePlan | "label" | "scope" | "shared"> & { shared?: NativeSharedReport | null } {
  if (plan.placement === "original") {
    return {
      actual: "typescript (page)",
      state: "original",
      parity: "not compared",
      fallbackReason: null,
      detail: null,
    };
  }
  if (!stats || stats.targets === 0) {
    return {
      actual: "not started",
      state: "idle",
      parity: plan.kernel === "typescript" ? "not compared" : "unchecked",
      fallbackReason: stats?.fallbackReason ?? null,
      detail: stats && {
        workers: stats.workers,
        targets: stats.targets,
        meanMs: null,
        completed: stats.completed,
        losses: stats.losses,
      },
    };
  }
  return {
    actual: `${stats.actualBackend} (worker)`,
    state: stats.busy > 0 ? "busy" : "idle",
    parity: stats.parity,
    fallbackReason: stats.fallbackReason,
    detail: {
      workers: stats.workers,
      targets: stats.targets,
      meanMs: Math.round(stats.meanMs * 100) / 100,
      completed: stats.completed,
      losses: stats.losses,
      perWorker: stats.perWorker.map(worker => ({
        tasks: worker.tasks,
        meanMs: Math.round(worker.meanMs * 100) / 100,
      })),
    },
  };
}

function heightReport(plan: NativeCorePlan, stats: TerrainHeightBatchStats | null): Omit<NativeCoreReport, keyof NativeCorePlan | "label" | "scope" | "shared"> & { shared?: NativeSharedReport | null } {
  if (plan.placement === "original") return { actual: "typescript (page)", state: "original", parity: "not compared", fallbackReason: null, detail: null };
  return { actual: !stats || stats.actual === "not started" ? "not started" : `${stats.actual} (${stats.state === "retired" ? "page fallback" : "worker cache + page misses"})`,
    state: stats?.state ?? "idle", parity: stats?.parity ?? (plan.kernel === "single" ? "unchecked" : "not compared"),
    fallbackReason: stats?.fallbackReason ?? null, detail: stats };
}
function googleReport(plan: NativeCorePlan, stats: GooglePreparationStatus | null): Omit<NativeCoreReport, keyof NativeCorePlan | "label" | "scope" | "shared"> & { shared?: NativeSharedReport | null } {
  if (plan.placement === "original") return { actual: "typescript (page)", state: "original", parity: "not compared", fallbackReason: null, detail: null };
  return { actual: !stats || stats.actual === "idle" ? "not started" : stats.actual,
    state: stats?.fallbackReason ? "fallback" : stats?.pending ? "busy" : "idle", parity: stats?.parity ?? "not-run",
    fallbackReason: stats?.fallbackReason ?? null, detail: stats };
}

function groundReport(plan: NativeCorePlan, stats: GroundAccelerationStatus | null): Omit<NativeCoreReport, keyof NativeCorePlan | "label" | "scope" | "shared"> & { shared?: NativeSharedReport | null } {
  if (plan.placement === "original") return { actual: "typescript (page)", state: "original", parity: "not compared", fallbackReason: null, detail: null };
  const build = stats?.preparer;
  return { actual: !build?.actual ? "not started" : `${build.actual} worker build; TypeScript synchronous queries`,
    state: build?.state ?? "idle", parity: { build: build?.parity ?? "not-run", scene: stats?.parity ?? "pending" },
    fallbackReason: stats?.fallbackReason ?? build?.failure ?? null, detail: stats };
}

export function describeNativeCores(sources: NativeReportSources): NativeCoreReport[] {
  if (!sources.plans) return [];
  return (Object.keys(sources.plans) as NativeCoreId[]).map(core => {
    const plan = sources.plans![core];
    const facts = NATIVE_CORES[core];
    const measured = core === "raster" ? rasterReport(plan, sources.terrainDecode())
      : core === "sky" ? skyReport(plan, sources.skyEvaluation())
      : core === "imagery" ? heightReport(plan, sources.terrainHeights?.() ?? null)
      : core === "google" ? googleReport(plan, sources.googlePreparation?.() ?? null)
      : core === "ground" ? groundReport(plan, sources.groundAcceleration?.() ?? null)
      : terrainReport(plan, sources.terrainMesh?.() ?? null);
    return { core, label: facts.label, scope: facts.scope, requested: plan.requested, requestedBy: plan.requestedBy, resolved: plan.resolved,
      autoReason: plan.autoReason, placement: plan.placement, kernel: plan.kernel, parallelism: plan.parallelism,
      threads: plan.threads, sharedMemory: plan.sharedMemory, threadedFallback: plan.threadedFallback, shared: null, ...measured };
  });
}

const registered = new WeakMap<object, () => NativeCoreReport[]>();
/** Called by the browser runtime: each host reads its runtime's cores through `earthNativeCores`. */
export function registerNativeCores(runtime: object, report: () => NativeCoreReport[]): void {
  registered.set(runtime, report);
}
/** The cores of a runtime made by `createEarthBrowserRuntime` or `createBabylonRuntime`; null for any other. */
export function earthNativeCores(runtime: object): NativeCoreReport[] | null {
  return registered.get(runtime)?.() ?? null;
}
