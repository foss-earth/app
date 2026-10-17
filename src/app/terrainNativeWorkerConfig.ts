import type { NativeTierPreference } from "@foss-earth/engine/browser";

/** Worker.name carries startup policy without making the bundler's URL dynamic. */
export function terrainNativeWorkerConfig(name: string): { workerId: string; requestedTier: NativeTierPreference } {
  try {
    const value: unknown = JSON.parse(name);
    if (value && typeof value === "object" && "kind" in value && value.kind === "earth-terrain"
      && "id" in value && typeof value.id === "string" && value.id.length > 0 && value.id.length <= 128
      && "nativeTier" in value && ["auto", "typescript", "single", "threaded"].includes(String(value.nativeTier))) {
      return { workerId: value.id, requestedTier: value.nativeTier as NativeTierPreference };
    }
  } catch { /* Missing startup policy retains the original TypeScript path. */ }
  return { workerId: "terrain-unconfigured", requestedTier: "typescript" };
}
