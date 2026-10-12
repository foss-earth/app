/** Earth tab composition. Shared UI owns docking, persistence and context lifecycle. */
import { useCallback, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { WindowOverlay as SharedWindowOverlay, AdoptedElement, SectionsPanel, type PanelSection } from "@foss-earth/ui/react";
import { browserOverlayGeometry, browserOverlayLayout } from "@foss-earth/ui/browser";
import type { WindowTabDefinition, WindowOverlayLogSize } from "@foss-earth/ui/windowing";
import type { SettingsRegistry, SettingsStorage } from "@foss-earth/ui/settings";
import { createLocationDraftStore, LOCATION_PLACE_DRAFT_KEY, type LocationDraftStore, type GeodeticLocation, type LocationSearchProvider, type LocationHostDataCodec } from "@foss-earth/engine";
import { LocationPanel, type LocationPanelContribution } from "@foss-earth/engine/react";
import { bindEarthLocationServices, createEarthLocationServices } from "../app/locationServices";
import { getAppSettings } from "../settings/appSettings";
import { GAME_LOG_SIZE_EVENT, type GameLogSizeChange } from "@foss-earth/ui/browser";
import type { ViewerTabs as PanoramaTabs, ViewerTabsSnapshot as PanoramaTabsSnapshot } from "@foss-earth/360/panels";

type SectionTabId = "controls" | "interface" | "settings";
type ElementTabId = "map" | "renderer" | "sky" | "time" | "scenes" | "about" | "bug-report" | "panorama" | "panorama-settings";
type BuiltInTabId = "location" | SectionTabId | ElementTabId;
const HIDDEN_IN_PANORAMA: ReadonlySet<string> = new Set(["map", "sky", "time"]);
const PANORAMA_ONLY: ReadonlySet<string> = new Set(["panorama", "panorama-settings"]);
const OUTSIDE_PANORAMA: PanoramaTabsSnapshot = { title: null, onScreen: false };
const DEFAULT_LOCATION: GeodeticLocation = { latDeg: 44.977753, lonDeg: -93.265011 };

function currentLocation(getViewState: () => GeodeticLocation | null): GeodeticLocation {
  const view = getViewState();
  return view ? { latDeg: view.latDeg, lonDeg: view.lonDeg, ...(view.zoomMeters === undefined ? {} : { zoomMeters: view.zoomMeters }), ...(view.altMeters === undefined ? {} : { altMeters: view.altMeters }) } : DEFAULT_LOCATION;
}
function browserStorage(): SettingsStorage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}
/** Fit the photograph; the optional sections stay available in the scrollable body. */
function measurePanoramaPhotograph(body: HTMLElement): number | null {
  const photograph = body.querySelector<HTMLElement>(".foss-earth-panorama-photograph");
  const wrapper = photograph?.closest<HTMLElement>(".foss-earth-element-tab");
  if (!photograph || !wrapper) return null;
  const rect = photograph.getBoundingClientRect();
  if (rect.width <= 0) return null;
  const style = getComputedStyle(wrapper);
  const paddingTop = Number.parseFloat(style.paddingTop) || 0;
  const paddingBottom = Number.parseFloat(style.paddingBottom) || 0;
  const photographHeight = rect.bottom - body.getBoundingClientRect().top + body.scrollTop + paddingBottom;
  // Even an empty description needs enough scrolling space to show an optional section's heading.
  const summary = body.querySelector<HTMLElement>(".foss-earth-panorama-tab .foss-earth-panel-section__title");
  const minimumHeight = (summary?.getBoundingClientRect().height ?? 0) + paddingTop + paddingBottom;
  return Math.max(photographHeight, minimumHeight);
}
export interface WindowOverlayHandle<TabId extends string = never> {
  openOrSelectTab(tabId: BuiltInTabId | TabId): void;
  /**
   * What a toolbar button does: shows the tab, or closes it when it is already
   * the one showing.
   */
  toggleTab(tabId: BuiltInTabId | TabId): void;
}

