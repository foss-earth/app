import { describe, expect, it } from "vitest";
import { terrainMeshWorkerConfig, terrainMeshWorkerName } from "./terrainMeshWorkerConfig";

describe("terrainMeshWorkerConfig", () => {
  it("encodes and decodes kernel configuration", () => {
    const single = terrainMeshWorkerName("single", "mesh-1");
    expect(terrainMeshWorkerConfig(single)).toEqual({ kernel: "single", id: "mesh-1" });
    const ts = terrainMeshWorkerName("typescript");
    expect(terrainMeshWorkerConfig(ts)).toEqual({ kernel: "typescript", id: "mesh-worker" });
  });

  it("falls back to typescript for unconfigured workers", () => {
    expect(terrainMeshWorkerConfig("")).toEqual({ kernel: "typescript", id: "mesh-worker" });
    expect(terrainMeshWorkerConfig("invalid json")).toEqual({ kernel: "typescript", id: "mesh-worker" });
    expect(terrainMeshWorkerConfig(JSON.stringify({ kind: "other" }))).toEqual({ kernel: "typescript", id: "mesh-worker" });
  });
});
