import { describe, expect, it } from "vitest";
import type { SceneController, SceneEntryStatus, SceneLayerStatus, SceneStatus } from "@foss-earth/scenes/browser";
import { createLayerOverrides } from "./layerOverrides";
import { createLayerStore, type LayerStorage } from "./layerStore";

function entry(id: string, title: string): SceneEntryStatus {
  return { id, title, description: null, supported: true, message: null, placement: "placed", preview: "ready", marker: null, capture: null, pose: null, attribution: null, previewDetail: null, images: [], links: [] };
}

function panoramas(id: string, members: readonly string[]): SceneLayerStatus {
  return { id, title: "360 images", kind: "panoramas", visible: true, shown: true, enabled: true, drawn: true, members, layers: [] };
}

describe("applying saved layer corrections", () => {
  it("moves a saved photograph when the scene loads, remembers a new drag, and resets to the published layer", async () => {
    const values = new Map<string, string>();
    const storage: LayerStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
    const store = createLayerStore({ storage, nowIso: () => "2026-10-15T20:00:00.000Z", schedule: run => { run(); return { cancel() {} }; } });
    store.assign("tour", "https://scenes.example/tour.json", {
      entityId: "garden", title: "Garden", layerId: "indoor-360", authoredLayerId: "outdoor-360",
      authoredRevision: "r1", updatedAt: "2026-10-15T20:00:00.000Z",
    }, "now");
    let members = { "outdoor-360": ["garden"], "indoor-360": ["courtyard"] };
    let state: { loading: null; errors: []; status: SceneStatus | null } = { loading: null, errors: [], status: null };
    const listeners = new Set<(next: typeof state) => void>();
    const notify = (): void => { for (const listener of listeners) listener(state); };
    const status = (): SceneStatus => ({
      phase: "overview", active: null, target: null, sceneId: "tour", revision: "r1", title: "Tour", generation: 1, hovered: null,
      entries: [entry("garden", "Garden"), entry("courtyard", "Courtyard")], groups: [],
      layers: [
        { id: "outdoor", title: "Outdoor", visible: true, shown: true, enabled: true, drawn: false, members: [], layers: [panoramas("outdoor-360", members["outdoor-360"])] },
        { id: "indoor", title: "Indoor", visible: true, shown: true, enabled: true, drawn: false, members: [], layers: [panoramas("indoor-360", members["indoor-360"])] },
      ],
      credits: [], overview: "none", warnings: [], renderingAvailable: true, unavailableReason: null, lastError: null, view: null,
    });
    const handle = {
      movePanorama(id: string, layerId: "outdoor-360" | "indoor-360") {
        members = { "outdoor-360": members["outdoor-360"].filter(item => item !== id), "indoor-360": members["indoor-360"].filter(item => item !== id) };
        members[layerId] = [...members[layerId], id];
        state = { ...state, status: status() };
        notify();
        return true;
      },
    };
    const controller = {
      examples: [{ id: "tour", title: "Tour", description: "A scene", url: "tour.json" }],
      state: () => state,
      handle: () => handle,
      async load() { state = { loading: null, errors: [], status: status() }; notify(); return true; },
      unload() {}, consumePointerPress() {}, subscribe(listener: (next: typeof state) => void) { listeners.add(listener); listener(state); return () => { listeners.delete(listener); }; },
      onFailure: () => () => {}, onProgress: () => () => {}, whenSettled: async () => {}, destroy() {},
    } as unknown as SceneController;
    const layers = createLayerOverrides({ baseUrl: "https://scenes.example/", controller, persist: true, exportPrefix: "umn-tour-layers", store, schedule: run => { run(); return { cancel() {} }; } });
    expect(await controller.load("tour.json")).toBe(true);
    expect(members["indoor-360"]).toEqual(["courtyard", "garden"]);
    expect(layers.count()).toBe(1);
    handle.movePanorama("courtyard", "outdoor-360");
    expect(layers.count()).toBe(2);
    const exported = layers.exportDocument();
    expect(exported.filename).toMatch(/^umn-tour-layers-\d{4}-\d{2}-\d{2}\.json$/);
    expect(exported.text).toContain("courtyard");
    layers.reset();
    expect(members).toEqual({ "outdoor-360": ["garden"], "indoor-360": ["courtyard"] });
    expect(layers.count()).toBe(0);
    layers.dispose();
  });
});
