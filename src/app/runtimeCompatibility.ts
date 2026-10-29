/** Deprecated Earth host factory over the released split providers. */
import type { GlobeRuntimeOptions, BabylonRuntime } from "@foss-earth/engine/babylon";
import type { RendererMode } from "@foss-earth/renderer";
import type { SettingsRegistry } from "@foss-earth/ui/settings";
import { getAppSettings } from "../settings/appSettings";
import { createEarthBrowserPolicy } from "./browserPolicy";
import { createEarthBrowserRuntime } from "./browserRuntime";
import type { ImmersiveFrames } from "./immersive/frames";

export interface BabylonRuntimeOptions extends Pick<GlobeRuntimeOptions,
  "googleApiKey" | "googleCredential" | "preferGoogleTiles" | "rasterBaseMap" | "getSurfaceHeightMeters" |
  "terrainSource" | "rasterImagery" | "rasterQuality" | "terrainPerformanceCapture" | "onStatusChange"> {
  settings?: SettingsRegistry;
  rendererForce?: RendererMode | null;
  simMode?: boolean;
}

const immersiveFrames = new WeakMap<BabylonRuntime, ImmersiveFrames>();

/**
 * The frames a headset session presents in, for a runtime this host made:
 * its scheduler draws inside the headset's frames while one presents. Null for
 * a runtime made elsewhere.
 */
export function headsetFramesOf(runtime: BabylonRuntime): ImmersiveFrames | null {
  return immersiveFrames.get(runtime) ?? null;
}

/** The low-level owner factory borrows a renderer; this legacy host creates it. */
export async function createBabylonRuntime(canvas: HTMLCanvasElement, options: BabylonRuntimeOptions = {}): Promise<BabylonRuntime> {
  const settings = options.settings ?? getAppSettings();
  const browser = await createEarthBrowserRuntime(canvas, {
    ...createEarthBrowserPolicy(settings), ...options, settings,
  });
  immersiveFrames.set(browser.runtime, browser.immersive);
  return browser.runtime;
}