export interface WindowOverlayProps<TabId extends string = never> {
  getViewState: () => GeodeticLocation | null;
  setViewState: (location: GeodeticLocation) => void;
  /** Hosts supply tab contents; the shared overlay owns both window slots. */
  additionalTabs?: readonly WindowTabDefinition<TabId>[];
  renderAdditionalTab?: (tabId: TabId) => ReactNode;
  /**
   * Adds the shared Controls tab, built from these collapsible sections. A host
   * that already supplies its own `controls` tab leaves this out.
   */
  controlsSections?: readonly PanelSection[];
  /** Adds the shared Settings tab, the same way. */
  settingsSections?: readonly PanelSection[];
  /** The toolbar, theme and what the interface shows, in an Interface tab. */
  interfaceSections?: readonly PanelSection[];
  /** Adds the shared Map tab showing this element, from `createMapSourcePanel`. */
  mapTab?: HTMLElement;
  /** Adds the shared Renderer tab showing this element, from `createRendererPanel`. */
  rendererTab?: HTMLElement;
  /** Adds the shared Sky tab showing this element, from `createSkyPanel`: where the Sun is, the atmosphere, the ground under it and exposure. */
  skyTab?: HTMLElement;
  /** Adds the shared Date and time tab showing this element, from `createDateTimePanel`: the dials that set the time the Sun is placed for. */
  timeTab?: HTMLElement;
  /** Adds the shared Scenes tab showing this element, from `createScenesPanel`. */
  scenesTab?: HTMLElement;
  /** Adds the shared About tab showing this element, from `createAboutPanel`: which version runs, and what it is built from. */
  aboutTab?: HTMLElement;
  /** The one Bug report tab, from `createBugReportPanel`; also available under +. */
  bugReportTab?: HTMLElement;
  /** Prepare a report when its tab becomes visible; hidden or minimized tabs do not call it. */
  onBugReportShow?: () => void;
  /**
   * A panorama's tabs, from `createPanoramaTabs`. Entering a panorama opens its
   * tab, titled "360: <title>", minimized while the camera flies in and shown
   * once the panorama is on screen; closing that tab leaves it. Inside one the
   * tabs about the map are hidden and 360 image settings is offered; each
   * comes back where it was when the context returns.
   */
  panoramaTabs?: PanoramaTabs;
  locationSearchProvider?: LocationSearchProvider;
  /** @deprecated The flight host supplies its own Location contribution. */
  enableAirportPresets?: boolean;
  locationContribution?: LocationPanelContribution;
  locationHostDataCodec?: LocationHostDataCodec;
  locationDraft?: LocationDraftStore;
  /** Existing host scene/view notification; mountGlobeApp supplies its one rendered-frame event. */
  observeLocation?: (listener: () => void) => () => void;
  settings?: SettingsRegistry;
  storage?: SettingsStorage | null;
  overlayApiRef?: { current: WindowOverlayHandle<TabId> | null };
  /** Return `false` to keep the tab open. */
  onBeforeCloseTab?: (tabId: BuiltInTabId | TabId) => boolean | void;
  onTabVisibility?: (tabId: BuiltInTabId | TabId, visible: boolean) => void;
}


