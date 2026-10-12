import { renderPerformanceChips, browserHudBarLayoutPorts, createToolbarInterfaceSection, createPositionInterfaceSection } from "@foss-earth/toolbar/browser";
import { PANORAMA_GAMEPAD_ACTIONS, createPanoramaProfileContribution } from "@foss-earth/360";
import { createEarthDevHost, type EarthDevContribution, type EarthDevTab } from "./devHost";
import { createMapSourceHud } from "@foss-earth/engine/panels";
import { connectMapDetailLog } from "@foss-earth/engine/panels";
import { attachRendererActivity } from "@foss-earth/toolbar/browser";
import { createBrowserInputSource } from "@felipegalind0/gamepad-tools/browser";
import { BindingRuntime, createProfileStore, DEFAULT_BINDING_TRANSFORM } from "@felipegalind0/gamepad-tools/core";
import { mountBindingEditor, type BindingEditorHandle } from "@felipegalind0/gamepad-tools/ui";
import "@felipegalind0/gamepad-tools/styles.css";
import { Matrix, Vector3 } from "@babylonjs/core";
import { attachWorldOcclusion, type BabylonRuntime } from "@foss-earth/engine/babylon";
import { createEarthBrowserRuntime } from "./browserRuntime";
import { createEarthBrowserPolicy } from "./browserPolicy";
import { createEarthFeatureFramePreparation } from "./framePreparation";
import type { GlobeFramePreparation } from "@foss-earth/engine/babylon";
import { createEarthUiHost } from "./uiHost";
import { createGameLog, type GameLogLine, type GameLogTone } from "@foss-earth/ui/browser";
import { applyRendererChoice } from "@foss-earth/renderer/babylon";
import { RASTER_BASE_MAP_SOURCES, type RasterBaseMapSource } from "@foss-earth/engine";
import {
  resolveMapRuntimeConfig,
  setMapSourcePreference,
  setTerrainSourcePreference,
} from "@foss-earth/engine/settings";
import { TERRAIN_SOURCES, type TerrainSource } from "@foss-earth/engine";
import { getAppSettings } from "../settings/appSettings";
import { INPUT_SENSITIVITY_IDS, PERFORMANCE_HUD_METRICS, POSITION_ALTITUDE_ID, TOOLBAR_EDIT_PRIORITIES_ID, TOOLBAR_PRIORITIES, toolbarPriorityParameterId } from "../settings/catalogue";
import { createParameterControl, type ParameterControlHandle } from "@foss-earth/ui/browser";
import { createParameterSection, type ParameterSectionHandle } from "@foss-earth/ui/browser";
import { createThemeControl } from "@foss-earth/ui/browser";
import { createPresetsSection } from "@foss-earth/ui/browser";
import { createSavedSettingsSection } from "@foss-earth/ui/browser";
import { createAppFilesSection, describeAppFiles } from "@foss-earth/ui/browser";
import { createDiagnosticsSection } from "@foss-earth/ui/browser";
import { createBugReportPanel } from "@foss-earth/ui/browser";
import { stepKind } from "@foss-earth/ui/diagnostics";
import { reportSecrets, startAppDiagnostics, type AppDiagnostics } from "./appDiagnostics";
import { issueReporterFromBuild } from "./issueReporting";
import type { IssueReporterConfig } from "@foss-earth/ui/diagnostics";
import { keepAppFiles } from "./appFiles";
import { getAppIdentity } from "./appIdentity";
import { createAboutPanel } from "../shell/aboutPanel";
import { describePublishedVersion, watchPublishedVersion, type PublishedVersionWatch } from "./publishedVersion";
import type {
  GlobeHandle,
  GlobeLayerContext,
  GlobeViewState,
} from "@foss-earth/engine";
import { browserGameLogPorts, createBrowserClipboard, browserReportDownloads, GAME_LOG_SIZE_EVENT, createExternalLinkIcon } from "@foss-earth/ui/browser";
import { createPoiTracking } from "@foss-earth/engine/layers";
import { createLayerRegistry } from "@foss-earth/engine/layers";
import { MAX_PITCH_DEG } from "@foss-earth/engine";
import { ecefToGeodetic, RAD_TO_DEG } from "@foss-earth/engine";
import { createStatusHud, type CameraAltitude, type StatusHudHandle } from "@foss-earth/toolbar/browser";
import { surfaceHeightDatum } from "@foss-earth/engine";
import { PERFORMANCE_METRIC_DEFINITIONS, MAP_SOURCE_HUD_LAYOUT_ID, type PerformanceMetricId } from "@foss-earth/toolbar";
import { createNorthButton, type NorthButtonHandle } from "@foss-earth/toolbar/browser";
import { createHelpModal, type HelpModalHandle } from "@foss-earth/toolbar/browser";
import { HUD_BUTTON_IDS, hudButtonParameterId, type HudButtonId } from "@foss-earth/toolbar";
import type { PanelSection } from "@foss-earth/ui/react";
import type { WindowOverlayHandle } from "../shell/WindowOverlay";
import { createMapSourcePanel } from "@foss-earth/engine/panels";
import { createMapDetailController, type MapDetailController } from "@foss-earth/engine/settings";
import { connectMapDetailRuntime } from "@foss-earth/engine/settings";
import { createRendererPanel, getRendererLabel } from "@foss-earth/renderer/panel";
import { createSkyPanel } from "@foss-earth/sky/panels";
import { createDateTimePanel } from "@foss-earth/sky/panels";
import { createFrameBudgetPanel } from "@foss-earth/renderer/panel";
import { FRAME_PROFILING_IDS, frameProfilingParameters } from "@foss-earth/renderer/settings";
import { createOrbitCompass, type OrbitCompassHandle } from "@foss-earth/engine/compass";
import { createHemisphereCulling } from "@foss-earth/engine/visualization";
import { createPerformanceMetrics, type PerformanceSnapshot } from "@foss-earth/renderer/diagnostics";
import { createAnchorHeightResolver } from "@foss-earth/engine/babylon";
import { createPoiSpriteSizeTuner } from "@foss-earth/engine/visualization-tuners";
import { createCompassScaleTuner } from "@foss-earth/engine/visualization-tuners";
import { createInputModeHud, type InputModeHudHandle } from "@foss-earth/engine/panels";
import { createNavigationAnchorPinSection } from "@foss-earth/engine/panels";
import { loadInputSensitivityPreference } from "@foss-earth/engine/settings";
import {
  createGlobeGamepadAdapter,
  createStandardGlobeProfile,
  STANDARD_GLOBE_PROFILE_NAME,
  withStickDeadzone,
} from "@foss-earth/engine/gamepad";
import { createHudBar } from "@foss-earth/toolbar/browser";
import { fitHudBar, type HudBarFitItem } from "@foss-earth/toolbar/browser";
import { attachFullscreenButton, browserFullscreenPort } from "@foss-earth/toolbar/browser";
import { createBrowserPositionSeaLevelPort } from "./positionSeaLevel";
import { createSceneHud, attachMapDownloadSpeed, setMapSourceLabel, attachTileStreamingActivity } from "@foss-earth/toolbar/browser";
import type { ViewerTabs as PanoramaTabs } from "@foss-earth/360/panels";
import { connectSceneLog } from "@foss-earth/scenes/browser";
import type { SceneController, SceneExample } from "@foss-earth/scenes/browser";
import { SCENE_EXAMPLES } from "../scenes/examples";
import type { MediaStore } from "@foss-earth/images";
import { createEarthSceneHost } from "./sceneHost";
import { attemptEarthCleanup } from "./nativeResources";
import { bindEarthTheme } from "../theme/theme";
import { effectiveOrbRadius, type PanoramaRenderer } from "@foss-earth/360/babylon";
import * as panoramaMath from "@foss-earth/360";
import type { PoiSpriteSizeParams } from "@foss-earth/engine/visualization-tuners";
import type { OrbitCompassScaleParams } from "@foss-earth/engine/compass";

declare global {
  interface Window {
    /** Test only, with `?panoramaTest=1`: what scripts/validation/panorama-campus.mjs drives and reads. */
    __fossEarthPanoramaTest?: {
      runtime: BabylonRuntime;
      scenes: SceneController;
      readonly renderer: PanoramaRenderer | null;
      /** The app's settings: the check resets automatic map detail before it times frames. */
      settings: ReturnType<typeof getAppSettings>;
      /** The CPU reference the check holds the GPU's output against. */
      math: typeof panoramaMath & { effectiveOrbRadius: typeof effectiveOrbRadius };
      /** The images kept between visits: scripts/validation/scene-revisit.mjs reads and clears them. */
      media: MediaStore;
      /** The visit's trail and report: scripts/validation/diagnostics.mjs reads them. */
      diagnostics: AppDiagnostics;
      /** Whether this page is the published one: scripts/validation/published-version.mjs reads it. */
      publishedVersion: PublishedVersionWatch;
    };
  }
}

