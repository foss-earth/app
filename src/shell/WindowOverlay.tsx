import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  LocationPanel,
  canFitSecondarySlot,
  moveTabsBetweenWorkspaceSlots,
  WorkspaceDockSlot,
  useWindowWorkspace,
  type GeodeticLocation,
  type LocationSearchResult,
  type LocationSearchProvider,
  type WindowTabDefinition,
} from "../windowing";

const DEFAULT_LOCATION: GeodeticLocation = {
  latDeg: 44.977753,
  lonDeg: -93.265011,
};

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
}

function parseCoordinates(query: string): LocationSearchResult | null {
  const match = query.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;

  const latDeg = Number(match[1]);
  const lonDeg = Number(match[2]);
  if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg) || Math.abs(latDeg) > 90 || Math.abs(lonDeg) > 180) {
    return null;
  }

  return { id: "coordinates", label: `${latDeg}, ${lonDeg}`, latDeg, lonDeg };
}

async function searchLocations(query: string, signal: AbortSignal): Promise<readonly LocationSearchResult[]> {
  const coordinateResult = parseCoordinates(query);
  if (coordinateResult) return [coordinateResult];

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "8");
  url.searchParams.set("q", query);
  const response = await fetch(url, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Location search failed (${response.status}).`);

  const results = await response.json() as NominatimResult[];
  return results.flatMap((result) => {
    const latDeg = Number(result.lat);
    const lonDeg = Number(result.lon);
    return Number.isFinite(latDeg) && Number.isFinite(lonDeg)
      ? [{ id: String(result.place_id), label: result.display_name, latDeg, lonDeg }]
      : [];
  });
}

function currentLocation(getViewState: () => GeodeticLocation | null): GeodeticLocation {
  const view = getViewState();
  return view ? { latDeg: view.latDeg, lonDeg: view.lonDeg } : DEFAULT_LOCATION;
}

export interface WindowOverlayProps<TabId extends string = never> {
  getViewState: () => GeodeticLocation | null;
  setViewState: (location: GeodeticLocation) => void;
  /** Hosts supply tab contents; the shared overlay owns both window slots. */
  additionalTabs?: readonly WindowTabDefinition<TabId>[];
  renderAdditionalTab?: (tabId: TabId) => ReactNode;
  locationSearchProvider?: LocationSearchProvider;
}

export function WindowOverlay<TabId extends string = never>({
  getViewState,
  setViewState,
  additionalTabs = [],
  renderAdditionalTab,
  locationSearchProvider = searchLocations,
}: WindowOverlayProps<TabId>) {
  type OverlayTabId = "location" | TabId;
  const tabDefinitions: readonly WindowTabDefinition<OverlayTabId>[] = [
    { id: "location", label: "Location" },
    ...additionalTabs.filter((tab) => tab.id !== "location"),
  ];
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const workspace = useWindowWorkspace<OverlayTabId>();
  const [primaryAddOpen, setPrimaryAddOpen] = useState(false);
  const [secondaryAddOpen, setSecondaryAddOpen] = useState(false);
  const [availableWidth, setAvailableWidth] = useState(0);

  useEffect(() => {
    const element = overlayRef.current;
    if (!element) return;
    const update = () => setAvailableWidth(element.clientWidth);
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(element);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  const primaryAvailable = canFitSecondarySlot({
    availableWidth,
    primaryMinWidth: Math.max(320, workspace.state.primary.width ?? 320),
    secondaryMinWidth: Math.max(320, workspace.state.secondary.width ?? 320),
    centerGap: 220,
    edgeGap: 12,
  });

  useEffect(() => {
    if (availableWidth <= 0 || primaryAvailable || workspace.state.primary.tabs.length === 0) return;
    workspace.setState((current) => moveTabsBetweenWorkspaceSlots(current, "primary", "secondary"));
  }, [availableWidth, primaryAvailable, workspace]);

  const renderTabContent = (tabId: OverlayTabId) => {
    if (tabId !== "location") return renderAdditionalTab?.(tabId as TabId) ?? null;
    return (
      <LocationPanel
        initialLocation={currentLocation(getViewState)}
        onApply={setViewState}
        searchProvider={locationSearchProvider}
      />
    );
  };

  return (
    <div ref={overlayRef} className="foss-earth-window-overlay">
      <WorkspaceDockSlot<OverlayTabId>
        side="left"
        slotId="primary"
        visible={primaryAvailable}
        workspaceState={workspace.state}
        onWorkspaceStateChange={workspace.setState}
        tabDefinitions={tabDefinitions}
        getTabLabel={(tabId) => tabDefinitions.find((tab) => tab.id === tabId)?.label ?? tabId}
        renderTabContent={renderTabContent}
        restoreOnTabSelect
        width={workspace.state.primary.width ?? 320}
        maxWidth={420}
        addMenuOpen={primaryAddOpen}
        onAddMenuOpenChange={(open) => { setPrimaryAddOpen(open); if (open) setSecondaryAddOpen(false); }}
        strings={{ openPanelTabAriaLabel: "Open left panel", openPanelTabTitle: "Open left panel" }}
      />
      <WorkspaceDockSlot<OverlayTabId>
        side="right"
        slotId="secondary"
        workspaceState={workspace.state}
        onWorkspaceStateChange={workspace.setState}
        tabDefinitions={tabDefinitions}
        getTabLabel={(tabId) => tabDefinitions.find((tab) => tab.id === tabId)?.label ?? tabId}
        renderTabContent={renderTabContent}
        restoreOnTabSelect
        width={workspace.state.secondary.width ?? 320}
        maxWidth={420}
        addMenuOpen={secondaryAddOpen}
        onAddMenuOpenChange={(open) => { setSecondaryAddOpen(open); if (open) setPrimaryAddOpen(false); }}
        visible
        strings={{ openPanelTabAriaLabel: "Open right panel", openPanelTabTitle: "Open right panel" }}
      />
    </div>
  );
}
