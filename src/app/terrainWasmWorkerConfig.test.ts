import { describe, expect, it } from "vitest";
import { terrainWasmWorkerConfig } from "./terrainWasmWorkerConfig";

describe("terrain WASM startup policy", () => {
  it("retains the original backend for missing or malformed worker names", () => {
    for (const name of ["", "invalid", "null", "{}", JSON.stringify({ kind: "earth-terrain", id: "w", wasmTier: "fastest" })]) {
      expect(terrainWasmWorkerConfig(name)).toEqual({ workerId: "terrain-unconfigured", requestedTier: "typescript", sharedHeights: false });
    }
  });
  it("passes the exact requested tier and a bounded worker identity", () => {
    for (const tier of ["auto", "typescript", "single", "threaded"] as const) {
      expect(terrainWasmWorkerConfig(JSON.stringify({ kind: "earth-terrain", id: "terrain-7", wasmTier: tier }))).toEqual({ workerId: "terrain-7", requestedTier: tier, sharedHeights: false });
    }
    expect(terrainWasmWorkerConfig(JSON.stringify({ kind: "earth-terrain", id: "a".repeat(129), wasmTier: "single" })).requestedTier).toBe("typescript");
  });
  it("asks for shared heights only when the page said true", () => {
    const named = (sharedHeights: unknown) => terrainWasmWorkerConfig(JSON.stringify({ kind: "earth-terrain", id: "terrain-2", wasmTier: "typescript", sharedHeights })).sharedHeights;
    expect([named(true), named(false), named("true"), named(1), named(undefined)]).toEqual([true, false, false, false, false]);
  });
});
