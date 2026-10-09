import type {} from "./vite-env";
import "./styles/globe.css";

import { createGlobeApp } from "./app/createGlobeApp";
import type { GlobeAppHandle } from "./app/createGlobeApp";
import type { PoiSpriteSizeParams } from "@foss-earth/engine";
import type { OrbitCompassScaleParams } from "@foss-earth/engine/compass";
import type { RasterBaseMapSource } from "@foss-earth/engine";
import type { TerrainSource } from "@foss-earth/engine";

export type { GlobeHandle, GlobeLayer, GlobeLayerContext, GlobeLayerState, GlobeViewState, GlobeTheme, GlobeInputModePreference, GlobeInputSensitivitySettings } from "@foss-earth/engine";
export type { InputModeHudHandle } from "@foss-earth/engine/panels";
export { DEFAULT_INPUT_SENSITIVITY } from "@foss-earth/engine";
export { createGlobeApp } from "./app/createGlobeApp";
export type { GlobeAppHandle, GlobeAppOptions } from "./app/createGlobeApp";
export { mountGlobeApp } from "./app/mountGlobeApp";
export { createBabylonLayer, createMeshCullable, asBabylonContext } from "@foss-earth/engine/layers";
export { DEFAULT_RASTER_BASE_MAP_ID, RASTER_BASE_MAP_SOURCES, resolveRasterBaseMapSource } from "@foss-earth/engine";
export type { RasterBaseMapProtocol, RasterBaseMapSource } from "@foss-earth/engine";
export { MAPTERHORN, AWS_TERRARIUM, TERRAIN_SOURCES, resolveTerrainSource } from "@foss-earth/engine";
export type { TerrainSource } from "@foss-earth/engine";
export type { BabylonLayerContext, BabylonLayerState, PoiDescriptor } from "@foss-earth/engine/layers";
export { smoothSurfaceHeightMeters, smoothSurfaceEcef } from "@foss-earth/engine";
export type { PoiSpriteSizeParams } from "@foss-earth/engine";
export { DEFAULT_POI_SPRITE_SIZE_PARAMS } from "@foss-earth/engine";
export type { OrbitCompassScaleParams } from "@foss-earth/engine/compass";
export { DEFAULT_ORBIT_COMPASS_SCALE_PARAMS } from "@foss-earth/engine/compass";
export { getTheme, setTheme, toggleTheme, onThemeChange } from "./theme/theme";

// ─── Sprite POI primitives ────────────────────────────────────────────────────
export {
  type RgbColor,
  type MarkerStyle,
  DEFAULT_DOT_TEXTURE_SIZE,
  DEFAULT_SPRITE_CAPACITY,
  EARTH_RADIUS_METERS,
  rgbToCss,
  markerStyleKey,
} from "@foss-earth/engine/sprites";
export {
  drawCircleAtlasCell,
  makeCircularMarkerAtlas,
} from "@foss-earth/engine/sprites";
export {
  type CreatePointSpriteManagerOptions,
  type CreatePointSpriteOptions,
  createPointSpriteManager,
  createPointSprite,
  setSpriteOpacity,
  disposeSpriteManagers,
} from "@foss-earth/engine/sprites";
export { currentSpriteSize } from "@foss-earth/engine/sprites";
export {
  DEFAULT_POI_HEIGHT_REFINEMENT_MAX_ZOOM_M,
  DEFAULT_POI_HEIGHT_REFINEMENT_PROBE_UP_M,
  DEFAULT_POI_HEIGHT_REFINEMENT_PROBE_DOWN_M,
  smoothPointPosition,
  isEligiblePoiHeightMesh,
  samplePoiMeshPosition,
  poiRefinementLod,
  poiRefinementTileRadius,
  lonLatToTile,
  wrapTileX,
  makeTileKey,
  buildPoiTileIndex,
  distanceScoreMetersSq,
} from "@foss-earth/engine/sprites";
export {
  type PickPointMetadataOptions,
  pickPointMetadata,
} from "@foss-earth/engine/sprites";

export interface GlobeOptions {
  container?: string | HTMLElement;
  apiKey?: string | null;
  baseMap?: string | RasterBaseMapSource | null;
  preferGoogleTiles?: boolean;
  getSurfaceHeightMeters?: (latDeg: number, lonDeg: number) => number | null;
  terrainSource?: string | TerrainSource | null;
  /** @deprecated Ignored: terrain detail is `map.detail.terrain.*`, adjusted by `map.auto.*`. */
  rasterQuality?: unknown;
  onPoiSpriteSizeChange?: (params: PoiSpriteSizeParams) => void;
  onCompassScaleChange?: (params: OrbitCompassScaleParams) => void;
}

export async function createGlobe(options: GlobeOptions = {}): Promise<GlobeAppHandle> {
  const target = options.container ?? "root";
  const rootElement = typeof target === "string" ? document.getElementById(target) : target;
  if (!rootElement) {
    throw new Error(`Expected to find a globe container for ${String(target)}.`);
  }

  return createGlobeApp(rootElement, {
    googleApiKey: options.apiKey,
    baseMap: options.baseMap,
    preferGoogleTiles: options.preferGoogleTiles,
    getSurfaceHeightMeters: options.getSurfaceHeightMeters,
    terrainSource: options.terrainSource,
    onPoiSpriteSizeChange: options.onPoiSpriteSizeChange,
    onCompassScaleChange: options.onCompassScaleChange,
  });
}
