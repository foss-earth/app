export type TerrainMeshWorkerKernel = "typescript" | "single" | "threaded";

/** Worker.name carries the terrain mesh worker's kernel without making the bundler's URL dynamic. */
export function terrainMeshWorkerConfig(name: string): { kernel: TerrainMeshWorkerKernel; id: string } {
  try {
    const value: unknown = JSON.parse(name);
    if (value && typeof value === "object" && "kind" in value && value.kind === "earth-terrain-mesh"
      && "kernel" in value && ["typescript", "single", "threaded"].includes(String(value.kernel))) {
      return {
        kernel: value.kernel as TerrainMeshWorkerKernel,
        id: typeof (value as { id?: unknown }).id === "string" ? ((value as unknown) as { id: string }).id : "mesh-worker",
      };
    }
  } catch { /* Missing startup policy runs the TypeScript reference. */ }
  return { kernel: "typescript", id: "mesh-worker" };
}

export function terrainMeshWorkerName(kernel: TerrainMeshWorkerKernel, id = "mesh-worker"): string {
  return JSON.stringify({ kind: "earth-terrain-mesh", kernel, id });
}
