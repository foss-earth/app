import { describe, expect, it } from "vitest";
import { nativeCorePlan, NATIVE_TIER_ID, type NativeCoreId, type NativeCorePlan } from "@foss-earth/engine/settings";
import type { SkyEvaluation } from "@foss-earth/sky/babylon";
import { describeNativeCores, earthNativeCores, registerNativeCores, type NativeReportSources } from "./nativeReport";

const plans = (tier: string): Record<NativeCoreId, NativeCorePlan> => {
  const settings = { get: <T>(id: string) => (id === NATIVE_TIER_ID ? tier : "inherit") as T };
  return { raster: nativeCorePlan(settings, "raster"), sky: nativeCorePlan(settings, "sky"), terrain: nativeCorePlan(settings, "terrain"),
    imagery: nativeCorePlan(settings, "imagery"), google: nativeCorePlan(settings, "google"), ground: nativeCorePlan(settings, "ground") };
};
const sources = (tier: string, extra: Partial<NativeReportSources> = {}): NativeReportSources =>
  ({ plans: plans(tier), terrainDecode: () => null, skyEvaluation: () => null, terrainMesh: () => null, ...extra });
const sky = (reports: ReturnType<typeof describeNativeCores>) => reports.find(report => report.core === "sky")!;
const raster = (reports: ReturnType<typeof describeNativeCores>) => reports.find(report => report.core === "raster")!;
const terrain = (reports: ReturnType<typeof describeNativeCores>) => reports.find(report => report.core === "terrain")!;
const worker = (overrides: Partial<NonNullable<SkyEvaluation["evaluator"]>> = {}): NonNullable<SkyEvaluation["evaluator"]> => ({
  placement: "worker", kernel: "single", state: "idle", failure: null, started: false, backend: null, jobs: 0, lastJob: null,
  totals: { roundTripMs: 0, workMs: 0 }, ...overrides,
});
const numeric = { requested: "single", actual: "single", state: "ready", fallbackReason: null, cleanupFailed: false, tableBackend: "single",
  tableParity: "same", parity: { radiance: "same", fan: "same", irradiance: "same" }, nativeCalls: 12 } as const;

