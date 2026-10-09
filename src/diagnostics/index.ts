/**
 * What an app needs to say what went wrong on a device with no console (docs/diagnostics.md).
 * A page that shows no globe imports it, so it does not load the engine: the diagnostics that
 * draw in the scene are `foss-earth/diagnosticDrawing`.
 */
export { captureErrors, describeError, tapConsole, type CapturedError } from "./errorCapture";
export { buildReport, reportPage, type ReportParts, type ReportSetting } from "./report";
export { readBrowserReportDetails } from "./browserDetails";
export {
  createIssueDraft, issueReportAttachment, issueReportFilename, redactIssueReport, validateIssueReporterConfig,
  type IssueReporterConfig, type IssueReportDraft, type IssueReportDraftInput,
} from "./issueReport";
export { issueReporterFromBuild } from "../app/issueReporting";
export { effectiveReportSettings, reportSecrets, settingsNotAtDefaults, startAppDiagnostics, type AppDiagnostics, type AppDiagnosticsOptions, type DiagnosedRuntime } from "../app/appDiagnostics";
export { getAppIdentity, describeAppIdentity, describeAppIdentityBriefly, type AppIdentity } from "../app/appIdentity";
export { showReportOnly, wantsReportOnly } from "../app/reportOnly";
export {
  browserTrailEnvironment, createSessionTrail, describePreviousVisit, stepKind, tidyStep, TRAIL_KEY_PREFIX, TRAIL_PING_KEY, TRAIL_STEPS_DEFAULT,
  type PreviousVisit, type SessionTrail, type SessionTrailOptions, type TrailEnvironment, type TrailRecord, type TrailStep,
} from "./sessionTrail";
