import { EARTH_BROWSER_POLICY_PARAMETERS } from "../../app/browserPolicy";
import { DEFAULT_RASTER_BASE_MAP_ID, isKnownRasterBaseMapId } from "@foss-earth/engine";
import type { UrlAliasResult, LegacyMigration, ParameterSpec, SettingsStorage } from "@foss-earth/ui/settings";
import { THEME_LEGACY_MIGRATION } from "@foss-earth/ui/settings";
import { HUD_BUTTON_VISIBILITY_MIGRATION, PERFORMANCE_HUD_VISIBILITY_MIGRATION } from "@foss-earth/toolbar";
import {
  CONTROLS_PARAMETERS, CONTROLS_TAB, MAP_AUTO_PARAMETERS, MAP_LOADING_PARAMETERS,
  MAP_SELECTION_PARAMETERS, MAP_TERRAIN_SELECTION_PARAMETERS, MAP_DETAIL_PARAMETERS,
  MAP_SOURCE_PARAMETERS, OVERVIEW_MAP_PARAMETERS, MAP_TAB, GLOBE_RUNTIME_PARAMETERS, ENGINE_POINT_RESOURCE_PARAMETERS,
  MAP_CACHE_PRESENTATION_PARAMETERS, TERRAIN_IMAGE_DECODE_PARAMETERS, WASM_PARAMETERS, createEngineMigrations,
  getGoogleApiKeyFromSearchParams,
} from "@foss-earth/engine/settings";
import { INTERFACE_PARAMETERS, INTERFACE_TAB, PERFORMANCE_HUD_METRICS, SETTINGS_TAB, TOOLBAR_BUTTONS } from "./interface";
import { RENDERER_EXPERIMENT_IDS, RENDERER_OWNED_EXPERIMENT_PARAMETERS, RENDERER_PARAMETERS, RENDERER_TAB } from "@foss-earth/renderer/settings";
import { SPHERE_SETTINGS_TAB, SPHERE_TAB, VIEWER_PARAMETERS, VIEWER_SECTION_TITLES, SCENES_TAB } from "@foss-earth/sphere-image/settings";
import { SCENE_DOCUMENT_PARAMETERS, SCENE_SECTION_TITLES } from "@foss-earth/scenes";
import { createImageResourceParameters, IMAGE_RESOURCE_SECTION_TITLES } from "@foss-earth/images/settings";
import { TILED_CUBEMAP_PARAMETERS, keptGpuDefault } from "@foss-earth/sphere-tiled-cubemap/settings";
import { PREVIEW_SHEETS_PARAMETERS } from "@foss-earth/preview-sheets/settings";
import { SKY_PARAMETERS, SKY_SECTION_TITLES, SKY_TAB, TIME_TAB } from "@foss-earth/sky/settings";
export { CONTROLS_TAB, INTERFACE_TAB, MAP_TAB, SPHERE_SETTINGS_TAB, SPHERE_TAB, RENDERER_TAB, SCENES_TAB, SETTINGS_TAB, SKY_TAB, TIME_TAB, PERFORMANCE_HUD_METRICS, TOOLBAR_BUTTONS };
export { SKY_MODELS, VIEWPOINT_SURFACE_LIGHTING_CHOICE, type SkyModel } from "@foss-earth/sky/settings";
export { POSITION_ALTITUDE_ID, POSITION_ALTITUDE_UNIT_ID, POSITION_COORDINATE_LABELS_ID, POSITION_SEA_LEVEL_GRID_ID, TOOLBAR_EDIT_PRIORITIES_ID, TOOLBAR_PRIORITIES, toolbarPriorityParameterId } from "./interface";
export type { AltitudeReference, AltitudeUnit, CoordinateLabels, ToolbarItemId, ToolbarVisibility } from "./interface";
export { INPUT_RATE_IDS, INPUT_SENSITIVITY_IDS, atlasLimitMiB } from "@foss-earth/engine/settings";
export { RENDERER_EXPERIMENT_IDS };
/** Each owner contributes to the host's one registry, once. */
export const FOSS_EARTH_PARAMETERS: readonly ParameterSpec[] = [
  ...MAP_SOURCE_PARAMETERS, ...OVERVIEW_MAP_PARAMETERS, ...MAP_DETAIL_PARAMETERS, ...MAP_AUTO_PARAMETERS,
  ...MAP_LOADING_PARAMETERS, ...MAP_SELECTION_PARAMETERS, ...MAP_TERRAIN_SELECTION_PARAMETERS,
  ...GLOBE_RUNTIME_PARAMETERS, ...EARTH_BROWSER_POLICY_PARAMETERS, ...ENGINE_POINT_RESOURCE_PARAMETERS, ...MAP_CACHE_PRESENTATION_PARAMETERS,
  ...TERRAIN_IMAGE_DECODE_PARAMETERS, ...WASM_PARAMETERS, ...RENDERER_PARAMETERS, ...RENDERER_OWNED_EXPERIMENT_PARAMETERS,
  ...SKY_PARAMETERS, ...CONTROLS_PARAMETERS, ...INTERFACE_PARAMETERS,
  ...SCENE_DOCUMENT_PARAMETERS, ...VIEWER_PARAMETERS,
  ...createImageResourceParameters({ keptGpuDefault }), ...TILED_CUBEMAP_PARAMETERS, ...PREVIEW_SHEETS_PARAMETERS,
];