describe("native core report", () => {
  it("says nothing was started for an inactive core, and reports the original placement as such", () => {
    expect(describeNativeCores({ plans: null, terrainDecode: () => null, skyEvaluation: () => null })).toEqual([]);
    const reports = describeNativeCores(sources("single"));
    expect(reports.map(report => report.core)).toEqual(["raster", "sky", "terrain", "imagery", "google", "ground"]);
    expect(raster(reports)).toMatchObject({ requested: "single", kernel: "single", actual: "not started", fallbackReason: null, detail: null });
    expect(sky(reports)).toMatchObject({ actual: "not started", parity: "not compared" });
    expect(terrain(reports)).toMatchObject({ requested: "single", kernel: "single", actual: "not started", parity: "unchecked" });
    const original = sky(describeNativeCores(sources("typescript", { skyEvaluation: () => ({ placement: "page", retired: null, evaluator: null }) })));
    expect(original).toMatchObject({ placement: "original", actual: "typescript (page)", state: "original", fallbackReason: null });
  });

  it("reports a worker as single only from its own backend, with parity and timings", () => {
    const evaluation: SkyEvaluation = { placement: "worker", retired: null, evaluator: worker({
      started: true, jobs: 2, totals: { roundTripMs: 10, workMs: 6 },
      lastJob: { roundTripMs: 4, workMs: 3, tablesMs: 0, illuminationMs: 1, domeMs: 2, transferBytes: 2048 },
      backend: { kernel: "single", actual: "single", state: "ready", fallbackReason: null, startupMs: 7.5, numeric, jobs: 2 },
    }) };
    const report = sky(describeNativeCores(sources("single", { skyEvaluation: () => evaluation })));
    expect(report).toMatchObject({ actual: "single (worker)", state: "ready", fallbackReason: null,
      parity: { tables: "same", radiance: "same", fan: "same", irradiance: "same" } });
    expect(report.detail).toMatchObject({ jobs: 2, startupMs: 7.5, nativeCalls: 12, meanRoundTripMs: 5, meanWorkMs: 3 });
    // A started worker that has not answered yet is not a sample of anything.
    expect(sky(describeNativeCores(sources("single", { skyEvaluation: () => ({ placement: "worker", retired: null, evaluator: worker({ started: true }) }) }))).actual).toBe("starting");
  });

  it("names the fallback of a worker that ran TypeScript, and of one retired to the page", () => {
    const fellBack: SkyEvaluation = { placement: "worker", retired: null, evaluator: worker({ started: true, jobs: 1,
      backend: { kernel: "single", actual: "typescript", state: "fallback", fallbackReason: "native-start-failed: no wasm", startupMs: null, numeric: null, jobs: 1 } }) };
    expect(sky(describeNativeCores(sources("single", { skyEvaluation: () => fellBack })))).toMatchObject({ actual: "typescript (worker)", state: "fallback", fallbackReason: "native-start-failed: no wasm" });
    const retired: SkyEvaluation = { placement: "page", retired: "worker-timeout", evaluator: worker({ started: true, state: "failed", failure: "worker-timeout" }) };
    expect(sky(describeNativeCores(sources("typescript-worker", { skyEvaluation: () => retired })))).toMatchObject({ actual: "typescript (page)", state: "retired", fallbackReason: "worker-timeout" });
  });

  it("summarises the terrain workers' own backends", () => {
    const status = (workerId: string, actualTier: "typescript" | "single", fallbackReason: string | null) => ({
      workerId, requestedTier: "single", actualTier, state: actualTier === "single" ? "ready" : "fallback", parity: actualTier === "single" ? "same" : "different",
      fallbackReason, nativeAttempts: 1, nativeDecodes: actualTier === "single" ? 4 : 0, typescriptDecodes: actualTier === "single" ? 0 : 4,
    });
    const stats = (nativeWorkers: ReturnType<typeof status>[], pageDecodes = 0) => () => ({
      workers: nativeWorkers.length, completed: 8, losses: 0, pageDecodes, parity: "same",
      perWorker: nativeWorkers.map(() => ({ tasks: 4, meanMs: 2.5 })), nativeWorkers,
    }) as unknown as ReturnType<NativeReportSources["terrainDecode"]>;
    expect(raster(describeNativeCores(sources("single", { terrainDecode: stats([status("t1", "single", null), status("t2", "single", null)]) }))))
      .toMatchObject({ actual: "single", state: "ready", parity: "same", fallbackReason: null });
    const mixed = raster(describeNativeCores(sources("single", { terrainDecode: stats([status("t1", "single", null), status("t2", "typescript", "parity-different")]) })));
    expect(mixed).toMatchObject({ actual: "mixed: single, typescript", fallbackReason: "parity-different" });
    expect(raster(describeNativeCores(sources("typescript", { terrainDecode: stats([], 3) })))).toMatchObject({ actual: "typescript (page)", parity: "not compared" });
    const shared = () => ({ ...stats([status("t1", "single", null)])()!, sharedHeights: 5 });
    expect(raster(describeNativeCores(sources("single", { terrainDecode: shared }))).detail).toMatchObject({ completed: 8, sharedHeights: 5 });
  });

  it("reports terrain geometry worker backend, parity and target counts", () => {
    const meshStats = (targets = 4, actualBackend: "typescript" | "wasm-single" = "wasm-single", parity: "same" | "not compared" = "same") => () => ({
      workers: 2, busy: 0, queued: 0, completed: targets, losses: 0, available: true,
      targets, actualBackend, parity, fallbackReason: null, meanMs: 1.25,
      perWorker: [{ tasks: 2, meanMs: 1.2 }, { tasks: 2, meanMs: 1.3 }],
    });
    const tsReport = terrain(describeNativeCores(sources("typescript")));
    expect(tsReport).toMatchObject({ requested: "typescript", placement: "original", actual: "typescript (page)", state: "original", parity: "not compared" });

    const wasmReport = terrain(describeNativeCores(sources("single", { terrainMesh: meshStats(8, "wasm-single", "same") })));
    expect(wasmReport).toMatchObject({ requested: "single", placement: "worker", actual: "wasm-single (worker)", state: "idle", parity: "same", fallbackReason: null });
    expect(wasmReport.detail).toMatchObject({ workers: 2, targets: 8, meanMs: 1.25 });
  });

  it("is read through the runtime that registered it", () => {
    const runtime = {};
    expect(earthNativeCores(runtime)).toBeNull();
    registerNativeCores(runtime, () => describeNativeCores(sources("typescript-worker")));
    expect(earthNativeCores(runtime)?.map(report => report.requested)).toEqual(Array(6).fill("typescript-worker"));
  });
});