export function WindowOverlay<TabId extends string = never>({
  getViewState, setViewState, additionalTabs = [], renderAdditionalTab,
  controlsSections, interfaceSections, settingsSections,
  mapTab, rendererTab, skyTab, timeTab, scenesTab, aboutTab, bugReportTab,
  onBugReportShow, panoramaTabs, locationSearchProvider,
  enableAirportPresets = false, locationContribution, locationHostDataCodec,
  locationDraft, observeLocation, settings: suppliedSettings, storage: suppliedStorage,
  overlayApiRef, onBeforeCloseTab, onTabVisibility,
}: WindowOverlayProps<TabId>) {
  type OverlayTabId = BuiltInTabId | TabId;
  if (enableAirportPresets && !locationContribution) {
    throw new Error("Airport presets require the flight host's Location contribution.");
  }
  const storage = useMemo(() => suppliedStorage === undefined ? browserStorage() : suppliedStorage, [suppliedStorage]);
  const lookup = useMemo(() => locationSearchProvider ? null : createEarthLocationServices(suppliedSettings ?? getAppSettings(), {
    storage, fetch: (url, init) => window.fetch(url, init), nowMs: Date.now,
    createAbortController: () => new AbortController(),
    timers: { setTimeout: (callback, delay) => window.setTimeout(callback, delay), clearTimeout: handle => window.clearTimeout(handle as number) },
  }), [locationSearchProvider, suppliedSettings, storage]);
  useEffect(() => {
    if (!lookup) return;
    const unbind = bindEarthLocationServices(lookup);
    return () => { unbind(); lookup.dispose(); };
  }, [lookup]);
  const draft = useMemo(() => locationDraft ?? createLocationDraftStore({ storage, key: LOCATION_PLACE_DRAFT_KEY, hostDataCodec: locationHostDataCodec }), [locationDraft, storage, locationHostDataCodec]);
  const observe = useCallback((listener: () => void) => {
    if (observeLocation) return observeLocation(listener);
    // Temporary old-signature compatibility. The Earth app supplies its frame event.
    const timer = window.setInterval(listener, 100);
    return () => window.clearInterval(timer);
  }, [observeLocation]);
  const subscribePanorama = useCallback((listener: () => void) => panoramaTabs?.subscribe(listener) ?? (() => {}), [panoramaTabs]);
  const getPanorama = useCallback(() => panoramaTabs?.getSnapshot() ?? OUTSIDE_PANORAMA, [panoramaTabs]);
  const panorama = useSyncExternalStore(subscribePanorama, getPanorama, getPanorama);
  const sectionTabs: Partial<Record<SectionTabId, readonly PanelSection[]>> = {
    ...(controlsSections ? { controls: controlsSections } : {}),
    ...(interfaceSections ? { interface: interfaceSections } : {}),
    ...(settingsSections ? { settings: settingsSections } : {}),
  };
  const elementTabs: Partial<Record<ElementTabId, HTMLElement>> = {
    ...(mapTab ? { map: mapTab } : {}), ...(rendererTab ? { renderer: rendererTab } : {}),
    ...(skyTab ? { sky: skyTab } : {}), ...(timeTab ? { time: timeTab } : {}),
    ...(scenesTab ? { scenes: scenesTab } : {}), ...(aboutTab ? { about: aboutTab } : {}),
    ...(bugReportTab ? { "bug-report": bugReportTab } : {}),
    ...(panoramaTabs ? { panorama: panoramaTabs.panorama, "panorama-settings": panoramaTabs.settings } : {}),
  };
  const sectionLabels: Record<SectionTabId, string> = { controls: "Controls", interface: "Interface", settings: "Settings" };
  const elementLabels: Record<ElementTabId, string> = {
    map: "Map", renderer: "Renderer", sky: "Sky", time: "Date and time", scenes: "Scenes", about: "About", "bug-report": "Bug report", panorama: panorama.title ?? "360", "panorama-settings": "360 image settings",
  };
  const sectionIds = (Object.keys(sectionLabels) as SectionTabId[]).filter(id => sectionTabs[id]);
  const elementIds = (Object.keys(elementLabels) as ElementTabId[]).filter(id => elementTabs[id]);
  const builtIn = new Set<string>(["location", ...sectionIds, ...elementIds]);
  const tabDefinitions: readonly WindowTabDefinition<OverlayTabId>[] = [
    { id: "location", label: "Location" },
    ...sectionIds.map(id => ({ id, label: sectionLabels[id] })),
    ...additionalTabs.filter(tab => !builtIn.has(tab.id)),
    ...elementIds.map(id => ({ id, label: elementLabels[id] })),
  ];
  const restorable = new Set(tabDefinitions.filter(tab => !PANORAMA_ONLY.has(tab.id) && tab.available !== false).map(tab => tab.id));
  const geometry = useMemo(() => browserOverlayGeometry(window, () => {
    const bar = document.querySelector(".hud-bar")?.getBoundingClientRect();
    return bar && bar.height > 0 ? bar.top : null;
  }), []);
  const layout = useMemo(() => browserOverlayLayout(document.documentElement), []);
  const logSize = useMemo<WindowOverlayLogSize>(() => ({
    getWidth() { const log = document.querySelector<HTMLElement>("#app-log[data-sized]"); return log ? Number.parseFloat(log.style.width) || null : null; },
    subscribe(listener) {
      const onSize = (event: Event): void => listener((event as CustomEvent<GameLogSizeChange>).detail);
      window.addEventListener(GAME_LOG_SIZE_EVENT, onSize);
      return () => window.removeEventListener(GAME_LOG_SIZE_EVENT, onSize);
    },
  }), []);
  return <><SharedWindowOverlay<OverlayTabId>
    tabDefinitions={tabDefinitions}
    storage={storage}
    geometry={geometry}
    logSize={logSize}
    layoutPort={layout}
    restorableTabs={restorable}
    context={{ active: panorama.title !== null, ready: panorama.onScreen, baseOnlyTabs: HIDDEN_IN_PANORAMA as ReadonlySet<OverlayTabId>, contextOnlyTabs: PANORAMA_ONLY as ReadonlySet<OverlayTabId>, entryTabId: "panorama", measureEntry: measurePanoramaPhotograph }}
    overlayApiRef={overlayApiRef}
    onBeforeCloseTab={onBeforeCloseTab}
    focus={{ onClose(tabId) { if (tabId === "panorama") panoramaTabs?.leave(); } }}
    onTabVisibility={(tabId, visible) => { if (visible && tabId === "bug-report") onBugReportShow?.(); onTabVisibility?.(tabId, visible); }}
    renderTabContent={tabId => {
      const sections = sectionTabs[tabId as SectionTabId];
      if (sections) return <SectionsPanel sections={sections} storage={storage} />;
      const element = elementTabs[tabId as ElementTabId];
      if (element) return <AdoptedElement element={element} className="foss-earth-element-tab" />;
      if (tabId !== "location") return renderAdditionalTab?.(tabId as TabId) ?? null;
      return <LocationPanel initialLocation={currentLocation(getViewState)} getCurrentLocation={getViewState} onApply={setViewState}
        searchProvider={locationSearchProvider ?? lookup?.searchLocations} observeLocation={observe} draft={draft}
        hostDataCodec={locationHostDataCodec} contribution={locationContribution} createAbortController={() => new AbortController()}
        searchAttribution={<span>Places: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>; airports: <a href="https://www.freeairportdb.com/" target="_blank" rel="noreferrer">FreeAirportDB</a></span>} />;
    }}
  />
    {panorama.onScreen && <button type="button" className="hud-chip hud-chip-button foss-earth-panorama-return" onClick={() => panoramaTabs?.leave()}>Return to map</button>}
  </>;
}
