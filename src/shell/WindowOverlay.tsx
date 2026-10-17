/** Earth tab composition. Shared UI owns docking, persistence and context lifecycle. */
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { WindowOverlay as SharedWindowOverlay, AdoptedElement, SectionsPanel, type PanelSection } from "@foss-earth/ui/react";
import { browserOverlayGeometry, browserOverlayLayout, createTabPresetSave } from "@foss-earth/ui/browser";
import type { WindowTabDefinition, WindowOverlayLogSize, WindowSlotId, WorkspaceSnapshotSource } from "@foss-earth/ui/windowing";
import type { SettingsRegistry, SettingsStorage } from "@foss-earth/ui/settings";
import { browserDeviceLocation, createLocationDraftStore, LOCATION_PLACE_DRAFT_KEY, type DeviceLocationFix, type LocationDraftStore, type GeodeticLocation, type LocationSearchProvider, type LocationHostDataCodec } from "@foss-earth/engine";
import { LocationPanel, type LocationPanelContribution } from "@foss-earth/engine/react";
import { bindEarthLocationServices, createEarthLocationServices } from "../app/locationServices";
import { getAppSettings } from "../settings/appSettings";
import { POSITION_ALTITUDE_ID, type AltitudeReference } from "../settings/catalogue";
import { WINDOWS_PRESENTATION_ID, WORLD_EDGES_ID, WORLD_RESIZE_ID } from "@foss-earth/ui/settings";
import { poseEditTitle, requestPoseEditStop, subscribePoseEditTitle } from "../app/poseEditor/poseEditTab";
type WorldPresentationChoice = "auto" | "overlay" | "split";
type WorldResize = "live" | "release";
import { GAME_LOG_SIZE_EVENT, type GameLogSizeChange } from "@foss-earth/ui/browser";
import type { ViewerTabs as SphereTabs, ViewerTabsSnapshot as SphereTabsSnapshot } from "@foss-earth/sphere-image/panels";

type SectionTabId = "controls" | "interface" | "settings";
type ElementTabId = "map" | "renderer" | "sky" | "time" | "scenes" | "vr" | "about" | "bug-report" | "browser-data" | "panorama" | "panorama-settings";
type BuiltInTabId = "location" | SectionTabId | ElementTabId;
const HIDDEN_IN_SPHERE: ReadonlySet<string> = new Set(["map", "sky", "time"]);
const SPHERE_ONLY: ReadonlySet<string> = new Set(["panorama", "panorama-settings"]);
/** On the map, editing a photograph shows its tab and keeps 360 image settings hidden. */
const SPHERE_SETTINGS_ONLY: ReadonlySet<string> = new Set(["panorama-settings"]);
const OUTSIDE_SPHERE: SphereTabsSnapshot = { title: null, onScreen: false };
const DEFAULT_LOCATION: GeodeticLocation = { latDeg: 44.977753, lonDeg: -93.265011 };

function subscribePositionReadout(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  const observe = (): void => {
    observer.disconnect();
    const chip = document.querySelector("#hudStatus");
    const bar = chip?.closest(".hud-bar") ?? document.querySelector(".hud-bar");
    if (chip) observer.observe(chip, { attributes: true, attributeFilter: ["hidden", "class", "style", "data-hud-overflow-hidden", "data-hud-choice-hidden"] });
    if (bar) observer.observe(bar, { attributes: true, attributeFilter: ["class", "hidden"] });
  };
  observe();
  window.addEventListener("resize", onChange);
  return () => {
    observer.disconnect();
    window.removeEventListener("resize", onChange);
  };
}

function subscribeLogTab(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-log-visible"] });
  return () => observer.disconnect();
}
/** The floating log is only the widest arrangement. Everywhere else it is a tab. */
function logTabShown(): boolean {
  return document.documentElement.dataset.logVisible === "false";
}

function positionReadoutShown(): boolean {
  const chip = document.querySelector<HTMLElement>("#hudStatus");
  if (!chip || chip.hidden || chip.hasAttribute("data-hud-choice-hidden") || chip.hasAttribute("data-hud-overflow-hidden")) return false;
  const style = getComputedStyle(chip);
  return style.display !== "none" && style.visibility !== "hidden";
}

function currentLocation(getViewState: () => GeodeticLocation | null): GeodeticLocation {
  const view = getViewState();
  return view ? { latDeg: view.latDeg, lonDeg: view.lonDeg, ...(view.zoomMeters === undefined ? {} : { zoomMeters: view.zoomMeters }), ...(view.altMeters === undefined ? {} : { altMeters: view.altMeters }) } : DEFAULT_LOCATION;
}
function browserStorage(): SettingsStorage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}
function TabPresetSave({ settings, tab, what }: { settings: SettingsRegistry; tab: string; what: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const save = createTabPresetSave(settings, tab, what, document);
    host.current?.replaceChildren(save.element);
    return () => save.destroy();
  }, [settings, tab, what]);
  return <div ref={host} className="foss-earth-tab-preset-host" />;
}

