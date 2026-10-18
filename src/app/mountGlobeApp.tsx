/**
 * FOSS Earth's whole app in one call: the globe with its HUD bar and toolbar,
 * the docked tab overlay the toolbar toggles, and the page's viewport insets.
 * FOSS Earth's own page is this call. An application that shows the globe as
 * it is, with its own scenes, makes the same call with its options.
 */
import "../styles/globe.css";
import "@foss-earth/ui/windowing.css";
import "@foss-earth/dev/panel.css";
import type { Root } from "react-dom/client";
import type { WindowOverlayHandle } from "../shell/WindowOverlay";
import type { AppTabId } from "./GlobeOverlay";
import { trackViewportInsets, markBrowserAppReady } from "@foss-earth/ui/browser";
import { getAppSettings } from "../settings/appSettings";
import { createGlobeApp, getAppIdentity, type GlobeAppHandle, type GlobeAppOptions } from "./createGlobeApp";
import { showReportOnly, wantsReportOnly } from "./reportOnly";

export async function mountGlobeApp(rootElement: HTMLElement, options: Omit<GlobeAppOptions, "overlayApiRef"> = {}): Promise<GlobeAppHandle> {
  // `?report`: the diagnostics report and nothing else, for an app that stops before its settings can be reached. The app never starts.
  if (wantsReportOnly(window.location.search)) {
    showReportOnly(rootElement, { settings: getAppSettings(), identity: getAppIdentity(), issueReporter: options.issueReporter });
    markBrowserAppReady(rootElement.ownerDocument);
    return new Promise<GlobeAppHandle>(() => {});
  }
  // React and the tabs' views, which the first frame does not need: they download while the globe starts.
  const overlayModules = Promise.all([import("react-dom/client"), import("./GlobeOverlay")]);
  overlayModules.catch(() => { /* reported where it is awaited, unless the globe failed first */ });
  // Lift the fixed HUD clear of any browser toolbar overlaying the page bottom.
  const viewportInsets = trackViewportInsets(document.documentElement, window);
  // Filled once the overlay mounts; the toolbar buttons read it when clicked.
  const overlayApi: { current: WindowOverlayHandle<AppTabId> | null } = { current: null };
  let globeApp: GlobeAppHandle | null = null;
  let overlay: Root | null = null;
  let overlayRoot: HTMLElement | null = null;
  let released = false;
  const release = (destroyApp: () => void): unknown[] => {
    if (released) return [];
    released = true;
    const errors: unknown[] = [];
    // React releases feature subscriptions before the app removes their DOM.
    for (const cleanup of [
      () => overlay?.unmount(),
      () => viewportInsets.dispose(),
      destroyApp,
      () => { overlayApi.current = null; overlayRoot?.remove(); },
    ]) {
      try { cleanup(); } catch (error) { errors.push(error); }
    }
    return errors;
  };
  try {
    const app = await createGlobeApp(rootElement, { ...options, overlayApiRef: overlayApi });
    globeApp = app;
    const [{ createRoot }, { GlobeOverlay }] = await overlayModules;
    overlayRoot = document.createElement("div");
    overlayRoot.className = "foss-earth-overlay-root";
    rootElement.querySelector(".globe-shell")?.append(overlayRoot);
    overlay = createRoot(overlayRoot);
    overlay.render(<GlobeOverlay app={app} overlayApi={overlayApi} />);
    const destroyApp = app.destroy.bind(app);
    app.destroy = () => {
      const errors = release(destroyApp);
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) throw new AggregateError(errors, "Mounted globe cleanup failed");
    };
    return app;
  } catch (error) {
    const cleanupErrors = release(() => globeApp?.destroy());
    if (cleanupErrors.length) throw new AggregateError([error, ...cleanupErrors], "Mounted globe startup and cleanup failed");
    throw error;
  }
}
