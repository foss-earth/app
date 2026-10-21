import type { ComputeAdmissionSnapshot } from "@foss-earth/engine/browser";

export interface ComputeSchedulingSnapshot {
  requested: "legacy" | "fixed"; requestedLanes: number; liveWorkers: number;
  topology: { logicalConcurrency: number | null; efficiencyCores: null; source: "browser-logical-only" };
  admission: ComputeAdmissionSnapshot | null;
}
export interface ComputeSchedulingService { snapshot(): ComputeSchedulingSnapshot; dispose(): void }
export interface ComputeSchedulingReport extends ComputeSchedulingSnapshot {
  progress: {
    actualSceneFrames: number | null; recentRenderElapsedMs: number[]; inputDispatchDelayMs: number[];
    terrainRevision: number | null; rasterDetailPending: boolean | null; skyJobs: number | null; skyBusy: boolean | null;
  };
}
const reports = new WeakMap<object, () => ComputeSchedulingReport>();
export function registerComputeScheduling(runtime: object, report: () => ComputeSchedulingReport): void { reports.set(runtime, report); }
export function earthComputeScheduling(runtime: object): ComputeSchedulingReport | null { return reports.get(runtime)?.() ?? null; }
