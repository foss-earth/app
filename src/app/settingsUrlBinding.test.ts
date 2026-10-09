import { describe, expect, it, vi } from "vitest";
import { bindEarthSettingsUrl, type EarthSettingsUrlHost } from "./settingsUrlBinding";
import { createSettingsRegistry, SETTINGS_STORAGE_KEY, URL_PARAMETER_PREFIX } from "../settings/registry";
import { FOSS_EARTH_PARAMETERS, FOSS_EARTH_URL_NAMES, fossEarthUrlAliases } from "../settings/catalogue";

function fixture(address = "https://earth.example/globe/?scene=sample#entry") {
  let url = new URL(address);
  const pop = new Set<() => void>();
  const storage = new Set<(key: string | null) => void>();
  const host: EarthSettingsUrlHost = {
    readUrl() { expect(this).toBe(host); return url; },
    replaceUrl(next) { expect(this).toBe(host); url = next; },
    onPopState(listener) { pop.add(listener); return () => { pop.delete(listener); }; },
    onStorage(listener) { storage.add(listener); return () => { storage.delete(listener); }; },
  };
  const registry = createSettingsRegistry({ storage: null, searchParams: url.searchParams, urlAliases: fossEarthUrlAliases });
  registry.register(FOSS_EARTH_PARAMETERS);
  return {
    registry, host, pop, storage,
    address: () => url.href,
    options: { registry, host, names: FOSS_EARTH_URL_NAMES, prefix: URL_PARAMETER_PREFIX,
      storageKey: SETTINGS_STORAGE_KEY, linkedIds: ["map.source.basemap", "map.source.elevation"] },
  };
}

describe("Earth host URL binding", () => {
  it("uses one injected registry and preserves path, scene, hash and legacy query behavior", () => {
    const h = fixture("https://earth.example/globe/?scene=sample&key=fixture-key#entry");
    const dispose = bindEarthSettingsUrl(h.options);
    expect(h.registry.get("map.source.googleKey")).toBe("fixture-key");
    expect(h.address()).toBe("https://earth.example/globe/?scene=sample#entry");
    h.registry.setHostDefault("map.source.basemap", "google", "fixture default");
    expect(h.address()).toBe("https://earth.example/globe/?scene=sample#entry");
    h.registry.set("map.source.basemap", "osm-standard");
    expect(h.address()).toBe("https://earth.example/globe/?scene=sample&mapSource=osm-standard#entry");
    const release = h.registry.force("map.source.basemap", "usgs-topo", "host fixture");
    expect(h.address()).toContain("mapSource=osm-standard");
    release();
    dispose();
    expect(h.pop.size + h.storage.size).toBe(0);
  });

  it("retires all subscriptions after partial setup fails, even when an unsubscribe throws", () => {
    const h = fixture();
    const failedSetup = new Error("Storage subscription failed.");
    const failedCleanup = new Error("Popstate unsubscribe failed.");
    let popListener: (() => void) | undefined;
    h.host.onPopState = listener => { popListener = listener; return () => { throw failedCleanup; }; };
    h.host.onStorage = () => { throw failedSetup; };
    let thrown: unknown;
    try { bindEarthSettingsUrl(h.options); } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(AggregateError);
    expect((thrown as AggregateError).errors).toEqual([failedSetup, failedCleanup]);
    h.registry.set("map.source.basemap", "osm-standard");
    popListener?.();
    expect(h.address()).toBe("https://earth.example/globe/?scene=sample#entry");
  });

  it("attempts every host unsubscribe and prevents late snapshot callbacks after disposal", () => {
    const h = fixture();
    const failures = [new Error("Pop unsubscribe."), new Error("Storage unsubscribe.")];
    let popListener: (() => void) | undefined;
    let storageListener: ((key: string | null) => void) | undefined;
    const stopped: string[] = [];
    h.host.onPopState = listener => { popListener = listener; return () => { stopped.push("pop"); throw failures[0]; }; };
    h.host.onStorage = listener => { storageListener = listener; return () => { stopped.push("storage"); throw failures[1]; }; };
    const reload = vi.spyOn(h.registry, "reload");
    const dispose = bindEarthSettingsUrl(h.options);
    storageListener?.(SETTINGS_STORAGE_KEY);
    expect(reload).toHaveBeenCalledTimes(1);
    let thrown: unknown;
    try { dispose(); } catch (error) { thrown = error; }
    expect((thrown as AggregateError).errors).toEqual(failures);
    expect(stopped).toEqual(["pop", "storage"]);
    h.registry.set("map.source.basemap", "osm-standard");
    popListener?.();
    storageListener?.(SETTINGS_STORAGE_KEY);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(h.address()).toBe("https://earth.example/globe/?scene=sample#entry");
    expect(dispose).not.toThrow();
  });
});
