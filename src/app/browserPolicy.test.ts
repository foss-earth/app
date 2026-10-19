import { describe, expect, it, vi } from "vitest";
import { FOSS_EARTH_PARAMETERS } from "../settings/catalogue";
import { createSettingsRegistry } from "../settings/registry";
import { createEarthBrowserPolicy, terrainDecodeWorkersDefault } from "./browserPolicy";

const workers = (hardwareConcurrency: number | null, deviceMemoryGiB: number | null = null) =>
  terrainDecodeWorkersDefault({ hardwareConcurrency, deviceMemoryGiB });

describe("terrain decode workers", () => {
  it("leaves the page one hardware thread and uses the rest, from 1 to 16", () => {
    expect([1, 2, 3, 4, 8, 10, 17, 32].map(threads => workers(threads).value)).toEqual([1, 1, 2, 3, 7, 9, 16, 16]);
    expect(workers(10).derivedFrom).toBe("one for each of the 10 hardware threads the browser reports but the page's own");
    expect(workers(32).derivedFrom).toContain("limited to 16");
    expect(workers(17).derivedFrom).not.toContain("limited");
  });
  it("uses 3 when the browser does not say how many threads there are", () => {
    expect(workers(null)).toEqual({ value: 3, derivedFrom: "3, because this browser does not say how many hardware threads the device has" });
  });
  it("uses at most 2 where the browser reports 1 GiB of memory or less", () => {
    expect(workers(8, 1)).toEqual({ value: 2, derivedFrom: "2, because the browser reports 1 GiB of memory" });
    expect(workers(8, 0.5).value).toBe(2);
    expect(workers(2, 0.5).value).toBe(1);
    expect(workers(8, 2).value).toBe(7);
  });
  it("is a Map loading control after the request timeout, read live by the browser policy", () => {
    const ids = FOSS_EARTH_PARAMETERS.map(spec => spec.id);
    expect(ids.indexOf("map.loader.decodeWorkers")).toBe(ids.indexOf("map.loader.timeout") + 1);
    // Shared heights are drawn by Component execution, with the other choices of what runs where.
    expect(FOSS_EARTH_PARAMETERS.find(spec => spec.id === "native.sharedHeights")?.home).toMatchObject({ tab: "native", section: "cores" });
    expect(ids.filter(id => id.endsWith("sharedHeights"))).toEqual(["native.sharedHeights"]);
    const settings = createSettingsRegistry({ storage: null, deviceContext: { hardwareConcurrency: 6, deviceMemoryGiB: 8 } });
    settings.register(FOSS_EARTH_PARAMETERS);
    const policy = createEarthBrowserPolicy(settings);
    expect(policy.terrainDecodeWorkers?.()).toBe(5);
    settings.set("map.loader.decodeWorkers", 0);
    expect(policy.terrainDecodeWorkers?.()).toBe(0);
  });
});

describe("destination terrain", () => {
  const hit = (quality: number) => ({ point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, distanceMeters: 0, heightMeters: 250, meshId: "tile", revision: 1, quality });
  it("is ready from the elevation quality it asks for, that many levels lower with coarser elevation", () => {
    const settings = createSettingsRegistry({ storage: null, deviceContext: { hardwareConcurrency: 6, deviceMemoryGiB: 8 } });
    settings.register(FOSS_EARTH_PARAMETERS);
    const policy = createEarthBrowserPolicy(settings).terrainPreparation!;
    const ready = (quality: number) => policy.evaluate({ latDeg: 44.97, lonDeg: -93.23, radiusMeters: 1000 }, [hit(quality)], false, true).result !== null;
    const minimum = settings.get<number>("map.preparation.minimumQuality");
    expect([policy.requiredRasterQuality(), ready(minimum), ready(minimum - 1)]).toEqual([minimum, true, false]);
    settings.set("map.terrain.coarserElevation", 3);
    expect([policy.requiredRasterQuality(), ready(minimum - 3), ready(minimum - 4)]).toEqual([minimum - 3, true, false]);
  });
});

