import "./styles/globe.css";

import { createGlobeApp } from "./app/createGlobeApp";
import type { GlobeAppHandle } from "./app/createGlobeApp";

export type { GlobeHandle, GlobeLayer, GlobeLayerContext, GlobeLayerState, GlobeViewState } from "./engine/types";
export { createGlobeApp } from "./app/createGlobeApp";
export { createBabylonLayer, createMeshCullable, asBabylonContext } from "./layers/types";
export type { BabylonLayerContext, BabylonLayerState, PoiDescriptor } from "./layers/types";
export { smoothSurfaceHeightMeters, smoothSurfaceEcef } from "./terrain/smoothElevation";
export type { PoiSpriteSizeParams } from "./hud/poiSpriteSizeTuner";
export { DEFAULT_POI_SPRITE_SIZE_PARAMS } from "./hud/poiSpriteSizeTuner";

export interface GlobeOptions {
  container?: string | HTMLElement;
  apiKey?: string | null;
  onPoiSpriteSizeChange?: (params: PoiSpriteSizeParams) => void;
}

export async function createGlobe(options: GlobeOptions = {}): Promise<GlobeAppHandle> {
  const target = options.container ?? "root";
  const rootElement = typeof target === "string" ? document.getElementById(target) : target;
  if (!rootElement) {
    throw new Error(`Expected to find a globe container for ${String(target)}.`);
  }

  return createGlobeApp(rootElement, { googleApiKey: options.apiKey, onPoiSpriteSizeChange: options.onPoiSpriteSizeChange });
}