export interface GlobeAppHandle extends GlobeHandle {
  runtime: BabylonRuntime;
  inputModeHud: InputModeHudHandle | null;
  /** Shows the host's Controls tab, where the controller bindings live. */
  openControllerBindings(): void;
  /** The globe's input and controller settings, for the host's Controls tab. */
  controlsSections: readonly PanelSection[];
  /** Toolbar, position and log, for the host's Interface tab. Theme and window controls are interfaceLead. */
  interfaceSections: readonly PanelSection[];
  /** Theme and window controls, above the Interface tab's sections. */
  interfaceLead: HTMLElement;
  /** Place-lookup limits, shown at the bottom of the Location tab. */
  locationSearchSection: PanelSection;
  /** Presets, saved settings, the app's files and diagnostics, for the host's Settings tab. */
  settingsSections: readonly PanelSection[];
  /** Which version runs and what it is built from, for the host's About tab. */
  aboutTab: HTMLElement;
  /** The report form's one home, prepared when this tab is first shown. */
  bugReportTab: HTMLElement;
  onBugReportShow(): void;
  /** The basemap and elevation choice, for the host's Map tab. */
  mapTab: HTMLElement;
  /** The GPU renderer choice, for the host's Renderer tab. */
  rendererTab: HTMLElement;
  /** Where the Sun is, the atmosphere, the ground under it and exposure, for the host's Sky tab. */
  skyTab: HTMLElement;
  /** The dials that set the time the Sun is placed for, for the host's Date and time tab. */
  timeTab: HTMLElement;
  /** Scenes to load and their panoramas, for the host's Scenes tab. */
  scenesTab: HTMLElement;
  /** The panorama's own tab and 360 image settings, for the window overlay's `panoramaTabs`. */
  panoramaTabs: PanoramaTabs;
  /** The mounted scene, if any, and loading another. */
  scenes: SceneController;
  readonly devTab: EarthDevTab | null;
  whenDevSettled(): Promise<void>;
  onTabVisibility(tabId: string, visible: boolean): void;
}

export interface GlobeAppOptions {
  /** Download full diagnostics and open an issue draft in this GitHub repository. */
  issueReporter?: IssueReporterConfig;
  googleApiKey?: string | null;
  baseMap?: string | RasterBaseMapSource | null;
  preferGoogleTiles?: boolean;
  getSurfaceHeightMeters?: (latDeg: number, lonDeg: number) => number | null;
  terrainSource?: string | TerrainSource | null;
  /** @deprecated Ignored: terrain detail is `map.detail.terrain.*`, adjusted by `map.auto.*`. */
  rasterQuality?: unknown;
  onPoiSpriteSizeChange?: (params: PoiSpriteSizeParams) => void;
  onCompassScaleChange?: (params: OrbitCompassScaleParams) => void;
  /** A detail controller the host configured; the app creates one otherwise. */
  mapDetail?: MapDetailController;
  /**
   * The scenes this app offers: listed in Scenes → Content, and the only ones
   * `?scene=<id>` opens. Their URLs resolve against the app's base URL.
   * Default: FOSS Earth's example scenes.
   */
  scenes?: readonly SceneExample[];
  /** The id of one of `scenes` to open at start, when the address names none with `?scene=`. */
  initialScene?: string;
  /** Host-owned observations mounted only through the optional shared Dev tab. */
  devContributions?: readonly EarthDevContribution[];
  /**
   * The host's tab overlay, filled once it mounts. The toolbar buttons toggle
   * its tabs: \u2699 Settings, input method Controls, the position Location,
   * and the renderer and map chips their own tabs.
   */
  overlayApiRef?: { current: WindowOverlayHandle<"dev"> | null };
}

/** Pixel offset from the projected sphere centre to the top-right exit button. */
const POI_EXIT_BTN_OFFSET_PX = 22;
/** The site's GitHub repository, whose latest deploy About names. */

export { getAppIdentity, getLoadedBundleName } from "./appIdentity";

function readVisiblePerformanceMetrics(): Set<PerformanceMetricId> {
  return new Set(PERFORMANCE_METRIC_DEFINITIONS
    .filter((metric) => readHudPreference(`interface.performanceHud.${metric.id}`).wanted)
    .map((metric) => metric.id));
}

function readHudPreference(id: string): { wanted: boolean; pinned: boolean } {
  const mode = getAppSettings().get(id);
  return { wanted: mode === "on" || mode === "auto", pinned: mode === "on" };
}

function getFallbackNoticeMessage(status: BabylonRuntime["status"]): string {
  if (!status.googleApiKeyProvided) {
    return "Fallback mode active because no Google Maps API key was provided. Append ?key=YOUR_GOOGLE_MAPS_API_KEY to the URL to enable Google Photorealistic 3D Tiles.";
  }

  if (status.lastError) {
    return `Fallback mode active because Google 3D tiles failed: ${status.lastError} Verify the key is valid, the Maps Tiles API is enabled, and localhost is allowed in key restrictions.`;
  }

  return "Fallback mode active.";
}

function getGoogleWarningMessage(status: BabylonRuntime["status"]): string {
  if (status.lastError) {
    return `Google tiles reported an error: ${status.lastError}`;
  }

  return "Google mode is active, but tiles may still be loading.";
}

function getRasterWarningMessage(status: BabylonRuntime["status"]): string {
  const source = status.rasterBaseMap;
  if (status.lastError) {
    return `${source?.label ?? "Raster basemap"} is active, but some tiles failed to load: ${status.lastError}`;
  }

  return `${source?.label ?? "Raster basemap"} is active. Attribution: ${source?.attribution ?? "see provider terms"}.`;
}

/** A single-color bug, so the toolbar mark does not carry the emoji's palette. */
function createBugIcon(document: Document): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const d of [
    "M8 2.5 9.8 4.3",
    "M14.2 4.3 16 2.5",
    "M9 7.2V6a3 3 0 0 1 6 0v1.2",
    "M12 20.5c-3.3 0-6-2.6-6-5.8v-3.2A3.5 3.5 0 0 1 9.5 8h5A3.5 3.5 0 0 1 18 11.5v3.2c0 3.2-2.7 5.8-6 5.8Z",
    "M12 20.5V11",
    "M6.6 9.2C4.8 9 3.2 7.4 3.2 5.4",
    "M6 13.2H2.2",
    "M3.4 20.8c0-2 1.6-3.7 3.6-3.8",
    "M17.4 9.2c1.8-.2 3.4-1.8 3.4-3.8",
    "M18 13.2h3.8",
    "M17 17c2 .1 3.6 1.8 3.6 3.8",
  ]) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.8");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.append(path);
  }
  return svg;
}

