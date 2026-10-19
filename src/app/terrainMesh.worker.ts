/** Earth supplies the worker realm; Engine owns the terrain mesh protocol. */
import { installTerrainMeshWorkerKernel, type TerrainMeshWorkerScope } from "@foss-earth/engine/browser";
import { terrainMeshWorkerConfig } from "./terrainMeshWorkerConfig";

const { kernel } = terrainMeshWorkerConfig(self.name);

installTerrainMeshWorkerKernel({
  scope: self as unknown as TerrainMeshWorkerScope,
  loadNative: kernel === "single" ? async () => {
    const { loadTerrainCore } = await import("@foss-earth/native-terrain");
    const core = await loadTerrainCore();
    return {
      actualTier: "single",
      buildSurface: req => core.buildSurface(req),
      dispose: () => core.dispose(),
    };
  } : undefined,
  onError: error => console.error("Earth terrain mesh worker", error),
});
