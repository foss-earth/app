/** Deprecated Earth host factory over the released split providers. */
import type { GlobeRuntimeOptions, BabylonRuntime } from "@foss-earth/engine/babylon";
import type { RendererMode } from "@foss-earth/renderer";
import type { SettingsRegistry } from "@foss-earth/ui/settings";
import { getAppSettings } from "../settings/appSettings";
import { createEarthBrowserPolicy } from "./browserPolicy";
import { createEarthBrowserRuntime } from "./browserRuntime";

export interface BabylonRuntimeOptions extends Pick<GlobeRuntimeOptions,
  "googleApiKey" | "preferGoogleTiles" | "rasterBaseMap" | "getSurfaceHeightMeters" |
  "terrainSource" | "rasterImagery" | "rasterQuality" | "terrainPerformanceCapture" | "onStatusChange"> {
  settings?: SettingsRegistry;
  rendererForce?: RendererMode | null;
  simMode?: boolean;
}

/** The low-level owner factory borrows a renderer; this legacy host creates it. */
export async function createBabylonRuntime(canvas: HTMLCanvasElement, options: BabylonRuntimeOptions = {}): Promise<BabylonRuntime> {
  const settings = options.settings ?? getAppSettings();
  const browser = await createEarthBrowserRuntime(canvas, {
    ...createEarthBrowserPolicy(settings), ...options, settings,
  });
  return browser.runtime;
}
