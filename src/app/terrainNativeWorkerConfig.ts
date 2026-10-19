import type { NativeTierPreference } from "@foss-earth/engine/browser";
import type { ParameterSpec } from "@foss-earth/ui/settings";

/** Component execution → Terrain heights → Shared memory; the policy passes it to decode workers in their name. */
export const TERRAIN_SHARED_HEIGHTS_PARAMETER: ParameterSpec<boolean> = {
  id: "native.sharedHeights", label: "Terrain heights in shared memory",
  description: "After a reload, each decoded elevation tile is kept once, in shared memory that the page and Terrain geometry's workers read, instead of being copied for each mesh job. Used only while Terrain geometry runs in background workers on a cross-origin isolated page; elsewhere tiles are transferred as before. The heights are the same either way.",
  kind: "boolean", unit: "none", default: true,
  defaultReason: "On since 19 October 2026, after it was tried in isolated browsers and judged to work well enough. Nothing changes a tile's heights once it is decoded, so one copy can serve every thread without changing a single height.",
  home: { tab: "native", section: "cores", level: "all" }, appliesLive: false,
  source: "src/app/terrainNativeWorkerConfig.ts",
};

/**
 * Worker.name carries startup policy without making the bundler's URL dynamic.
 * `sharedHeights` asks for heights in shared memory; the worker still checks
 * that its realm can share them.
 */
export function terrainNativeWorkerConfig(name: string): { workerId: string; requestedTier: NativeTierPreference; sharedHeights: boolean } {
  try {
    const value: unknown = JSON.parse(name);
    if (value && typeof value === "object" && "kind" in value && value.kind === "earth-terrain"
      && "id" in value && typeof value.id === "string" && value.id.length > 0 && value.id.length <= 128
      && "nativeTier" in value && ["auto", "typescript", "single", "threaded"].includes(String(value.nativeTier))) {
      return { workerId: value.id, requestedTier: value.nativeTier as NativeTierPreference, sharedHeights: "sharedHeights" in value && value.sharedHeights === true };
    }
  } catch { /* Missing startup policy retains the original TypeScript path. */ }
  return { workerId: "terrain-unconfigured", requestedTier: "typescript", sharedHeights: false };
}
