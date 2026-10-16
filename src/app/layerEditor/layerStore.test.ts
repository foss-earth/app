import { describe, expect, it } from "vitest";
import { createLayerStore, layerExportFilename, parseLayerStore, type LayerStorage } from "./layerStore";

function memory(): { storage: LayerStorage; raw(): string | null } {
  const values = new Map<string, string>();
  return {
    storage: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value); },
      removeItem: key => { values.delete(key); },
    },
    raw: () => values.get("foss-earth.layer-overrides.v1") ?? null,
  };
}

describe("layer correction storage", () => {
  it("round-trips a move and names the download from the UTC day", () => {
    const saved = memory();
    const store = createLayerStore({ storage: saved.storage, nowIso: () => "2026-10-15T20:00:00.000Z", schedule: run => { run(); return { cancel() {} }; } });
    expect(store.assign("umn-twin-cities", "https://umn-vr.github.io/tour/twin-cities/scene.json", {
      entityId: "northrop-mall", title: "Northrop Mall", layerId: "indoor-360", authoredLayerId: "outdoor-360",
      authoredRevision: "abc", updatedAt: "2026-10-15T20:00:00.000Z",
    }, "now")).toBe(true);
    const exported = store.exportDocument("2026-10-15T20:01:00.000Z");
    expect(exported.text.endsWith("\n")).toBe(true);
    expect(parseLayerStore(exported.text)).toMatchObject({ ok: true, scenes: [{ edits: [{ entityId: "northrop-mall", layerId: "indoor-360" }] }] });
    expect(layerExportFilename("umn-tour-layers", exported.document.exportedAt)).toBe("umn-tour-layers-2026-10-15.json");
    const again = createLayerStore({ storage: saved.storage, nowIso: () => "2026-10-15T20:02:00.000Z", schedule: run => { run(); return { cancel() {} }; } });
    expect(again.edits("umn-twin-cities", "https://umn-vr.github.io/tour/twin-cities/scene.json")).toHaveLength(1);
  });

  it("does not store a photograph left in its published layer and does not overwrite an unreadable save", () => {
    const saved = memory();
    saved.storage.setItem("foss-earth.layer-overrides.v1", "{\"format\":\"other\"}");
    const store = createLayerStore({ storage: saved.storage, nowIso: () => "2026-10-15T20:00:00.000Z", schedule: run => { run(); return { cancel() {} }; } });
    expect(store.status().persistence).toBe("foreign");
    expect(store.assign("umn-twin-cities", "https://umn-vr.github.io/tour/scene.json", {
      entityId: "garden", title: "Garden", layerId: "indoor-360", authoredLayerId: "indoor-360",
      authoredRevision: "abc", updatedAt: "2026-10-15T20:00:00.000Z",
    }, "now")).toBe(false);
    expect(store.assign("umn-twin-cities", "https://umn-vr.github.io/tour/scene.json", {
      entityId: "garden", title: "Garden", layerId: "indoor-360", authoredLayerId: "outdoor-360",
      authoredRevision: "abc", updatedAt: "2026-10-15T20:00:00.000Z",
    }, "now")).toBe(true);
    expect(saved.raw()).toBe("{\"format\":\"other\"}");
    expect(store.exportDocument("2026-10-15T20:01:00.000Z").text).toContain("garden");
    expect(store.replaceSaved().ok).toBe(true);
    expect(saved.raw()).toContain("indoor-360");
  });
});
