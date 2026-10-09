/**
 * `?report` in the address: the page shows the diagnostics report and starts
 * nothing else (docs/diagnostics.md). It is how the trail of a visit is read
 * when the app stops before Settings → Diagnostics can be reached, as when it
 * stops while starting.
 */
import { buildReport, reportPage, createSessionTrail, TRAIL_STEPS_DEFAULT, type IssueReporterConfig } from "@foss-earth/ui/diagnostics";
export { REPORT_ONLY_PARAMETER, wantsReportOnly, addressWithoutReport } from "@foss-earth/ui/diagnostics";
import type { SettingsRegistry } from "@foss-earth/ui/settings";
import { createReportView, readBrowserReportDetails, browserTrailEnvironment, createBrowserClipboard, browserReportDownloads } from "@foss-earth/ui/browser";
import { effectiveReportSettings, reportSecrets } from "./appDiagnostics";
import { issueReporterFromBuild } from "./issueReporting";
import type { AppIdentity } from "./appIdentity";
import { describePublishedVersion, readPublishedVersion } from "./publishedVersion";

export function showReportOnly(rootElement: HTMLElement, options: { settings: SettingsRegistry; identity: AppIdentity; issueReporter?: IssueReporterConfig }): void {
  const { settings, identity } = options;
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
      state: [`Published: ${describePublishedVersion(await published, Date.now())}`],
      settings: effectiveReportSettings(settings),
      settingsComplete: true,
      steps: trail.steps(),
      errors: [],
      previous: await previous.catch(() => null),
    });
  };

  const source = { report, previous: () => previous, reportSecrets: () => reportSecrets(settings), copy: createBrowserClipboard(document, navigator) };
  const view = createReportView(source, { href: location.href, document, now: () => new Date(),
    downloads: browserReportDownloads(URL), issueReporter: options.issueReporter ?? issueReporterFromBuild() });
  const note = document.createElement("p");
  note.textContent = "The map was not started.";
  view.element.querySelector("h1")?.after(note);
  rootElement.replaceChildren(view.element);
  view.show();
}
