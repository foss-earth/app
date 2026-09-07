import { useState } from "react";
import {
  LocationPanel,
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
  const workspace = useWindowWorkspace<TabId>();
  const [primaryAddOpen, setPrimaryAddOpen] = useState(false);
  const [secondaryAddOpen, setSecondaryAddOpen] = useState(false);

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
    <div className="foss-earth-window-overlay">
      <WorkspaceDockSlot<TabId>
        side="left"
        slotId="primary"
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
        strings={{ openPanelTabAriaLabel: "Open right panel", openPanelTabTitle: "Open right panel" }}
      />
    </div>
  );
}