import "./styles/globe.css";

import { createGlobeApp } from "./app/createGlobeApp";
import type { GlobeAppHandle } from "./app/createGlobeApp";
import type { PoiSpriteSizeParams } from "./hud/poiSpriteSizeTuner";
import type { OrbitCompassScaleParams } from "./visualization/orbitCompass";
import type { RasterBaseMapSource } from "./engine/babylon/rasterBaseMaps";

export type { GlobeHandle, GlobeLayer, GlobeLayerContext, GlobeLayerState, GlobeViewState, GlobeTheme, GlobeInputModePreference, GlobeInputSensitivitySettings } from "./engine/types";
export { DEFAULT_INPUT_SENSITIVITY } from "./input/inputSettings";
export { createGlobeApp } from "./app/createGlobeApp";
export { createBabylonLayer, createMeshCullable, asBabylonContext } from "./layers/types";
export { DEFAULT_RASTER_BASE_MAP_ID, RASTER_BASE_MAP_SOURCES, resolveRasterBaseMapSource } from "./engine/babylon/rasterBaseMaps";
export type { RasterBaseMapProtocol, RasterBaseMapSource } from "./engine/babylon/rasterBaseMaps";
export type { BabylonLayerContext, BabylonLayerState, PoiDescriptor } from "./layers/types";
export { smoothSurfaceHeightMeters, smoothSurfaceEcef } from "./terrain/smoothElevation";
export type { PoiSpriteSizeParams } from "./hud/poiSpriteSizeTuner";
export { DEFAULT_POI_SPRITE_SIZE_PARAMS } from "./hud/poiSpriteSizeTuner";
export type { OrbitCompassScaleParams } from "./visualization/orbitCompass";
export { DEFAULT_ORBIT_COMPASS_SCALE_PARAMS } from "./visualization/orbitCompass";
export { getTheme, setTheme, toggleTheme, onThemeChange } from "./theme/theme";

export interface GlobeOptions {
  container?: string | HTMLElement;
  apiKey?: string | null;
  baseMap?: string | RasterBaseMapSource | null;
  preferGoogleTiles?: boolean;
  getSurfaceHeightMeters?: (latDeg: number, lonDeg: number) => number | null;
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
    onPoiSpriteSizeChange: options.onPoiSpriteSizeChange,
    onCompassScaleChange: options.onCompassScaleChange,
  });
}