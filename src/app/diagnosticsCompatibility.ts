/** Host conveniences over the sole public diagnostics implementation. */
import { buildReport as buildUiReport, type ReportParts as UiReportParts } from "@foss-earth/ui/diagnostics";
export { reportPage, type ReportSetting, describePreviousVisit, stepKind, tidyStep, TRAIL_KEY_PREFIX, TRAIL_PING_KEY, TRAIL_STEPS_DEFAULT,
  type PreviousVisit, type SessionTrail, type TrailEnvironment, type TrailRecord, type TrailStep } from "@foss-earth/ui/diagnostics";
export { browserTrailEnvironment, createBrowserSessionTrail as createSessionTrail } from "@foss-earth/ui/browser";
import type { SessionTrailOptions as UiSessionTrailOptions, TrailEnvironment } from "@foss-earth/ui/diagnostics";
export type SessionTrailOptions = Omit<UiSessionTrailOptions, "environment"> & { environment?: TrailEnvironment };
export type ReportParts = Omit<UiReportParts, "appName"> & { appName?: string };
export function buildReport(parts: ReportParts): string {
  return buildUiReport({ ...parts, appName: parts.appName ?? (typeof document === "undefined" ? "FOSS Earth" : document.title || "FOSS Earth") });
}
