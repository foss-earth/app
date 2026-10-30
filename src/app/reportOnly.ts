/**
 * `?report` in the address: the page shows the diagnostics report and starts
 * nothing else (docs/diagnostics.md). It is how the trail of a visit is read
 * when the app stops before Settings → Diagnostics can be reached, as when it
 * stops while starting.
 */
import { readStartupCheckpoints, redactIssueReport, buildReport, reportPage, createSessionTrail, TRAIL_STEPS_DEFAULT, type IssueReporterConfig } from "@foss-earth/ui/diagnostics";
export { REPORT_ONLY_PARAMETER, wantsReportOnly, addressWithoutReport } from "@foss-earth/ui/diagnostics";
import type { SettingsRegistry } from "@foss-earth/ui/settings";
import { browserStartupEnvironment, createReportView, readBrowserReportDetails, browserTrailEnvironment, createBrowserClipboard, browserReportDownloads } from "@foss-earth/ui/browser";
import { effectiveReportSettings, reportSecrets } from "./appDiagnostics";
import { issueReporterFromBuild } from "./issueReporting";
import type { AppIdentity } from "./appIdentity";
import { describePublishedVersion, readPublishedVersion } from "./publishedVersion";

export function showReportOnly(rootElement: HTMLElement, options: { settings: SettingsRegistry; identity: AppIdentity; issueReporter?: IssueReporterConfig }): void {
  const { settings, identity } = options;
  const environment = browserStartupEnvironment();
  const checkpoints = readStartupCheckpoints(environment, location.pathname);
  const code = document.createElement("input");
  code.type = "text"; code.maxLength = 100;
  code.setAttribute("aria-label", "Observed browser error code");
  code.placeholder = "For example SBOX_FATAL_MEMORY_EXCEEDED";
  const files = checkpoints.flatMap((record, index) => {
    const prefix = index === 0 ? "latest" : "previous";
    const metadata = { ...record, sections: Object.keys(record.sections),
      termination: record.outcome === "loading" ? "Startup did not finish in this checkpoint. Termination reason is unknown." : "Last saved startup outcome; later termination is unknown." };
    return [{ name: `${prefix}-checkpoint.txt`, text: JSON.stringify(metadata, null, 2) },
      ...Object.entries(record.sections).map(([name, text]) => ({ name: `${prefix}-${name}`, text }))];
  });
  // Read, not written: the page may be opened again, and the app's next visit is still told of the one that stopped.
  const trail = createSessionTrail({ app: () => "", kept: () => false, limit: () => TRAIL_STEPS_DEFAULT, readOnly: true, environment: browserTrailEnvironment() });
  trail.step(`Opened ${reportPage(location.href)} for the report only: the map was not started`);
  const previous = trail.previous();
  // Asked and never acted on: this page is here to be read, so it does not reload itself.
  const published = readPublishedVersion(settings);
  const report = async (): Promise<string> => {
    const context = settings.getDeviceContext();
    return buildReport({
      at: new Date(),
      appName: document.title || "FOSS Earth",
      page: reportPage(location.href),
      build: identity.build, source: identity.source, fossEarth: identity.fossEarth, bundle: identity.bundle,
      userAgent: navigator.userAgent,
      screen: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio, touch: context.touch },
      device: { cores: context.hardwareConcurrency, memoryGiB: context.deviceMemoryGiB },
      environment: readBrowserReportDetails(),
      renderer: { asked: "not started", mode: "not started", driver: null, maxTextureSize: null, fallbackReason: null, lost: 0 },
      state: [
        `Recovery environment: This page's build and device observations describe recovery, not the saved attempt.`,
        `Startup checkpoints: ${checkpoints.length ? checkpoints.map(record => `${record.id}, saved ${new Date(record.savedAt).toISOString()}, outcome ${record.outcome}; shortened or omitted: ${record.omissions.join(", ") || "none"}`).join("; ") : "No retained checkpoint available. Storage may be disabled, cleared, unavailable, or the crashed build may predate capture."}`,
        `Observed browser error code (user supplied): ${redactIssueReport(code.value, reportSecrets(settings)) || "not supplied"}`,
        `Published: ${describePublishedVersion(await published, Date.now())}`],
      settings: effectiveReportSettings(settings),
      settingsComplete: true,
      steps: trail.steps(),
      errors: [],
      previous: await previous.catch(() => null),
    });
  };

  const source = { report, files: () => files, previous: () => previous, reportSecrets: () => reportSecrets(settings), copy: createBrowserClipboard(document, navigator) };
  const view = createReportView(source, { href: location.href, document, now: () => new Date(),
    downloads: browserReportDownloads(URL), issueReporter: options.issueReporter ?? issueReporterFromBuild() });
  const note = document.createElement("div");
  note.textContent = "The map was not started. Retained files remain on this device. Their timestamps show the last saved evidence; a crash may lose later updates.";
  const label = document.createElement("label");
  label.textContent = "Observed browser error code (optional) ";
  label.append(code);
  const hint = document.createElement("p");
  hint.textContent = "After entering a code, use View report or Refresh report to include it. The code is your observation; the page cannot read Edge's crash screen.";
  note.append(label, hint);
  view.element.querySelector("h1")?.after(note);
  rootElement.replaceChildren(view.element);
  view.show();
}
