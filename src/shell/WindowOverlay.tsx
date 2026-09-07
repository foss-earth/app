import { useEffect, useRef, useState } from "react";
import {
  LocationPanel,
  canFitSecondarySlot,
  moveTabsBetweenWorkspaceSlots,
  WorkspaceDockSlot,
  useWindowWorkspace,
  type GeodeticLocation,
  type LocationSearchResult,
  type WindowTabDefinition,
} from "../windowing";
import type { GlobeViewState } from "../engine/types";

type TabId = "location";

const TAB_DEFINITIONS: readonly WindowTabDefinition<TabId>[] = [
  { id: "location", label: "Location" },
];

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

function currentLocation(getViewState: () => GlobeViewState | null): GeodeticLocation {
  const view = getViewState();
  return view ? { latDeg: view.latDeg, lonDeg: view.lonDeg } : DEFAULT_LOCATION;
}

export interface WindowOverlayProps {
  getViewState: () => GlobeViewState | null;
  setViewState: (location: GeodeticLocation) => void;
}

export function WindowOverlay({ getViewState, setViewState }: WindowOverlayProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const workspace = useWindowWorkspace<TabId>();
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
    primaryMinWidth: 320,
    secondaryMinWidth: 320,
    centerGap: 220,
    edgeGap: 12,
  });

  useEffect(() => {
    if (availableWidth <= 0 || primaryAvailable || workspace.state.primary.tabs.length === 0) return;
    workspace.setState(moveTabsBetweenWorkspaceSlots(workspace.state, "primary", "secondary"));
  }, [availableWidth, primaryAvailable, workspace]);

  const renderTabContent = (tabId: TabId) => {
    if (tabId !== "location") return null;
    return (
      <LocationPanel
        initialLocation={currentLocation(getViewState)}
        onApply={setViewState}
        searchProvider={searchLocations}
      />
    );
  };

  return (
    <div ref={overlayRef} className="foss-earth-window-overlay">
      <WorkspaceDockSlot<TabId>
        side="left"
        slotId="primary"
        visible={primaryAvailable}
        workspaceState={workspace.state}
        onWorkspaceStateChange={workspace.setState}
        tabDefinitions={TAB_DEFINITIONS}
        getTabLabel={(tabId) => TAB_DEFINITIONS.find((tab) => tab.id === tabId)?.label ?? tabId}
        renderTabContent={renderTabContent}
        width={320}
        maxWidth={420}
        addMenuOpen={primaryAddOpen}
        onAddMenuOpenChange={setPrimaryAddOpen}
        strings={{ openPanelTabAriaLabel: "Open left panel", openPanelTabTitle: "Open left panel" }}
      />
      <WorkspaceDockSlot<TabId>
        side="right"
        slotId="secondary"
        workspaceState={workspace.state}
        onWorkspaceStateChange={workspace.setState}
        tabDefinitions={TAB_DEFINITIONS}
        getTabLabel={(tabId) => TAB_DEFINITIONS.find((tab) => tab.id === tabId)?.label ?? tabId}
        renderTabContent={renderTabContent}
        width={320}
        maxWidth={420}
        addMenuOpen={secondaryAddOpen}
        onAddMenuOpenChange={setSecondaryAddOpen}
        visible
        strings={{ openPanelTabAriaLabel: "Open right panel", openPanelTabTitle: "Open right panel" }}
      />
    </div>
  );
}