export interface WindowOverlayHandle<TabId extends string = never> {
  openOrSelectTab(tabId: BuiltInTabId | TabId): void;
  /**
   * What a toolbar button does: shows the tab, or closes it when it is already
   * the one showing.
   */
  toggleTab(tabId: BuiltInTabId | TabId): void;
  closeTab(tabId: BuiltInTabId | TabId): void;
  /**
   * Opens a tab on `slotId`'s side and selects it there, such as a document
   * opened from that side's +; a tab already open is selected where it is. A
   * tab added to `additionalTabs` in the same update opens once it arrives.
   */
  openTabInSlot(tabId: BuiltInTabId | TabId, slotId: WindowSlotId): void;
  /** What each side holds and shows, and the side the person last used. */
  readonly workspace: WorkspaceSnapshotSource<BuiltInTabId | TabId | "log">;
}

export interface WindowOverlayProps<TabId extends string = never> {
  getViewState: () => GeodeticLocation | null;
  setViewState: (location: GeodeticLocation) => void;
  /** Hosts supply tab contents; the shared overlay owns both window slots. */
  additionalTabs?: readonly WindowTabDefinition<TabId>[];
  renderAdditionalTab?: (tabId: TabId) => ReactNode;
  /**
   * The one body for two selected tabs of the same `surface.joinGroup`, one in
   * each window. It spans both columns and the space between them, under the
   * tab strips. While they are joined the log is a tab.
   */
  renderJoinedTabs?: (tabs: { left: TabId; right: TabId }) => ReactNode;
  /**
   * Adds the shared Controls tab, built from these collapsible sections. A host
   * that already supplies its own `controls` tab leaves this out.
   */
  controlsSections?: readonly PanelSection[];
  /** Adds the shared Settings tab, the same way. */
  settingsSections?: readonly PanelSection[];
  /** The toolbar, theme and what the interface shows, in an Interface tab. */
  interfaceSections?: readonly PanelSection[];
  /** Theme and window controls, drawn above the Interface tab's sections. */
  interfaceLead?: HTMLElement;
  /** Place-lookup limits, drawn under the Location form. */
  locationSearchSection?: PanelSection;
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
  /** Adds the VR tab showing this element: entering a headset session and its controls. */
  headsetTab?: HTMLElement;
  /** Adds the shared About tab showing this element, from `createAboutPanel`: which version runs, and what it is built from. */
  aboutTab?: HTMLElement;
  /** The one Bug report tab, from `createBugReportPanel`; also available under +. */
  bugReportTab?: HTMLElement;
  /** Review and clear the site's stored data, keeping API keys by default. */
  browserDataTab?: HTMLElement;
  /** Prepare a report when its tab becomes visible; hidden or minimized tabs do not call it. */
  onBugReportShow?: () => void;
  /**
   * A sphere's tabs, from `createSphereTabs`. Entering a sphere opens its
   * tab, titled with the image's title and marked with a sphere, when no tabs
   * remain on arrival. Existing tabs stay open during the flight; closing
   * that tab leaves it. Editing a photograph from the map opens the same tab
   * there, and closing it leaves editing. Tabs already open keep their
   * selection inside; the + menu offers 360 image settings and omits map-only
   * tabs until the map returns.
   */
  sphereTabs?: SphereTabs;
  locationSearchProvider?: LocationSearchProvider;
  /** A device fix while GPS is on, or null when it stops. The host draws the blue dot and accuracy disc. */
  onDeviceLocation?(fix: DeviceLocationFix | null): void;
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
  getViewState, setViewState, additionalTabs = [], renderAdditionalTab, renderJoinedTabs,
  controlsSections, interfaceSections, interfaceLead, settingsSections, locationSearchSection,
  mapTab, rendererTab, skyTab, timeTab, scenesTab, headsetTab, aboutTab, bugReportTab, browserDataTab,
  onBugReportShow, sphereTabs, locationSearchProvider, onDeviceLocation,
  enableAirportPresets = false, locationContribution, locationHostDataCodec,
  locationDraft, observeLocation, settings: suppliedSettings, storage: suppliedStorage,
  overlayApiRef, onBeforeCloseTab, onTabVisibility,
}: WindowOverlayProps<TabId>) {
  type OverlayTabId = BuiltInTabId | TabId | "log";
  if (enableAirportPresets && !locationContribution) {
    throw new Error("Airport presets require the flight host's Location contribution.");
  }
  const storage = useMemo(() => suppliedStorage === undefined ? browserStorage() : suppliedStorage, [suppliedStorage]);
  const settings = suppliedSettings ?? getAppSettings();
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
  const deviceLocation = useMemo(() => browserDeviceLocation(typeof navigator === "undefined" ? null : navigator.geolocation), []);
  const readoutShown = useSyncExternalStore(subscribePositionReadout, positionReadoutShown, () => false);
  const presentationChoice = useSyncExternalStore(
    (listener) => settings.has(WINDOWS_PRESENTATION_ID) ? settings.watch(WINDOWS_PRESENTATION_ID, () => listener()) : () => {},
    (): WorldPresentationChoice => settings.has(WINDOWS_PRESENTATION_ID) ? settings.get(WINDOWS_PRESENTATION_ID) : "overlay",
    (): WorldPresentationChoice => "overlay",
  );
  const worldResize = useSyncExternalStore(
    (listener) => settings.has(WORLD_RESIZE_ID) ? settings.watch(WORLD_RESIZE_ID, () => listener()) : () => {},
    (): WorldResize => settings.has(WORLD_RESIZE_ID) ? settings.get(WORLD_RESIZE_ID) : "release",
    (): WorldResize => "release",
  );
  const flushEdges = useSyncExternalStore(
    (listener) => settings.has(WORLD_EDGES_ID) ? settings.watch(WORLD_EDGES_ID, () => listener()) : () => {},
    () => settings.has(WORLD_EDGES_ID) ? settings.get<boolean>(WORLD_EDGES_ID) : true,
    () => true,
  );
  const logIsTab = useSyncExternalStore(subscribeLogTab, logTabShown, () => false);
  const altitudeReference = useSyncExternalStore<AltitudeReference>(
    (listener) => settings.has(POSITION_ALTITUDE_ID) ? settings.watch(POSITION_ALTITUDE_ID, () => listener()) : () => {},
    () => settings.has(POSITION_ALTITUDE_ID) ? settings.get<AltitudeReference>(POSITION_ALTITUDE_ID) : "asl",
    () => "asl",
  );
  const observe = useCallback((listener: () => void) => {
    if (observeLocation) return observeLocation(listener);
    // Temporary old-signature compatibility. The Earth app supplies its frame event.
    const timer = window.setInterval(listener, 100);
    return () => window.clearInterval(timer);
  }, [observeLocation]);
  const subscribeSphere = useCallback((listener: () => void) => sphereTabs?.subscribe(listener) ?? (() => {}), [sphereTabs]);
  const getSphere = useCallback(() => sphereTabs?.getSnapshot() ?? OUTSIDE_SPHERE, [sphereTabs]);
  const sphere = useSyncExternalStore(subscribeSphere, getSphere, getSphere);
  const poseTitle = useSyncExternalStore(subscribePoseEditTitle, poseEditTitle, () => null);
  const insideSphere = sphere.title !== null;
  const editingOnMap = poseTitle !== null && !insideSphere;
  useEffect(() => {
    const api = overlayApiRef?.current;
    if (!api) return;
    if (editingOnMap) api.openOrSelectTab("panorama");
    else if (!insideSphere) api.closeTab("panorama");
  }, [editingOnMap, insideSphere, overlayApiRef]);
  const sectionTabs: Partial<Record<SectionTabId, readonly PanelSection[]>> = {
    ...(controlsSections ? { controls: controlsSections } : {}),
    ...(interfaceSections ? { interface: interfaceSections } : {}),
    ...(settingsSections ? { settings: settingsSections } : {}),
  };
  const elementTabs: Partial<Record<ElementTabId, HTMLElement>> = {
    ...(mapTab ? { map: mapTab } : {}), ...(rendererTab ? { renderer: rendererTab } : {}),
    ...(skyTab ? { sky: skyTab } : {}), ...(timeTab ? { time: timeTab } : {}),
    ...(scenesTab ? { scenes: scenesTab } : {}), ...(headsetTab ? { vr: headsetTab } : {}), ...(aboutTab ? { about: aboutTab } : {}),
    ...(bugReportTab ? { "bug-report": bugReportTab } : {}),
    ...(browserDataTab ? { "browser-data": browserDataTab } : {}),
    ...(sphereTabs ? { "panorama": sphereTabs.sphere, "panorama-settings": sphereTabs.settings } : {}),
  };
  const sectionLabels: Record<SectionTabId, string> = { controls: "Controls", interface: "Interface", settings: "Settings" };
  const elementLabels: Record<ElementTabId, string> = {
    map: "Map", renderer: "Renderer", sky: "Sky", time: "Date and time", scenes: "Scenes", vr: "VR", about: "About", "bug-report": "Bug report", "browser-data": "Browser data", "panorama": sphere.title ?? poseTitle ?? "360", "panorama-settings": "360 image settings",
  };
  const sectionIds = (Object.keys(sectionLabels) as SectionTabId[]).filter(id => sectionTabs[id]);
  const elementIds = (Object.keys(elementLabels) as ElementTabId[]).filter(id => elementTabs[id]);
  const builtIn = new Set<string>(["location", ...sectionIds, ...elementIds]);
  const tabDefinitions: readonly WindowTabDefinition<OverlayTabId>[] = [
    { id: "location", label: "Location" },
    ...(logIsTab ? [{ id: "log" as const, label: "Log" }] : []),
    ...sectionIds.map(id => ({ id, label: sectionLabels[id] })),
    ...additionalTabs.filter(tab => !builtIn.has(tab.id)),
    // The 360 photograph's tab takes the world's place, as an image tab does.
    ...elementIds.map(id => ({ id, label: elementLabels[id], ...(id === "panorama" ? { icon: "sphere" as const } : {}) })),
  ];
  const restorable = new Set(tabDefinitions.filter(tab => tab.id !== "log" && !SPHERE_ONLY.has(tab.id) && tab.available !== false).map(tab => tab.id));
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
    context={{ active: insideSphere, ready: sphere.onScreen, baseOnlyTabs: HIDDEN_IN_SPHERE as ReadonlySet<OverlayTabId>, contextOnlyTabs: (editingOnMap ? SPHERE_SETTINGS_ONLY : SPHERE_ONLY) as ReadonlySet<OverlayTabId>, entryTabId: "panorama", preserveOpenTabs: true }}
    overlayApiRef={overlayApiRef}
    surfaces={renderJoinedTabs ? { renderJoined: ({ left, right }) => renderJoinedTabs({ left: left as TabId, right: right as TabId }), logTab: "log" } : undefined}
    onBeforeCloseTab={onBeforeCloseTab}
    focus={{ onClose(tabId) {
      if (tabId !== "panorama") return;
      const inside = (sphereTabs?.getSnapshot().title ?? null) !== null;
      requestPoseEditStop();
      if (inside) sphereTabs?.leave();
    } }}
    presentation={{
      choice: presentationChoice,
      onChoice: (choice) => { if (settings.has(WINDOWS_PRESENTATION_ID)) settings.set(WINDOWS_PRESENTATION_ID, choice); },
      worldResize,
      edges: flushEdges ? "flush" : "inset",
    }}
    onTabVisibility={(tabId, visible) => {
      if (tabId === "log") return;
      if (visible && tabId === "bug-report") onBugReportShow?.();
      onTabVisibility?.(tabId, visible);
    }}
    renderTabContent={tabId => {
      if (tabId === "log") {
        const logElement = document.getElementById("app-log");
        return logElement ? <AdoptedElement element={logElement} className="foss-earth-log-tab" /> : null;
      }
      const definition = tabDefinitions.find(tab => tab.id === tabId);
      // A surface fills its body; it has no settings footer to save.
      const save = tabId === "settings" || tabId === "browser-data" || tabId === "vr" || definition?.surface ? null : <TabPresetSave settings={settings} tab={tabId} what={definition?.label ?? tabId} />;
      const sections = sectionTabs[tabId as SectionTabId];
      if (sections) return <SectionsPanel sections={sections} storage={storage} leading={tabId === "interface" ? interfaceLead : undefined} footer={save} />;
      const element = elementTabs[tabId as ElementTabId];
      if (element) return <><AdoptedElement element={element} className="foss-earth-element-tab" />{save}</>;
      if (tabId !== "location") {
        const extra = renderAdditionalTab?.(tabId as TabId) ?? null;
        return <>{extra}{save}</>;
      }
      return <>
        <LocationPanel initialLocation={currentLocation(getViewState)} getCurrentLocation={getViewState} onApply={setViewState}
          deviceLocation={deviceLocation} onDeviceLocation={onDeviceLocation}
          showCoordinates={!readoutShown} altitudeReference={altitudeReference}
          onAltitudeReferenceChange={(reference) => { if (settings.has(POSITION_ALTITUDE_ID)) settings.set(POSITION_ALTITUDE_ID, reference); }}
          searchProvider={locationSearchProvider ?? lookup?.searchLocations} observeLocation={observe} draft={draft}
          hostDataCodec={locationHostDataCodec} contribution={locationContribution} createAbortController={() => new AbortController()}
          searchAttribution={<span>Places: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>; airports: <a href="https://www.freeairportdb.com/" target="_blank" rel="noreferrer">FreeAirportDB</a></span>} />
        {locationSearchSection ? <SectionsPanel sections={[locationSearchSection]} storage={storage} /> : null}
        {save}
      </>;
    }}
  />
    {sphere.onScreen && <button type="button" className="hud-chip hud-chip-button foss-earth-sphere-return" onClick={() => sphereTabs?.leave()}>Return to map</button>}
  </>;
}
