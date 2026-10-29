/** Earth supplies the worker realm; Engine owns the terrain mesh protocol. */
import { installTerrainMeshWorkerKernel, type TerrainMeshWorkerScope } from "@foss-earth/engine/browser";
import { terrainMeshWorkerConfig } from "./terrainMeshWorkerConfig";
import { boundedComputeModule, installComputePreparation } from "./computeWorker";

const { kernel } = terrainMeshWorkerConfig(self.name);
let loading: ReturnType<typeof load> | undefined;
const load = async () => { const { loadTerrainCore } = await import("@foss-earth/engine/terrain-WASM"); return loadTerrainCore(); };
const wasm = () => loading ??= load();
installComputePreparation(() => kernel === "single" ? loading = boundedComputeModule(wasm()) : Promise.resolve());

installTerrainMeshWorkerKernel({
  scope: self as unknown as TerrainMeshWorkerScope,
  loadWasm: kernel === "single" ? async () => {
    const core = await wasm();
    return {
      actualTier: "single",
      buildSurface: req => core.buildSurface(req),
      dispose: () => core.dispose(),
    };
  } : undefined,
  onError: error => console.error("Earth terrain mesh worker", error),
});