export async function createGlobeApp(
  rootElement: HTMLElement,
  options: GlobeAppOptions = {},
): Promise<GlobeAppHandle> {
  const cleanup: (() => void)[] = [() => rootElement.replaceChildren()];
  let disposed = false;
  const disposeApp = () => {
    if (disposed) return;
    disposed = true;
    attemptEarthCleanup([...cleanup].reverse(), "Earth application cleanup failed.");
  };
  try {
  rootElement.innerHTML = `
    <div class="globe-shell">
      <canvas id="globeCanvas" class="globe-canvas" aria-label="3D globe canvas"></canvas>

      <div id="hudBarRoot"></div>

      <div id="helpModal" class="modal-overlay" hidden aria-modal="true" role="dialog"
        aria-labelledby="helpModalTitle">
        <div class="modal-card">
          <h2 id="helpModalTitle" class="modal-title">Controls</h2>
          <div class="help-axes">
            <div class="help-axis">
              <div class="help-axis-title">Pan</div>
              <div class="help-axis-triggers">
                <span class="help-trigger">Left drag</span>
                <span class="help-trigger">2-finger swipe</span>
                <span class="help-trigger">1-finger <small>(mobile)</small></span>
                <span class="help-trigger">Left stick <small>(controller)</small></span>
              </div>
              <div class="help-axis-note">Changes Lat\u202F/\u202FLon</div>
            </div>
            <div class="help-axis">
              <div class="help-axis-title">Orbit</div>
              <div class="help-axis-triggers">
                <span class="help-trigger">Right drag</span>
                <span class="help-trigger">\u21E7\u202F+\u202F2-finger swipe</span>
                <span class="help-trigger">2-finger <small>(mobile)</small></span>
                <span class="help-trigger">Right stick <small>(controller)</small></span>
              </div>
              <div class="help-axis-note">Changes Heading\u202F/\u202FPitch</div>
            </div>
          </div>
          <p class="help-zoom">Zoom \u2014 Scroll wheel\u00B7Pinch\u00B7Triggers <small>(controller)</small></p>
          <p class="help-zoom">Wheel, pinch and right drag act about the point under the pointer or fingers; keys and the controller about the compass target. Change them, or pin a point, in Controls \u2192 Mouse, Touch and Orbit.</p>
          <p class="help-zoom">Controller \u2014 top face button resets north-up\u00B7Change bindings in Controls \u2192 Controller</p>
          <button id="helpModalDismiss" class="modal-dismiss" type="button">Got it</button>
        </div>
      </div>

      <div id="settingsSectionsHolder" hidden>
        <div id="controlsInputMethodSection" class="settings-section-content"></div>
        <div id="controlsControllerSection" class="settings-section-content"></div>
      </div>

      <button id="poiExitBtn" class="poi-exit-btn" hidden
        type="button" aria-label="Exit point of interest view">&#x2715;</button>

      <div id="extraPanelsGrid" class="extra-panels-grid"></div>
    </div>
  `;

  const hudBarRoot = rootElement.querySelector<HTMLElement>("#hudBarRoot");
  if (!hudBarRoot) {
    throw new Error("Expected to find the HUD bar root.");
  }
  const hudBar = createHudBar(hudBarRoot, {
    document,
    observeHeight(element, changed) { const observer = new ResizeObserver(changed); observer.observe(element); return () => observer.disconnect(); },
    ariaLabel: "Map indicators",
    items: [
      {
        kind: "button",
        id: "northButton",
        title: "Reset to north-up",
        ariaLabel: "Reset camera to north-up",
        className: "north-button",
        content: () => {
          const template = document.createElement("template");
          template.innerHTML = `<svg id="northButtonSvg" viewBox="0 0 36 36" width="28" height="28" aria-hidden="true"><polygon points="18,5 14,14 22,14" fill="#ef4444"></polygon><text x="18" y="27" text-anchor="middle" fill="rgba(255,255,255,0.82)" font-family="system-ui,-apple-system,sans-serif" font-weight="700" font-size="13">N</text></svg>`;
          return template.content.firstElementChild ?? document.createElement("span");
        },
      },
      { kind: "button", id: "helpButton", title: "Controls help", ariaLabel: "Controls help", text: "?" },
      { kind: "slot", id: "perfMetricsPill", className: "hud-chip-group perf-chip-group", ariaLabel: "Performance metrics" },
      { kind: "button", id: "rendererModePill", title: "GPU renderer API. Click to show or hide the Renderer tab.", ariaLabel: "GPU renderer API", appearance: "chip", className: "hud-chip-button hud-chip--gpu", text: "GPU" },
      {
        kind: "button",
        id: "themeButton",
        title: "Toggle theme",
        ariaLabel: "Toggle theme",
        className: "theme-button",
        content: () => {
          const icon = document.createElement("span");
          icon.className = "theme-button-icon";
          icon.setAttribute("aria-hidden", "true");
          icon.textContent = "☾";
          return icon;
        },
      },
      { kind: "button", id: "settingsButton", title: "Settings", ariaLabel: "Settings", className: "settings-button", text: "⚙" },
      { kind: "button", id: "bugReportButton", title: "Show or close the Bug report tab", ariaLabel: "Bug report", className: "bug-report-button", content: () => createBugIcon(document) },
      { kind: "button", id: "fullscreenButton", title: "Enter fullscreen", ariaLabel: "Enter fullscreen", text: "⛶" },
      { kind: "button", id: "hudStatus", appearance: "chip", className: "hud-chip-button hud-status-text", ariaLive: "polite", ariaLabel: "Position readout", title: "Latitude and longitude of the point looked at, the camera's altitude, heading, pitch and zoom distance. Click to show or hide the Location tab." },
      { kind: "slot", id: "mapSourceSlot", className: "hud-bar-end map-source-hud-slot" },
    ],
  });

  const canvas = rootElement.querySelector<HTMLCanvasElement>("#globeCanvas");
  cleanup.push(() => hudBar.destroy());
  if (!canvas) {
    throw new Error('Expected to find a canvas element with id "globeCanvas".');
  }

  const rendererModePill = rootElement.querySelector<HTMLButtonElement>("#rendererModePill");
  const perfMetricsPill = rootElement.querySelector<HTMLElement>("#perfMetricsPill");

  // One registry for the page: the map source, renderer and every other
  // parameter below are read from it and follow it.
  const settings = getAppSettings();
  if (!settings.has(FRAME_PROFILING_IDS.enabled)) settings.register(frameProfilingParameters({ tab: "renderer", section: "performance" }));
  const ui = createEarthUiHost(settings, document);
  cleanup.push(() => ui.dispose());
  const theme = bindEarthTheme(settings, document);
  cleanup.push(() => theme.dispose());
  const { getTheme, setTheme, onThemeChange, toggleTheme } = theme;
  const copy = createBrowserClipboard(document, navigator);
  const logElement = document.createElement("div");
  logElement.id = "app-log";
  document.body.append(logElement);
  cleanup.push(() => logElement.remove());
  const log = createGameLog(settings, browserGameLogPorts(logElement, window, {
    onSize: detail => window.dispatchEvent(new CustomEvent(GAME_LOG_SIZE_EVENT, { detail })),
    isCentered: () => document.documentElement.dataset.dockLayout === "dual",
    resizesWidth: () => document.documentElement.dataset.dockLayout !== "stacked",
    isRightAligned: () => document.documentElement.dataset.dockLayout === "single" && document.documentElement.dataset.dockSide === "left",
  }));

  // Every line of the log is a step of the visit's trail, which Settings → Diagnostics copies as a report.
  cleanup.push(() => log.destroy());
  const diagnostics = startAppDiagnostics({
    log,
    settings,
    identity: getAppIdentity(),
  });
  const gameLog = diagnostics.log;
  cleanup.push(() => diagnostics.destroy());
  // Asked while the renderer starts: a browser may have opened its own copy of an older page, which then reloads before it has shown anything.
  const publishedVersion = watchPublishedVersion({ settings, log: gameLog });
  cleanup.push(() => publishedVersion.dispose());
  diagnostics.addState(() => `Published: ${describePublishedVersion(publishedVersion.state(), publishedVersion.now())}`);
  let lastLoggedStatus: string | null = null;
  const statusLines = new Map<string, GameLogLine>();
  /** The map's trouble now, or null for none: a line stays only while its trouble does. */
  const logStatus = (text: string | null, tone: GameLogTone = "warning"): void => {
    if (text === lastLoggedStatus) return;
    lastLoggedStatus = text;
    // The same trouble with another tile's address is the same line with its latest wording, not a line for every tile.
    const kind = text === null ? null : `${tone} ${stepKind(text)}`;
    for (const [other, line] of statusLines) {
      if (other === kind) continue;
      line.remove();
      statusLines.delete(other);
    }
    if (text === null || kind === null) return;
    const line = statusLines.get(kind);
    if (line) line.update({ text, tone });
    else statusLines.set(kind, gameLog.print({ text, tone }));
  };

  let onMapStatus: ((status: BabylonRuntime["status"]) => void) | null = null;
  const applyRuntimeStatus = (status: BabylonRuntime["status"]): void => {
    onMapStatus?.(status);
    // With a 2D basemap, the runtime starts in fallback mode only until that map is up.
    if (status.mode === "fallback" && (!status.rasterBaseMap || status.lastError)) logStatus(getFallbackNoticeMessage(status));
    else if (status.mode === "raster-basemap" && status.lastError) logStatus(getRasterWarningMessage(status));
    else if (status.mode !== "raster-basemap" && status.lastError) logStatus(getGoogleWarningMessage(status));
    else logStatus(null);
  };

  const mapConfig = resolveMapRuntimeConfig({
    googleApiKey: options.googleApiKey,
    baseMap: options.baseMap,
    preferGoogleTiles: options.preferGoogleTiles,
    terrainSource: options.terrainSource,
    settings,
  });

  let prepareSceneFrame: ((frame: GlobeFramePreparation) => void) | null = null;
  const browserPolicy = createEarthBrowserPolicy(settings);
  const browser = await createEarthBrowserRuntime(canvas, {
    ...browserPolicy,
    framePreparation: { prepare: frame => prepareSceneFrame?.(frame) },
    googleApiKey: mapConfig.googleApiKey,
    preferGoogleTiles: mapConfig.preferGoogleTiles,
    rasterBaseMap: mapConfig.rasterBaseMap,
    terrainSource: mapConfig.terrainSource,
    rasterImagery: mapConfig.rasterImagery,
    getSurfaceHeightMeters: options.getSurfaceHeightMeters,
    onStatusChange: applyRuntimeStatus,
    settings,
  });
  const runtime = browser.runtime;
  cleanup.push(() => runtime.destroy());
  const worldOcclusion = attachWorldOcclusion(runtime.scene, canvas);
  cleanup.push(() => worldOcclusion.dispose());
  const afterFrameUi = runtime.scene.onAfterRenderObservable.add(ui.emit);
  cleanup.push(() => { runtime.scene.onAfterRenderObservable.remove(afterFrameUi); });
  const offResourceUi = browser.broker.pools.subscribeAvailable(ui.emit);
  cleanup.push(offResourceUi);
  diagnostics.attachRuntime(runtime);
  const compassHeightOffset = (): number => {
    const value = settings.get("visualization.compass.heightOffset");
    return typeof value === "number" ? value : 0;
  };
  const layerContext: GlobeLayerContext = {
    scene: runtime.scene,
    engine: runtime.engine,
  };
  const poiTracking = createPoiTracking(runtime.scene, () => runtime.geospatialCamera, {
    dragThresholdPx: () => settings.get<number>("input.mouse.dragThreshold"),
    // Tracking eases the view onto a point at the pace a glide slows by, drawing each frame until it is there.
    entryKeepPerFrame: () => runtime.getCameraHandling().glideKeepPerFrame,
    requestRender: () => runtime.requestRender(),
  });
  cleanup.push(() => poiTracking.destroy());
  const culling = createHemisphereCulling(() => runtime.geospatialCamera?.globalPosition ?? null);
  cleanup.push(() => culling.destroy());
  const resolveSurfaceHeightMeters = (latDeg: number, lonDeg: number): number | null => (
    options.getSurfaceHeightMeters?.(latDeg, lonDeg) ?? runtime.surface?.sample(latDeg, lonDeg)?.heightMeters ?? null
  );
  // The compass follows the ground as the orbit target does: `camera.surfaceFollowSpeed` and `camera.surfaceRetry`.
  const anchorTuning = () => ({
    maxVerticalSpeedMetersPerSecond: settings.get<number>("camera.surfaceFollowSpeed"),
    providerMissRetryMs: settings.get<number>("camera.surfaceRetry"),
  });
  const anchorHeights = createAnchorHeightResolver({
    nowMs: browser.clock.nowMs,
    provider: resolveSurfaceHeightMeters,
    cacheProviderSamples: false,
    heightOffsetMeters: compassHeightOffset(),
    ...anchorTuning(),
  });
  runtime.configureOrbitTargetHeight({
    resolveSurfaceHeightMeters: anchorHeights.resolveHeight,
    initialOffsetMeters: compassHeightOffset(),
  });
  const registry = createLayerRegistry(layerContext, poiTracking, culling, anchorHeights);
  cleanup.push(() => registry.destroy());
  // Layer add/remove mutates scene contents (meshes, sprites); wrap so the
  // change becomes visible on the next animation frame in render-on-demand mode.
  const addLayer: typeof registry.addLayer = (layer) => {
    registry.addLayer(layer);
    runtime.requestRender();
  };
  const removeLayer: typeof registry.removeLayer = (layerId) => {
    registry.removeLayer(layerId);
    runtime.requestRender();
  };
  const orbitCompass: OrbitCompassHandle = createOrbitCompass(runtime.scene, { device: browser.native.canvasDevice, requestRender: () => runtime.requestRender() });
  cleanup.push(() => orbitCompass.destroy());
  const performanceMetrics = createPerformanceMetrics({
    now: () => performance.now(), memoryBytes: () => { const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory; return memory?.usedJSHeapSize ?? null; },
    engine: runtime.engine,
    scene: runtime.scene,
    getTileMetrics: () => runtime.getTileMetrics(),
    getCullingStats: () => culling.getStats(),
  });

  if (rendererModePill) {
    const rendererLabel = getRendererLabel(runtime.renderer.mode);
    const forceFailed =
      runtime.renderer.requested !== "auto" && runtime.renderer.requested !== runtime.renderer.mode;
    rendererModePill.textContent = forceFailed ? `${rendererLabel}*` : rendererLabel;
    rendererModePill.classList.toggle("hud-chip--good", runtime.renderer.mode === "webgpu");
    rendererModePill.classList.toggle("hud-chip--bad", runtime.renderer.mode !== "webgpu");
  }
  const toggleTab = (tabId: Parameters<WindowOverlayHandle<"dev">["toggleTab"]>[0]): void => {
    options.overlayApiRef?.current?.toggleTab(tabId);
  };
  // One detail controller: the HUD rail and the Map tab's Detail group both
  // observe it, and it is the only writer of the renderer's detail target.
  const mapDetail: MapDetailController = options.mapDetail ?? createMapDetailController({ settings, deviceHints: () => { const hints = settings.getDeviceContext(); return { hardwareConcurrency: hints.hardwareConcurrency ?? undefined, deviceMemory: hints.deviceMemoryGiB ?? undefined }; } });
  cleanup.push(() => { if (!options.mapDetail) mapDetail.dispose(); });
  const disconnectMapDetail = connectMapDetailRuntime(mapDetail, runtime);
  cleanup.push(disconnectMapDetail);
  const mapPanel = createMapSourcePanel({
    document, InputElement: HTMLInputElement, ui: ui.publicUi, refresh: ui.refresh, panelStorage: ui.storage,
    cache: { inspect: browser.cache.inspect, clear: browser.cache.clear, nowMs: () => performance.now(), refreshIntervalMs: () => settings.get<number>("map.cache.inspectInterval"), rowLimit: () => settings.get<number>("map.cache.rowsShown") },
    detailPanel: { createTrack: ui.createTrack, idSuffix: () => crypto.randomUUID() },
    detail: mapDetail,
    rasterSources: RASTER_BASE_MAP_SOURCES,
    terrainSources: TERRAIN_SOURCES,
    settings,
    // The runtime follows map.source.*: saving the choice switches the map.
    onMapSourceChange: (selected) => setMapSourcePreference(selected, settings),
    onTerrainSourceChange: (selected) => setTerrainSourcePreference(selected, settings),
  });

  // The map source sits at the bar's right end: the basemap's name and credit
  cleanup.push(() => mapPanel.destroy());
  // link, the download speed, and a detail rail for Google 3D Tiles.
  const mapSourceSlot = rootElement.querySelector<HTMLElement>("#mapSourceSlot");
  const mapSourceHud = mapSourceSlot
    ? createMapSourceHud(mapSourceSlot, {
        layout: settings.get(MAP_SOURCE_HUD_LAYOUT_ID) === "expanded" ? "expanded" : "compact",
        document, ui: { createExternalLinkIcon, attachMapDownloadSpeed, setMapSourceLabel, attachTileStreamingActivity },
        activity: runtime,
        onProviderClick: () => toggleTab("map"),
        detail: { controller: mapDetail, document },
      })
    : null;
  onMapStatus = (status) => {
    mapPanel.update(status);
    mapSourceHud?.update(status);
  };
  cleanup.push(() => { onMapStatus = null; mapSourceHud?.destroy(); });
  applyRuntimeStatus(runtime.status);

  // ── HUD setup ────────────────────────────────────────────────────
  const hudStatusEl = rootElement.querySelector<HTMLElement>("#hudStatus");
  const northBtnEl = rootElement.querySelector<HTMLButtonElement>("#northButton");
  const northBtnSvgEl = rootElement.querySelector<SVGElement>("#northButtonSvg");
  const helpBtnEl = rootElement.querySelector<HTMLButtonElement>("#helpButton");
  const helpModalEl = rootElement.querySelector<HTMLElement>("#helpModal");
  const settingsBtnEl = rootElement.querySelector<HTMLButtonElement>("#settingsButton");
  const bugReportBtnEl = rootElement.querySelector<HTMLButtonElement>("#bugReportButton");
  const themeBtnEl = rootElement.querySelector<HTMLButtonElement>("#themeButton");
  const fullscreenBtnEl = rootElement.querySelector<HTMLButtonElement>("#fullscreenButton");
  const detachFullscreen = fullscreenBtnEl ? attachFullscreenButton(fullscreenBtnEl, browserFullscreenPort) : null;
  cleanup.push(() => detachFullscreen?.());
  const themeBtnIconEl = themeBtnEl?.querySelector<HTMLElement>(".theme-button-icon") ?? null;
  const poiExitBtnEl = rootElement.querySelector<HTMLButtonElement>("#poiExitBtn");
  const extraPanelsGridEl = rootElement.querySelector<HTMLElement>("#extraPanelsGrid");

  const positionSeaLevel = createBrowserPositionSeaLevelPort();
  cleanup.push(() => positionSeaLevel.dispose());
  let locationTabOpen = false;
  const statusHud: StatusHudHandle | null = hudStatusEl ? createStatusHud(hudStatusEl, settings, {
    document,
    seaLevel: positionSeaLevel,
    onCommit(commit) {
      if (commit.part === "altitude") {
        if (commit.reference && settings.get(POSITION_ALTITUDE_ID) !== commit.reference) settings.set(POSITION_ALTITUDE_ID, commit.reference);
        if (commit.value !== undefined) runtime.setViewState({ zoomMeters: commit.value });
        return;
      }
      if (commit.value === undefined) return;
      runtime.setViewState(commit.part === "latitude" ? { latDeg: commit.value } : { lonDeg: commit.value });
    },
  }) : null;
  cleanup.push(() => statusHud?.destroy());
  const globePositionTitle = hudStatusEl?.title ?? "";
  let showingPanoramaPosition = false;
  const syncPositionEditing = (): void => {
    statusHud?.setEditable(locationTabOpen && !showingPanoramaPosition);
  };
  const showPositionContext = (inside: boolean): void => {
    if (inside === showingPanoramaPosition) return;
    showingPanoramaPosition = inside;
    syncPositionEditing();
    if (!hudStatusEl) return;
    hudStatusEl.setAttribute("aria-label", inside ? "Picture position and view" : "Position readout");
    hudStatusEl.title = inside
      ? "The picture's latitude, longitude and capture height, current heading, pitch and vertical field of view. Click to show the panorama tab."
      : globePositionTitle;
  };
  // The readout's altitude is the camera's own, not the height of what it looks at.
  const cameraAltitude = (): CameraAltitude | null => {
    const eye = runtime.geospatialCamera?.position;
    if (!eye || !statusHud) return null;
    const { latRad, lonRad, altMeters } = ecefToGeodetic(eye.x, eye.y, eye.z);
    return {
      altitudeMeters: altMeters,
      groundHeightMeters: statusHud.needsGroundHeight() ? resolveSurfaceHeightMeters(latRad * RAD_TO_DEG, lonRad * RAD_TO_DEG) : null,
      heightDatum: surfaceHeightDatum(runtime.status.mode),
    };
  };
  const northButton: NorthButtonHandle | null = northBtnSvgEl ? createNorthButton(northBtnSvgEl) : null;
  cleanup.push(() => northButton?.destroy());
  const helpModal: HelpModalHandle | null = helpModalEl ? createHelpModal(helpModalEl) : null;
  cleanup.push(() => helpModal?.destroy());

  let visiblePerformanceMetrics = readVisiblePerformanceMetrics();
  let lastPerfSnapshot: PerformanceSnapshot | null = null;

  // ── Debug panels ──────────────────────────────────────────────
  const spriteTuner = extraPanelsGridEl
    ? createPoiSpriteSizeTuner(extraPanelsGridEl, (params) => {
        options.onPoiSpriteSizeChange?.(params);
        runtime.requestRender();
      }, { document, settings })
    : null;
  cleanup.push(() => spriteTuner?.destroy());
  const compassScaleTuner = extraPanelsGridEl
    ? createCompassScaleTuner(extraPanelsGridEl, (params) => {
        orbitCompass.setScaleParams(params);
        options.onCompassScaleChange?.(params);
        runtime.requestRender();
      }, { document, settings })
    : null;
  cleanup.push(() => compassScaleTuner?.destroy());
  const showTuners = (): void => {
    if (disposed) return;
    if (settings.get("interface.poiSpriteTuner") === true) spriteTuner?.show(); else spriteTuner?.hide();
    if (settings.get("interface.compassScaleTuner") === true) compassScaleTuner?.show(); else compassScaleTuner?.hide();
  };
  showTuners();

  const inputModeHud: InputModeHudHandle | null = rendererModePill
    ? createInputModeHud(rootElement, rendererModePill, {
        document, settings, log: console,
        deviceHints: { platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints, coarsePointer: matchMedia("(pointer: coarse)").matches, finePointer: matchMedia("(pointer: fine)").matches },
        onModeChange: (mode) => runtime.setInputMode?.(mode),
        onSensitivityChange: (sensitivity) => runtime.setInputSensitivity?.(sensitivity),
        onToggle: () => toggleTab("controls"),
      })
    : null;

  const onRendererPillClick = (): void => toggleTab("renderer");
  cleanup.push(() => inputModeHud?.destroy());
  const onStatusClick = (): void => {
    if (showingPanoramaPosition) options.overlayApiRef?.current?.openOrSelectTab("panorama");
    else toggleTab("location");
  };
  const onBugReportClick = (): void => toggleTab("bug-report");
  rendererModePill?.addEventListener("click", onRendererPillClick);
  hudStatusEl?.addEventListener("click", onStatusClick);
  bugReportBtnEl?.addEventListener("click", onBugReportClick);
  cleanup.push(() => rendererModePill?.removeEventListener("click", onRendererPillClick),
    () => hudStatusEl?.removeEventListener("click", onStatusClick),
    () => bugReportBtnEl?.removeEventListener("click", onBugReportClick));

  // The app follows its parameters wherever they are changed: their sections,
  // Show all parameters, an import or another tab.
  const hudButtonElements: Record<HudButtonId, HTMLElement | null> = {
    help: helpBtnEl,
    renderer: rendererModePill,
    settings: settingsBtnEl,
    bugReport: bugReportBtnEl,
    theme: themeBtnEl,
    inputMode: rootElement.querySelector<HTMLElement>(".input-mode-control"),
    position: hudStatusEl,
    fullscreen: fullscreenBtnEl,
  };
  // Setting visibility and scene visibility are independent of automatic fit.
  const applyHudButtonVisibility = (): void => {
    for (const id of HUD_BUTTON_IDS) {
      const element = hudButtonElements[id];
      if (element) element.toggleAttribute("data-hud-choice-hidden", !readHudPreference(hudButtonParameterId(id)).wanted);
    }
  };
  applyHudButtonVisibility();
  const fittingIds = new Set([
    MAP_SOURCE_HUD_LAYOUT_ID,
    TOOLBAR_EDIT_PRIORITIES_ID,
    ...HUD_BUTTON_IDS.map(hudButtonParameterId),
    ...PERFORMANCE_HUD_METRICS.map(([metric]) => `interface.performanceHud.${metric}`),
    ...TOOLBAR_PRIORITIES.map(([item]) => toolbarPriorityParameterId(item)),
  ]);
  const hudFit = mapSourceSlot ? fitHudBar(hudBar.element, mapSourceSlot, () => {
    const customPriorities = settings.get(TOOLBAR_EDIT_PRIORITIES_ID) === true;
    const items = TOOLBAR_PRIORITIES.flatMap(([item, , defaultPriority]): HudBarFitItem[] => {
      const priority = customPriorities ? settings.get<number>(toolbarPriorityParameterId(item)) : defaultPriority;
      if (item === "north") return northBtnEl ? [{ element: northBtnEl, priority, keepVisible: true, reserveSpace: true, essential: true }] : [];
      const button = HUD_BUTTON_IDS.find(id => id === item);
      const element = button ? hudButtonElements[button]
        : perfMetricsPill?.querySelector<HTMLElement>(`[data-perf-metric="${item}"]`);
      const id = button ? hudButtonParameterId(button) : `interface.performanceHud.${item}`;
      const { wanted, pinned } = readHudPreference(id);
      return element && wanted ? [{ element, priority, keepVisible: pinned }] : [];
    });
    // Reserve the first two available controls after North (Help and Input by
    // default). Pinning one keeps the same core; Custom priorities change it.
    const core = items.filter(item => !item.reserveSpace && !item.element.closest("[hidden]"))
      .sort((a, b) => a.priority - b.priority);
    for (const item of core.slice(0, 2)) item.reserveSpace = true;
    return items;
  }, browserHudBarLayoutPorts(window)) : null;
  const applyCompassHeight = (): void => {
    const meters = compassHeightOffset();
    anchorHeights.setHeightOffset(meters);
    runtime.configureOrbitTargetHeight({
      resolveSurfaceHeightMeters: anchorHeights.resolveHeight,
      initialOffsetMeters: meters,
    });
  };
  cleanup.push(() => hudFit?.destroy());
  const stopWatchingSettings: (() => void)[] = [];
  cleanup.push(() => attemptEarthCleanup(stopWatchingSettings, "Earth settings subscriptions cleanup failed."));
  // Register each successful subscription before constructing the next one.
  const retainSettingsRelease = (release: () => void): void => { stopWatchingSettings.push(release); };
    // What automatic adjustment did, and why, goes in the log as it happens.
  retainSettingsRelease(connectMapDetailLog(runtime, gameLog));
  retainSettingsRelease(settings.watch(MAP_SOURCE_HUD_LAYOUT_ID, value => {
    mapSourceHud?.setLayout(value === "expanded" ? "expanded" : "compact");
    hudFit?.update();
  }));
  retainSettingsRelease(settings.subscribe(changed => {
      if (![...changed].some(id => fittingIds.has(id))) return;
      // On pins the chip, Auto fits it by priority, and Off removes it.
      applyHudButtonVisibility();
      visiblePerformanceMetrics = readVisiblePerformanceMetrics();
      if (lastPerfSnapshot && perfMetricsPill) renderPerformanceChips(perfMetricsPill, lastPerfSnapshot, visiblePerformanceMetrics);
      hudFit?.update();
  }));
  retainSettingsRelease(settings.watch("interface.poiSpriteTuner", showTuners));
  retainSettingsRelease(settings.watch("interface.compassScaleTuner", showTuners));
  retainSettingsRelease(settings.watch("visualization.compass.heightOffset", applyCompassHeight));
  for (const id of ["camera.surfaceFollowSpeed", "camera.surfaceRetry"]) {
    retainSettingsRelease(settings.watch(id, () => anchorHeights.setTuning(anchorTuning())));
  }
  retainSettingsRelease(settings.watch("input.globeAnchorRotation", value => runtime.setGlobeAnchorRotation?.(value === true)));
  for (const id of INPUT_SENSITIVITY_IDS) {
    retainSettingsRelease(settings.watch(id, () => runtime.setInputSensitivity?.(loadInputSensitivityPreference(settings))));
  }

  const resetNorth = (): void => {
    poiTracking.exitTracking();
    runtime.setViewState({ headingDeg: 0, pitchDeg: MAX_PITCH_DEG });
  };
  northBtnEl?.addEventListener("click", resetNorth);
  cleanup.push(() => northBtnEl?.removeEventListener("click", resetNorth));

  const gamepadSource = createBrowserInputSource({ target: window });
  cleanup.push(() => gamepadSource.dispose());
  // A navigation lease, such as an entered panorama, selects its own controller context.
  const gamepadAdapter = createGlobeGamepadAdapter(runtime, {
    onResetNorth: resetNorth,
    featureActions: PANORAMA_GAMEPAD_ACTIONS,
    getContext: () => runtime.getNavigationState()?.inputContext ?? "globe",
  });
  // The lease owns the camera: a tracked point must not move it meanwhile.
  const offNavigationChange = runtime.onNavigationChange(state => poiTracking.setSuspended(state !== null));
  cleanup.push(offNavigationChange);
  const selectedGamepadSlot = (): number => gamepadSource.getSelectedDevice()?.slot ?? 0;
  const stickDeadzone = (): number => settings.get<number>("input.gamepad.deadzone");
  const panoramaProfile = createPanoramaProfileContribution(DEFAULT_BINDING_TRANSFORM);
  const gamepadRuntime = new BindingRuntime({
    adapter: gamepadAdapter,
    profile: createStandardGlobeProfile(selectedGamepadSlot(), stickDeadzone(), panoramaProfile),
  });
  // Every stick bound to a navigation rate, the standard one or the user's own, takes the deadzone.
  cleanup.push(() => gamepadRuntime.dispose());
  stopWatchingSettings.push(settings.watch("input.gamepad.deadzone", () => {
    gamepadRuntime.setProfile(withStickDeadzone(gamepadRuntime.getProfile(), stickDeadzone()));
  }));
  const gamepadStore = createProfileStore();
  const offGamepadFrame = gamepadSource.subscribe((frame) => gamepadRuntime.dispatch(frame));
  cleanup.push(offGamepadFrame);
  const stopGamepadSource = gamepadSource.start({ intervalMs: 33 });
  cleanup.push(stopGamepadSource);
  // Controller bindings live in the Controls tab, mounted once and kept, so a
  // rebinding in progress survives closing the tab.
  const controllerSectionEl = rootElement.querySelector<HTMLElement>("#controlsControllerSection");
  const gamepadEditor: BindingEditorHandle | null = controllerSectionEl
    ? mountBindingEditor({
        root: controllerSectionEl,
        runtime: gamepadRuntime,
        source: gamepadSource,
        store: gamepadStore,
        builtInProfiles: [
          {
            id: "standard",
            label: STANDARD_GLOBE_PROFILE_NAME,
            create: () => createStandardGlobeProfile(selectedGamepadSlot(), stickDeadzone(), panoramaProfile),
          },
        ],
      })
    : null;
  const openControllerBindings = (): void => options.overlayApiRef?.current?.openOrSelectTab("controls");
  cleanup.push(() => gamepadEditor?.destroy());

  const inputMethodSectionEl = rootElement.querySelector<HTMLElement>("#controlsInputMethodSection");
  const unmountInlineInputMode = inputMethodSectionEl ? inputModeHud?.mountInline(inputMethodSectionEl) : undefined;
  cleanup.push(() => unmountInlineInputMode?.());

  // ── Settings and Controls tabs ───────────────────────────────
  // Each section draws its parameters' controls and, under Show all
  // parameters, every parameter homed in it.
  const parameterSections: ParameterSectionHandle[] = [];
  const parameterControls: ParameterControlHandle[] = [];
  cleanup.push(() => attemptEarthCleanup(parameterSections.map(section => () => section.destroy()), "Earth parameter sections cleanup failed."),
    () => attemptEarthCleanup(parameterControls.map(control => () => control.destroy()), "Earth parameter controls cleanup failed."));
  const sectionOf = (tab: string, section: string, extra: Omit<Parameters<typeof createParameterSection>[1], "tab" | "section" | "document" | "refresh" | "panelStorage"> = {}): HTMLElement => {
    const handle = ui.parameterSection({ tab, section, ...extra });
    parameterSections.push(handle);
    return handle.element;
  };
  const note = (text: string): HTMLElement => {
    const line = document.createElement("p");
    line.className = "settings-line";
    line.textContent = text;
    return line;
  };
  const group = (heading: string, ids: readonly string[]): HTMLElement => {
    const element = document.createElement("div");
    element.className = "settings-metric-menu";
    const title = document.createElement("div");
    title.className = "settings-section-title";
    title.textContent = heading;
    element.append(title);
    for (const id of ids) {
      const control = createParameterControl(settings, id, document);
      parameterControls.push(control);
      element.append(control.element);
    }
    return element;
  };
  const performanceMain = document.createElement("div");
  performanceMain.className = "settings-section-content";
  // The frame budget lives here, the one home of its profiling parameters.
  if (!settings.has(FRAME_PROFILING_IDS.enabled)) settings.register(frameProfilingParameters({ tab: "renderer", section: "performance" }));

  const frameBudget = createFrameBudgetPanel({
    ui: { document, createParameterControl: ui.control }, refreshPort: ui.refresh,
    actions: { copy, saveJson(name, text) { const url = URL.createObjectURL(new Blob([text], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url); }, onError: error => console.error(error) },
    session: runtime.frameProfile,
    settings,
    unmeasured: "work nobody has timed yet, the browser's own, and waiting for the display",
    readings: ["scene.panorama.sourceGpuMiB", "scene.panorama.decodedMiB", "scene.panorama.encodedMiB"],
    traceFileName: "foss-earth-frame-trace",
  });
  const frameBudgetGroup = document.createElement("div");
  cleanup.push(() => frameBudget.destroy());
  frameBudgetGroup.className = "settings-metric-menu";
  const frameBudgetTitle = document.createElement("div");
  frameBudgetTitle.className = "settings-section-title";
  frameBudgetTitle.textContent = "Frame budget";
  frameBudgetGroup.append(frameBudgetTitle, frameBudget.element);
  performanceMain.append(
    group("Extra panels", ["interface.poiSpriteTuner", "interface.compassScaleTuner"]),
    frameBudgetGroup,
  );
  const presets = createPresetsSection(settings, document);
  cleanup.push(() => presets.destroy());
  const savedSettings = createSavedSettingsSection(settings, document);
  cleanup.push(() => savedSettings.destroy());
  // The app's own files, kept by its service worker as Settings → App files asks.
  const appFiles = keepAppFiles(settings);
  cleanup.push(() => appFiles.dispose());
  const appFilesSection = createAppFilesSection(appFiles, publishedVersion, ui.refresh, document);
  cleanup.push(() => appFilesSection.destroy());
  diagnostics.addState(async () => `App files: ${describeAppFiles(await appFiles.status())}`);
  const diagnosticsSource = {
    report: () => diagnostics.report({ allSettings: true }),
    previous: () => diagnostics.previous(),
    reportSecrets: () => reportSecrets(settings),
    copy,
  };
  const diagnosticsSection = createDiagnosticsSection(diagnosticsSource, { document });
  cleanup.push(() => diagnosticsSection.destroy());
  const bugReportPanel = createBugReportPanel(diagnosticsSource, { document, now: () => new Date(), downloads: browserReportDownloads(URL), issueReporter: options.issueReporter ?? issueReporterFromBuild() });
  cleanup.push(() => bugReportPanel.destroy());
  const inputMethodElement = inputMethodSectionEl
    ? sectionOf("controls", "input-method", { main: inputMethodSectionEl, covers: ["input.mode", ...INPUT_SENSITIVITY_IDS] })
    : null;
  // Its own tab, under +, where someone looking for which version runs looks for it.
  const aboutShown = new Set<() => void>();
  const about = createAboutPanel({ publishedVersion, site: typeof __PAGES_REPOSITORY_SLUG__ === "string" ? __PAGES_REPOSITORY_SLUG__ : undefined,
    document, fetch: window.fetch.bind(window), createAbortController: () => new AbortController(),
    externalLinkIcon: () => createExternalLinkIcon(document),
    whenShown(_element, listener) { aboutShown.add(listener); return () => { aboutShown.delete(listener); }; },
  });
  // The input-method button lands here, so its section starts open.
  cleanup.push(() => about.dispose(), () => aboutShown.clear());
  // The session's pinned point, with Pick point, Pin compass target and Clear pin.
  const pinSection = runtime.navigationAnchors ? createNavigationAnchorPinSection({ document, anchors: runtime.navigationAnchors }) : null;
  if (pinSection) cleanup.push(() => pinSection.destroy());
  const controlsSections: PanelSection[] = [
    ...(inputMethodElement ? [{ id: "input-method", title: "Input method", element: inputMethodElement, defaultOpen: true }] : []),
    { id: "camera", title: settings.getSectionTitle("controls", "camera"), element: sectionOf("controls", "camera", {
      footer: note("Tilt: 0\u00B0 looks at the horizon, 90\u00B0 straight down."),
    }), defaultOpen: false },
    { id: "orbit", title: settings.getSectionTitle("controls", "orbit"), element: sectionOf("controls", "orbit", pinSection ? { footer: pinSection.element } : {}), defaultOpen: false },
    { id: "mouse", title: settings.getSectionTitle("controls", "mouse"), element: sectionOf("controls", "mouse"), defaultOpen: false },
    { id: "touch", title: settings.getSectionTitle("controls", "touch"), element: sectionOf("controls", "touch"), defaultOpen: false },
    { id: "controller", title: settings.getSectionTitle("controls", "controller"),
      element: sectionOf("controls", "controller", { main: controllerSectionEl ?? undefined }), defaultOpen: false },
  ];
  const themeControl = createThemeControl(settings, document);
  parameterControls.push(themeControl);
  const interfaceLead = document.createElement("div");
  interfaceLead.append(
    sectionOf("interface", "theme", { main: themeControl.element, covers: ["interface.theme"] }),
    sectionOf("interface", "windows"),
  );
  const toolbarSection = createToolbarInterfaceSection(settings, { document, refresh: ui.refresh, panelStorage: ui.storage, createParameterSection });
  parameterSections.push(toolbarSection);
  const positionSection = createPositionInterfaceSection(settings, { document, refresh: ui.refresh, panelStorage: ui.storage, createParameterSection });
  parameterSections.push(positionSection);
  const interfaceSections: PanelSection[] = [
    { id: "toolbar", title: settings.getSectionTitle("interface", "toolbar"), element: toolbarSection.element, defaultOpen: false },
    { id: "position", title: settings.getSectionTitle("interface", "position"), element: positionSection.element, defaultOpen: false },
    { id: "log", title: settings.getSectionTitle("interface", "log"), element: sectionOf("interface", "log"), defaultOpen: false },
  ];
  const locationSearchSection: PanelSection = {
    id: "search", title: settings.getSectionTitle("location", "search"), element: sectionOf("location", "search"), defaultOpen: false,
  };
  const settingsSections: PanelSection[] = [
    { id: "presets", title: "Presets", element: presets.element, defaultOpen: false },
    { id: "saved-settings", title: "Saved settings", element: savedSettings.element, defaultOpen: false },
    { id: "app-files", title: settings.getSectionTitle("settings", "app-files"), element: sectionOf("settings", "app-files", { footer: appFilesSection.element }), defaultOpen: false },
    { id: "diagnostics", title: settings.getSectionTitle("settings", "diagnostics"), element: sectionOf("settings", "diagnostics", { footer: diagnosticsSection.element }), defaultOpen: false },
  ];
  // Performance debug is about what the renderer does, so it is the Renderer tab's.
  const rendererPanel = createRendererPanel({
    ui: ui.renderer,
    renderer: runtime.renderer,
    onChange: force => applyRendererChoice(force, settings, window.location, { getItem: key => window.localStorage.getItem(key), setItem: (key, value) => window.localStorage.setItem(key, value), removeItem: key => window.localStorage.removeItem(key) }),
    settings,
    sections: [{
      id: "performance",
      title: settings.getSectionTitle("renderer", "performance"),
      element: sectionOf("renderer", "performance", {
        main: performanceMain,
        covers: ["interface.poiSpriteTuner", "interface.compassScaleTuner", ...Object.values(FRAME_PROFILING_IDS)],
      }),
    }],
  });
  // The sky is seen from the camera once its model is on; until then the Sun and its times of day are the view's place's.
  const skyPlace = () => runtime.sky.getEnvironment()?.illumination.observer ?? runtime.getViewState();
  cleanup.push(() => rendererPanel.destroy());
  const skyPanel = createSkyPanel({ document, ui: ui.publicUi, refresh: ui.refresh, panelStorage: ui.storage, now: Date.now, settings, getPlace: skyPlace, openDateTime: () => options.overlayApiRef?.current?.openOrSelectTab("time") });
  cleanup.push(() => skyPanel.destroy());
  const dev = createEarthDevHost(window.location.search, { document, runtime, broker: browser.broker, refresh: ui.refresh }, options.devContributions);
  cleanup.push(() => dev.dispose());
  const timePanel = createDateTimePanel({ document, ui: ui.publicUi, refresh: ui.refresh, panelStorage: ui.storage, now: Date.now, settings, getPlace: skyPlace });
  cleanup.push(() => timePanel.destroy());
  // Scenes: one mounted at a time; `?scene=<id>` loads one the app offers, else the host's initial scene.
  const appBaseUrl = new URL(import.meta.env.BASE_URL ?? "/", window.location.href).href;
  const params = new URLSearchParams(window.location.search);
  const panoramaTest = params.get("panoramaTest") === "1";
  const sceneHost = createEarthSceneHost({
    browser, settings, canvas, ui, readinessPolicy: browserPolicy.readinessPolicy,
    examples: options.scenes ?? SCENE_EXAMPLES,
    baseUrl: appBaseUrl,
    openSettings: () => options.overlayApiRef?.current?.openOrSelectTab("panorama-settings"),
  });
  const sceneFrame = createEarthFeatureFramePreparation({ viewer: sceneHost.viewer,
    isCurrent: sceneHost.isCurrent, requestRender: runtime.requestRender });
  prepareSceneFrame = frame => sceneFrame.prepare(frame);
  cleanup.push(() => { prepareSceneFrame = null; sceneHost.dispose(); });
  const scenes = sceneHost.controller;
  const scenesPanel = sceneHost.panel;
  const offSceneLog = connectSceneLog(scenes, gameLog);
  cleanup.push(offSceneLog);
  const offSceneTrail = scenes.subscribe(state => diagnostics.sceneChanged(state));
  cleanup.push(offSceneTrail);
  const panoramaTabs = sceneHost.tabs;
  // While a panorama is entered, its credit takes the map's place at the bar's right end.
  const sceneHud = mapSourceSlot ? createSceneHud({ controller: scenes, container: mapSourceSlot, mapSource: mapSourceHud?.element, createExternalLinkIcon }) : null;
  const requestedScene = params.get("scene") ?? options.initialScene;
  cleanup.push(() => sceneHud?.destroy());
  if (requestedScene) void scenes.load(requestedScene, { exampleId: true });
  if (panoramaTest) {
    window.__fossEarthPanoramaTest = {
      runtime,
      scenes,
      get renderer() { return sceneHost.renderer; },
      settings,
      math: { ...panoramaMath, effectiveOrbRadius },
      media: sceneHost.media,
      diagnostics,
      publishedVersion,
    };
  }
  cleanup.push(() => { if (window.__fossEarthPanoramaTest?.scenes === scenes) delete window.__fossEarthPanoramaTest; });

  void gamepadStore.listProfileIds("foss-earth").then(async (ids) => {
    if (disposed) return;
    const stored = ids.length > 0 ? await gamepadStore.loadProfile("foss-earth", ids[0]) : null;
    if (disposed || !stored || stored.hostNamespace !== "foss-earth") {
      return;
    }
    gamepadRuntime.setProfile(withStickDeadzone(stored, stickDeadzone()));
    if (stored.selectedDeviceSlot !== undefined || stored.selectedDeviceSessionId !== undefined) {
      gamepadSource.selectDevice({
        slot: stored.selectedDeviceSlot,
        sessionId: stored.selectedDeviceSessionId,
      });
    }
  }).catch(error => { if (!disposed) console.error("Loading controller profile failed.", error); });
  helpBtnEl?.addEventListener("click", () => helpModal?.show());
  const onSettingsButtonClick = (): void => toggleTab("settings");
  settingsBtnEl?.addEventListener("click", onSettingsButtonClick);
  cleanup.push(() => settingsBtnEl?.removeEventListener("click", onSettingsButtonClick));

  // ── Theme button ────────────────────────────────────────────
  // Shows sun in dark mode (click to go light), moon in light mode (click to go dark).
  function syncThemeButton(theme: "light" | "dark"): void {
    if (themeBtnIconEl) themeBtnIconEl.textContent = theme === "dark" ? "\u263C" : "\u263E";
    if (themeBtnEl) {
      const nextLabel = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
      themeBtnEl.title = nextLabel;
      themeBtnEl.setAttribute("aria-label", nextLabel);
    }
  }
  syncThemeButton(getTheme());
  const onThemeButtonClick = (): void => { toggleTheme(); };
  themeBtnEl?.addEventListener("click", onThemeButtonClick);
  cleanup.push(() => themeBtnEl?.removeEventListener("click", onThemeButtonClick));
  // Theme changes can update scene-side colors (fallback clear color, etc.);
  // pump a frame whenever the theme flips for either tab-local or cross-tab events.
  const offThemeChangeForButton = onThemeChange((next) => {
    syncThemeButton(next);
    runtime.requestRender();
  });
  cleanup.push(offThemeChangeForButton);
  poiExitBtnEl?.addEventListener("click", (e) => {
    e.stopPropagation();
    poiTracking.exitTracking();
    runtime.requestRender();
  });

  // Update HUD every frame while the scene is running
  let hudObserver: ReturnType<typeof runtime.scene.onBeforeRenderObservable.add> | null = null;
  // Track last known POI-tracking state so we only call setOrbitMode on
  // transitions, never every frame. Calling setOrbitMode every frame would
  // stomp over external orbit-mode requests (e.g. from PropertyEarthMap's own
  // trackedPoint state), since poiTracking.isTracking() returns false for
  // external trackers and would reset orbitModeActive to false immediately.
  let lastPoiTrackingActive = false;
  hudObserver = runtime.scene.onBeforeRenderObservable.add(() => {
    const state = runtime.getViewState();
    mapSourceHud?.update(runtime.status);
    const sceneStatus = scenes.state().status;
    const capture = sceneStatus?.active && sceneStatus.view
      ? sceneStatus.entries.find(entry => entry.id === sceneStatus.active)?.capture
      : null;
    showPositionContext(Boolean(capture));
    if (capture && sceneStatus?.view) {
      // Capture coordinates stay fixed while the viewer's geographic look changes.
      // Marker placement is only a displayed orb position, not a capture height.
      statusHud?.update({
        latDeg: capture.latitudeDeg,
        lonDeg: capture.longitudeDeg,
        ...sceneStatus.view,
      }, {
        altitudeMeters: capture.heightMeters,
        groundHeightMeters: capture.heightMeters !== null && statusHud.needsGroundHeight()
          ? resolveSurfaceHeightMeters(capture.latitudeDeg, capture.longitudeDeg) : null,
        heightDatum: "ellipsoid",
        groundHeightDatum: surfaceHeightDatum(runtime.status.mode),
      });
      northButton?.update(sceneStatus.view.headingDeg);
    } else if (state) {
      statusHud?.update(state, cameraAltitude());
      northButton?.update(state.headingDeg);
    }
    const camera = runtime.geospatialCamera;
    const compassAnchor = anchorHeights.resolve(poiTracking.getOrbitTarget() ?? camera?.center ?? null);
    orbitCompass.update(compassAnchor, state?.zoomMeters ?? camera?.radius ?? 0);
    culling.update();
    const poiTrackingActive = poiTracking.isTracking();
    if (poiTrackingActive !== lastPoiTrackingActive) {
      lastPoiTrackingActive = poiTrackingActive;
      runtime.setOrbitMode(poiTrackingActive);
    }

    // ── POI exit button: project orbit target to screen space ─────
    if (poiExitBtnEl) {
      const orbitTarget = poiTracking.getOrbitTarget();
      const poiCamera = runtime.geospatialCamera;
      const poiEngine = runtime.engine;
      const poiCanvas = poiEngine.getRenderingCanvas();
      if (orbitTarget && poiCamera && poiCanvas) {
        const txMatrix = runtime.scene.getTransformMatrix();
        const vp = poiCamera.viewport.toGlobal(
          poiEngine.getRenderWidth(),
          poiEngine.getRenderHeight(),
        );
        const sp = Vector3.Project(orbitTarget, Matrix.IdentityReadOnly, txMatrix, vp);
        if (sp.z > 0 && sp.z < 1) {
          const rect = poiCanvas.getBoundingClientRect();
          const scaleX = rect.width / poiEngine.getRenderWidth();
          const scaleY = rect.height / poiEngine.getRenderHeight();
          poiExitBtnEl.hidden = false;
          poiExitBtnEl.style.left = `${rect.left + sp.x * scaleX + POI_EXIT_BTN_OFFSET_PX}px`;
          poiExitBtnEl.style.top = `${rect.top + sp.y * scaleY - POI_EXIT_BTN_OFFSET_PX}px`;
        } else {
          poiExitBtnEl.hidden = true;
        }
      } else {
        poiExitBtnEl.hidden = true;
      }
    }
    const perfSnapshot = performanceMetrics.update();
    lastPerfSnapshot = perfSnapshot;
    if (perfMetricsPill) {
      renderPerformanceChips(perfMetricsPill, perfSnapshot, visiblePerformanceMetrics);
    }
  });

  cleanup.push(() => { if (hudObserver) runtime.scene.onBeforeRenderObservable.remove(hudObserver); hudObserver = null; });
  console.info(
    `[app] runtime initialized renderer=${runtime.renderer.mode} mode=${runtime.status.mode} googleApiKeyProvided=${runtime.status.googleApiKeyProvided}`,
  );

  // Visual feedback for render-on-demand state (the map source HUD shows tile
  // streaming itself):
  // - .is-rendering on the renderer chip while the scheduler is pumping frames
  // - .is-active on the perf metrics group at the same time (drives the FPS
  //   chip's green tint)
  const offRendererActivity = rendererModePill ? attachRendererActivity(rendererModePill, runtime) : () => {};
  cleanup.push(offRendererActivity);
  const offRenderActive = runtime.onActiveRenderChange((active) => {
    perfMetricsPill?.classList.toggle("is-active", active);
  });
  cleanup.push(offRenderActive);
  if (runtime.isRendering()) {
    perfMetricsPill?.classList.add("is-active");
  }

  return {
    runtime,
    inputModeHud,
    openControllerBindings,
    controlsSections,
    interfaceSections,
    interfaceLead,
    locationSearchSection,
    settingsSections,
    aboutTab: about.element,
    bugReportTab: bugReportPanel.element,
    onBugReportShow: () => bugReportPanel.show(),
    mapTab: mapPanel.element,
    rendererTab: rendererPanel.element,
    skyTab: skyPanel.element,
    timeTab: timePanel.element,
    scenesTab: scenesPanel.element,
    panoramaTabs,
    scenes,
    get devTab() { return dev.tab; },
    onTabVisibility(tabId, visible) {
      if (tabId === "dev") dev.tab?.onOpenChange(visible);
      if (tabId === "about" && visible) for (const listener of [...aboutShown]) listener();
      if (tabId === "location") {
        locationTabOpen = visible;
        syncPositionEditing();
      }
    },
    whenDevSettled: () => dev.whenSettled(),
    addLayer,
    removeLayer,
    getViewState(): GlobeViewState | null {
      return runtime.getViewState();
    },
    setViewState(partial: Partial<GlobeViewState>): void {
      runtime.setViewState(partial);
    },
    getTheme,
    setTheme,
    onThemeChange,
    requestRender(): void {
      runtime.requestRender();
    },
    destroy: disposeApp,
  };
  } catch (error) {
    try { disposeApp(); }
    catch (release) { throw new AggregateError([error, release], "Earth application startup failed."); }
    throw error;
  }
}
