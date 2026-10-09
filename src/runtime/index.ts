/** Deprecated Earth assembly facade; provider modules own every implementation. */
export { createBabylonRuntime, type BabylonRuntimeOptions } from "../app/runtimeCompatibility";
export * from "@foss-earth/engine";
export * from "@foss-earth/engine/babylon";
export * from "@foss-earth/engine/settings";
export * from "@foss-earth/engine/imagery";
export * from "@foss-earth/renderer/babylon";
export * from "@foss-earth/sky/babylon";
// The old facade has one name for these structural lighting contracts.
// Explicit owner exports resolve the Engine/Sky star-export ambiguity.
export type {
  TerrainLighting,
  TerrainNightLighting,
  TerrainNightLightMap,
  TerrainLocalLight,
} from "@foss-earth/sky/babylon";

// The compatibility facade uses the geographic-frame vector and Earth runtime mode.
export type { RuntimeMode, Vec3 } from "@foss-earth/engine";
export type { Vec3 as ImageryVec3 } from "@foss-earth/engine/imagery";
