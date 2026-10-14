import { describe, expect, it } from "vitest";
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
    const settings = createSettingsRegistry({ storage: null, deviceContext: { hardwareConcurrency: 6, deviceMemoryGiB: 8 } });
    settings.register(FOSS_EARTH_PARAMETERS);
    const policy = createEarthBrowserPolicy(settings);
    expect(policy.terrainDecodeWorkers?.()).toBe(5);
    settings.set("map.loader.decodeWorkers", 0);
    expect(policy.terrainDecodeWorkers?.()).toBe(0);
  });
});