export const FOSS_EARTH_SECTION_TITLES: ReadonlyArray<readonly [string, string, string]> = [
  [MAP_TAB, "source", "Source"],
  [MAP_TAB, "detail", "Detail"],
  [MAP_TAB, "loading", "Loading and memory"],
  [MAP_TAB, "auto", "Automatic adjustment"],
  [MAP_TAB, "selection", "Imagery selection"],
  [MAP_TAB, "terrain-selection", "Terrain selection"],
  [RENDERER_TAB, "main", "Renderer"],
  [RENDERER_TAB, "clipping", "Depth range"],
  [RENDERER_TAB, "experiments", "Experiments"],
  [CONTROLS_TAB, "input-method", "Input method"],
  [CONTROLS_TAB, "camera", "Camera"],
  [CONTROLS_TAB, "orbit", "Orbit"],
  [CONTROLS_TAB, "mouse", "Mouse and trackpad"],
  [CONTROLS_TAB, "touch", "Touch"],
  [CONTROLS_TAB, "controller", "Controller"],
  [RENDERER_TAB, "performance", "Debug"],
  [INTERFACE_TAB, "theme", "Theme"],
  [INTERFACE_TAB, "windows", "Windows"],
  [INTERFACE_TAB, "compass", "Compass"],
  [INTERFACE_TAB, "toolbar", "Toolbar"],
  [INTERFACE_TAB, "position", "Position readout"],
  [INTERFACE_TAB, "log", "Log"],
  ["location", "search", "Search"],
  [SETTINGS_TAB, "app-files", "App files"],
  [SETTINGS_TAB, "diagnostics", "Diagnostics"],
  ["wasm", "selection", "Global defaults"],
  ["wasm", "cores", "Components"],
  ...SCENE_SECTION_TITLES,
  ...VIEWER_SECTION_TITLES,
  ...IMAGE_RESOURCE_SECTION_TITLES,
  [SCENES_TAB, "tiles", "Tiled images"],
  ...SKY_SECTION_TITLES,
];

/** The host supplies storage; shared migrations contain the legacy interpretations. */
const legacyStorage: Pick<SettingsStorage, "getItem"> = { getItem(key) {
  try { return typeof localStorage === "undefined" ? null : localStorage.getItem(key); }
  catch { return null; }
} };
export const FOSS_EARTH_MIGRATIONS: readonly LegacyMigration[] = [
  ...createEngineMigrations(legacyStorage), THEME_LEGACY_MIGRATION,
  HUD_BUTTON_VISIBILITY_MIGRATION, PERFORMANCE_HUD_VISIBILITY_MIGRATION,
];

function mapSourceAlias(value: string): string | null {
  const lower = value.trim().toLowerCase();
  if (lower === "google" || lower === "google-3d-tiles") return "google";
  if (lower === "fallback" || lower === "fallback-globe") return DEFAULT_RASTER_BASE_MAP_ID;
  return isKnownRasterBaseMapId(lower) ? lower : null;
}

/**
 * The query names each of these parameters is read from besides
 * `?set.<id>=`. The first is the one written back to the address bar.
 */
export const FOSS_EARTH_URL_NAMES: Readonly<Record<string, readonly string[]>> = {
  "map.source.basemap": ["mapSource", "tiles"],
  "map.source.elevation": ["elevationSource", "terrainSource"],
  "map.source.googleKey": ["gkey", "key", "googleKey"],
};

/** The URL parameters FOSS Earth read before the registry, mapped onto parameters for this session. */
export function fossEarthUrlAliases(params: URLSearchParams): UrlAliasResult {
  const values: Record<string, string> = {};
  const source = params.get("mapSource") ?? params.get("tiles");
  if (source !== null) {
    const id = mapSourceAlias(source);
    if (id) values["map.source.basemap"] = id;
  }
  const elevation = params.get("elevationSource") ?? params.get("terrainSource");
  if (elevation) values["map.source.elevation"] = elevation.trim().toLowerCase();
  const renderer = params.get("renderer")?.trim().toLowerCase();
  if (renderer === "webgpu" || renderer === "webgl2" || renderer === "webgl") values["renderer.backend"] = renderer;
  const imagery = params.get("rasterImagery")?.trim().toLowerCase();
  if (imagery === "atlas" || imagery === "legacy") values["map.detail.imageryPath"] = imagery;
  const key = getGoogleApiKeyFromSearchParams(params);
  if (key) values["map.source.googleKey"] = key;
  const notes: Record<string, string> = {};
  // The retired quality profiles, as the terrain values they stand for, for this visit only.
  const quality = params.get("terrainQuality")?.trim().toLowerCase();
  const profile = quality ? TERRAIN_QUALITY_VALUES[quality] : undefined;
  if (profile) {
    Object.assign(values, profile);
    notes["map.detail.terrain.default"] = `?terrainQuality=${quality} is retired: it set terrain detail for this visit.`;
  }
  return { values, notes };
}

/**
 * `?terrainQuality`'s profiles as parameter values: the terrain error each
 * profile showed under the camera, held there (low, balanced, high), or
 * adjusted to the frame time (auto).
 */
const TERRAIN_QUALITY_VALUES: Readonly<Record<string, Record<string, string>>> = {
  low: { "map.detail.terrain.default": "8", "map.auto.terrainDetail": "false" },
  balanced: { "map.detail.terrain.default": "4", "map.auto.terrainDetail": "false" },
  high: { "map.detail.terrain.default": "2", "map.auto.terrainDetail": "false" },
  auto: { "map.auto.terrainDetail": "true" },
};