describe("native execution", () => {
  const policyFor = (values: Record<string, string | number | boolean>) => {
    const settings = createSettingsRegistry({ storage: null, deviceContext: { hardwareConcurrency: 6, deviceMemoryGiB: 8 } });
    settings.register(FOSS_EARTH_PARAMETERS);
    for (const [id, value] of Object.entries(values)) settings.set(id, value);
    return createEarthBrowserPolicy(settings);
  };
  const created: { url: string; name: string }[] = [];
  class FakeWorker {
    constructor(url: URL, options: { name: string }) { created.push({ url: String(url), name: options.name }); }
    addEventListener(): void {}
    postMessage(): void {}
    terminate(): void {}
  }

  it("keeps the sky on the page for TypeScript, and gives the A/B pair the same worker", () => {
    expect(policyFor({ "native.tier": "typescript" }).createSkyEvaluator?.()).toBeNull();
    const autoEvaluator = policyFor({ "native.tier": "auto" }).createSkyEvaluator?.();
    expect(autoEvaluator?.status()).toMatchObject({ placement: "worker", kernel: "typescript", started: false });
    autoEvaluator?.dispose();
    // Sky → Shared memory, on by default, runs a WASM sky's shared build.
    for (const [values, kernel] of [[{ "native.tier": "typescript-worker" }, "typescript"], [{ "native.tier": "single", "native.sharedSky": false }, "single"],
      [{ "native.tier": "single" }, "threaded"], [{ "native.tier": "threaded" }, "threaded"]] as const) {
      const evaluator = policyFor(values).createSkyEvaluator?.();
      // Nothing is loaded until the first evaluation.
      expect(evaluator?.status()).toMatchObject({ placement: "worker", kernel, started: false });
      evaluator?.dispose();
    }
    expect(policyFor({ "native.tier": "single", "native.core.sky": "typescript" }).createSkyEvaluator?.()).toBeNull();
  });

  it("names each terrain worker's kernel from the raster plan, and reports all plans", () => {
    vi.stubGlobal("Worker", FakeWorker);
    try {
      // Shared heights are on by default and asked for only where Terrain geometry runs in workers.
      for (const [values, nativeTier, sharedHeights] of [[{ "native.tier": "typescript-worker" }, "typescript", true], [{ "native.tier": "auto" }, "typescript", false],
        [{ "native.tier": "typescript", "native.core.raster": "single" }, "single", false], [{}, "single", true]] as const) {
        const policy = policyFor({ ...values, "native.workers": 12 });
        created.length = 0;
        policy.createTerrainWorker?.();
        expect(created).toHaveLength(1);
        expect(JSON.parse(created[0].name)).toMatchObject({ kind: "earth-terrain", nativeTier, sharedHeights });
      }
      // Asked for only where mesh workers read the grids, and read once, like the native plans.
      const named = (values: Record<string, string | number | boolean>) => {
        const settings = createSettingsRegistry({ storage: null });
        settings.register(FOSS_EARTH_PARAMETERS);
        for (const [id, value] of Object.entries(values)) settings.set(id, value);
        const policy = createEarthBrowserPolicy(settings);
        settings.set("native.sharedHeights", !settings.get("native.sharedHeights"));
        created.length = 0;
        policy.createTerrainWorker?.();
        return JSON.parse(created[0].name) as { sharedHeights: boolean };
      };
      expect(named({ "native.tier": "typescript-worker", "native.workers": 12, "native.sharedHeights": true }).sharedHeights).toBe(true);
      expect(named({ "native.tier": "typescript-worker", "native.workers": 12, "native.sharedHeights": false }).sharedHeights).toBe(false);
      expect(named({ "native.tier": "typescript", "native.workers": 12, "native.sharedHeights": true }).sharedHeights).toBe(false);
      const policy = policyFor({ "native.tier": "single", "native.core.sky": "typescript-worker" });
      expect(policy.nativePlans).toMatchObject({
        raster: { kernel: "single" },
        sky: { kernel: "typescript", requestedBy: "native.core.sky", placement: "worker" },
        terrain: { kernel: "single", requestedBy: "native.tier", placement: "worker" },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("creates terrain mesh workers for worker placement and names them with their kernel", () => {
    vi.stubGlobal("Worker", FakeWorker);
    try {
      expect(policyFor({ "native.tier": "typescript" }).createTerrainMeshWorker?.()).toBeNull();
      const policy = policyFor({ "native.tier": "single" });
      created.length = 0;
      const worker = policy.createTerrainMeshWorker?.();
      expect(worker).not.toBeNull();
      expect(created).toHaveLength(1);
      expect(JSON.parse(created[0].name)).toMatchObject({ kind: "earth-terrain-mesh", kernel: "single" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("applies worker parallelism to real pool limits and captures it until the next reload", () => {
    const settings = createSettingsRegistry({ storage: null });
    settings.register(FOSS_EARTH_PARAMETERS);
    settings.setMany({ "native.tier": "custom", "native.implementation": "wasm", "native.placement": "worker", "native.parallelism": "serial", "native.sharedSky": false, "map.loader.decodeWorkers": 6, "native.workers": 16 });
    const serial = createEarthBrowserPolicy(settings);
    expect(serial.terrainDecodeWorkers?.()).toBe(1);
    expect(serial.terrainMeshWorkers?.()).toBe(1);
    expect(serial.nativePlans?.sky).toMatchObject({ kernel: "single", parallelism: "serial" });
    settings.set("native.parallelism", "auto");
    expect(serial.terrainDecodeWorkers?.()).toBe(1);
    const parallel = createEarthBrowserPolicy(settings);
    expect(parallel.terrainDecodeWorkers?.()).toBe(6);
    expect(parallel.terrainMeshWorkers?.()).toBe(2);
    settings.setMany({ "native.core.terrain": "custom", "native.core.terrain.parallelism": "serial" });
    const mixed = createEarthBrowserPolicy(settings);
    expect(mixed.terrainDecodeWorkers?.()).toBe(6);
    expect(mixed.terrainMeshWorkers?.()).toBe(1);
    settings.set("map.loader.decodeWorkers", 0);
    expect(mixed.terrainDecodeWorkers?.()).toBe(0);
    expect(mixed.terrainMeshWorkers?.()).toBe(0);
  });

  it("never asks the decode pool for more workers than the budget leaves it", () => {
    vi.stubGlobal("Worker", FakeWorker);
    try {
      // Single places the sky, imagery heights, Google, ground and two mesh workers beside the imagery decoder: 7 of 9.
      const policy = policyFor({ "native.tier": "single", "native.workers": 9, "map.loader.decodeWorkers": 6 });
      expect(policy.terrainDecodeWorkers?.()).toBe(2);
      const decoders = [policy.createTerrainWorker?.(), policy.createTerrainWorker?.()];
      expect(decoders.every(Boolean)).toBe(true);
      expect(policy.createTerrainWorker?.()).toBeNull();
      expect(policyFor({ "native.tier": "typescript", "native.workers": 9, "map.loader.decodeWorkers": 6 }).terrainDecodeWorkers?.()).toBe(6);
      expect(policyFor({ "native.tier": "single", "native.workers": 4 }).terrainDecodeWorkers?.()).toBe(0);
      // The default budget leaves the default selection's pool its recommended size, isolated or not.
      for (const isolated of [false, true]) {
        vi.stubGlobal("crossOriginIsolated", isolated);
        const settings = createSettingsRegistry({ storage: null, deviceContext: { hardwareConcurrency: 10, deviceMemoryGiB: 8 } });
        settings.register(FOSS_EARTH_PARAMETERS);
        expect(createEarthBrowserPolicy(settings).terrainDecodeWorkers?.()).toBe(9);
      }
    } finally { vi.unstubAllGlobals(); }
  });

  it("bounds all host worker factories together and returns slots when workers retire", () => {
    vi.stubGlobal("Worker", FakeWorker);
    try {
      const policy = policyFor({ "native.tier": "single", "native.workers": 2 });
      const first = policy.createTerrainHeightWorker?.();
      const second = policy.createGoogleWorker?.();
      expect(first).not.toBeNull(); expect(second).not.toBeNull();
      expect(policy.createTerrainMeshWorker?.()).toBeNull();
      first?.terminate();
      const next = policy.createTerrainMeshWorker?.();
      expect(next).not.toBeNull(); next?.terminate(); second?.terminate();
    } finally { vi.unstubAllGlobals(); }
  });
});
