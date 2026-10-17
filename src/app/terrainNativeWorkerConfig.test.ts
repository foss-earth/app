import { describe, expect, it } from "vitest";
import { terrainNativeWorkerConfig } from "./terrainNativeWorkerConfig";

describe("terrain native startup policy", () => {
  it("retains the original backend for missing or malformed worker names", () => {
    for (const name of ["", "invalid", "null", "{}", JSON.stringify({ kind: "earth-terrain", id: "w", nativeTier: "fastest" })]) {
      expect(terrainNativeWorkerConfig(name)).toEqual({ workerId: "terrain-unconfigured", requestedTier: "typescript" });
    }
  });
  it("passes the exact requested tier and a bounded worker identity", () => {
    for (const tier of ["auto", "typescript", "single", "threaded"] as const) {
      expect(terrainNativeWorkerConfig(JSON.stringify({ kind: "earth-terrain", id: "terrain-7", nativeTier: tier }))).toEqual({ workerId: "terrain-7", requestedTier: tier });
    }
    expect(terrainNativeWorkerConfig(JSON.stringify({ kind: "earth-terrain", id: "a".repeat(129), nativeTier: "single" })).requestedTier).toBe("typescript");
  });
});
