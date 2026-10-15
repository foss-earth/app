import { describe, expect, it, vi } from "vitest";
import type { SceneController, SceneEntryStatus, ScenePlacement, SceneStatus } from "@foss-earth/scenes/browser";
import type { SpherePoseEdit } from "../sceneWorld";
import { createPoseOverrides } from "./poseOverrides";
import { createPoseStore, type PoseStorage, type PublishedBaseline } from "./poseStore";

const BASE = "https://umn-vr.github.io/tour/";
const SCENE_URL = "https://umn-vr.github.io/tour/twin-cities/scene.json";

function entry(id: string, over: Partial<SceneEntryStatus> = {}): SceneEntryStatus {
  return {
    id, title: id, description: null, supported: true, message: null, placement: "placed", preview: "ready",
    marker: { mode: "ground-relative", eastM: 0, northM: 0, offsetM: 25, radiusMeters: 3, authoredRadius: false },
    capture: { longitudeDeg: -93.23, latitudeDeg: 44.97, heightMeters: null, horizontalAccuracyMeters: null },
    pose: { headingDeg: 0, pitchDeg: 0, rollDeg: 0, aligned: false },
    attribution: null, previewDetail: null, images: [], links: [], ...over,
  };
}

function status(over: Partial<SceneStatus> = {}): SceneStatus {
  return {
    phase: "overview", active: null, target: null, sceneId: "umn-twin-cities", revision: "rev-1", title: "Twin Cities",
    generation: 1, hovered: null, entries: [entry("northrop-mall"), entry("coffman")], groups: [], layers: [], credits: [],
    overview: "none", warnings: [], renderingAvailable: true, unavailableReason: null, lastError: null, view: null, ...over,
  };
}

function placement(edit: SpherePoseEdit | null, pending = false): ScenePlacement {
  const heading = edit?.headingDeg ?? 0;
  const pitch = edit?.pitchDeg ?? 0;
  return {
    state: pending ? "pending" : "placed",
    placement: {
      marker: pending ? null : [edit?.longitudeDeg ?? -93.23, edit?.latitudeDeg ?? 44.97, edit?.offsetM ?? 25],
      radiusMeters: 3,
      content: [[heading, pitch, 0], [0, 1, 0], [0, 0, 1]],
      outline: null, hoverScale: 1,
    },
  };
}

function harness(options?: { persist?: boolean; storage?: PoseStorage | null }) {
  let current = status();
  const listeners = new Set<(state: { status: SceneStatus | null }) => void>();
  const edits = new Map<string, SpherePoseEdit | null>();
  let pending = false;
  const repositioned: { id: string; capture: { longitudeDeg: number; latitudeDeg: number; heightMeters: number | null }; heading: number }[] = [];
  let synced = 0;
  let loadImpl: (input: string, exampleId?: boolean) => Promise<boolean> = async () => true;
  const controller = {
    examples: [{ id: "twin-cities", title: "Twin Cities", description: "", url: "twin-cities/scene.json" }],
    state: () => ({ loading: null, errors: [], status: current }),
    handle: () => null,
    load: (input: string, loadOptions?: { exampleId?: boolean }) => loadImpl(input, loadOptions?.exampleId),
    unload() { current = null as unknown as SceneStatus; emit(); },
    consumePointerPress: vi.fn(),
    subscribe(listener: (state: { status: SceneStatus | null }) => void) { listeners.add(listener); listener({ status: current }); return () => listeners.delete(listener); },
    onFailure: () => () => {}, onProgress: () => () => {}, whenSettled: async () => {}, destroy() {},
  };
  function emit() { for (const listener of listeners) listener({ status: current }); }
  const world = {
    setPoseEdit(id: string, edit: SpherePoseEdit | null) {
      edits.set(id, edit);
      emit();
      return placement(edit, pending);
    },
    posePlacement(id: string) { return placement(edits.get(id) ?? null, pending); },
  };
  const viewer = {
    reposition(id: string, edit: { placement: ScenePlacement["placement"]; capture?: { longitudeDeg: number; latitudeDeg: number; heightMeters: number | null } }) {
      repositioned.push({ id, capture: edit.capture!, heading: edit.placement.content[0][0] });
    },
    syncPresentedCamera() { synced += 1; },
  };
  const values = new Map<string, string>();
  const storage: PoseStorage = options?.storage === undefined ? {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: key => { values.delete(key); },
  } : options.storage;
  const store = createPoseStore({ storage, nowIso: () => "2026-10-14T22:28:00.000Z", nowMs: () => 0, schedule: run => { run(); return { cancel() {} }; } });
  const overrides = createPoseOverrides({
    baseUrl: BASE, controller: controller as unknown as SceneController, world, viewer, persist: options?.persist ?? true, store,
  });
  return {
    overrides, controller, world, viewer, repositioned, edits, values, store,
    synced: () => synced,
    setPending(next: boolean) { pending = next; },
    setStatus(next: SceneStatus | null) { current = next as SceneStatus; emit(); },
    async load(input = "twin-cities", exampleId = true) { return controller.load(input, { exampleId }); },
    setLoad(fn: typeof loadImpl) { loadImpl = fn; },
  };
}

describe("pose overrides", () => {
  it("applies a saved place to the world and the viewer, including capture details", async () => {
    const host = harness();
    const published = host.overrides.baseline("northrop-mall");
    expect(published).toBeNull();
    host.store.setNumbers("umn-twin-cities", SCENE_URL, {
      entityId: "northrop-mall", title: "northrop-mall", revision: "rev-1", mode: "ground-relative",
      longitudeDeg: -93.23, latitudeDeg: 44.97, heightMeters: null, headingDeg: 0, pitchDeg: 0, rollDeg: 0, offsetM: 25, aligned: false, eastM: 0, northM: 0,
    }, { mode: "ground-relative", longitudeDeg: -93.25, latitudeDeg: 44.98, heightMeters: null, headingDeg: 20, pitchDeg: -2, offsetM: 30 }, "memory");
    await host.load();
    expect(host.edits.get("northrop-mall")).toMatchObject({ longitudeDeg: -93.25, headingDeg: 20, pitchDeg: -2, offsetM: 30, heightMeters: null });
    expect(host.repositioned.at(-1)).toMatchObject({ id: "northrop-mall", capture: { longitudeDeg: -93.25, latitudeDeg: 44.98, heightMeters: null }, heading: 20 });
    expect(host.overrides.record("coffman")).toBeNull();
  });

  it("waits for terrain and still applies once a marker exists", async () => {
    const host = harness();
    host.setPending(true);
    host.store.setNumbers("umn-twin-cities", SCENE_URL, baselineOf("northrop-mall"), desiredOf({ headingDeg: 15 }), "memory");
    await host.load();
    expect(host.repositioned).toEqual([]);
    expect(host.edits.get("northrop-mall")?.headingDeg).toBe(15);
    host.setPending(false);
    host.setStatus(status());
    expect(host.repositioned.at(-1)?.heading).toBe(15);
  });

  it("synchronizes the presented camera for a direct immersive entry", async () => {
    const host = harness();
    host.store.setNumbers("umn-twin-cities", SCENE_URL, baselineOf("northrop-mall"), desiredOf({ headingDeg: 8 }), "memory");
    host.setLoad(async () => { host.setStatus(status({ phase: "immersive", active: "northrop-mall" })); return true; });
    await host.load();
    expect(host.synced()).toBeGreaterThan(0);
    expect(host.repositioned.at(-1)?.id).toBe("northrop-mall");
  });

  it("restores the published world and viewer on reset and clear, and keeps the other scene", async () => {
    const host = harness();
    await host.load();
    host.overrides.setNumbers("northrop-mall", desiredOf({ headingDeg: 11, offsetM: 40 }));
    host.store.setNumbers("umn-minneapolis", "https://umn-vr.github.io/tour/minneapolis/scene.json", baselineOf("other"), desiredOf({ headingDeg: 3 }), "now");
    host.overrides.reset("northrop-mall");
    expect(host.edits.get("northrop-mall")).toBeNull();
    expect(host.repositioned.at(-1)?.heading).toBe(0);
    expect(host.store.edit("umn-minneapolis", "https://umn-vr.github.io/tour/minneapolis/scene.json", "other")).not.toBeNull();
    host.overrides.setNumbers("northrop-mall", desiredOf({ headingDeg: 12 }));
    host.overrides.clearScene();
    expect(host.overrides.record("northrop-mall")).toBeNull();
    expect(host.edits.get("northrop-mall")).toBeNull();
    expect(host.store.edit("umn-minneapolis", "https://umn-vr.github.io/tour/minneapolis/scene.json", "other")).not.toBeNull();
  });

  it("applies only the overrides of the scene that committed, even when ids match", async () => {
    const host = harness();
    host.store.setNumbers("umn-twin-cities", SCENE_URL, baselineOf("northrop-mall"), desiredOf({ headingDeg: 10 }), "memory");
    host.store.setNumbers("umn-minneapolis", "https://umn-vr.github.io/tour/minneapolis/scene.json", baselineOf("northrop-mall"), desiredOf({ headingDeg: 50 }), "memory");
    await host.load();
    expect(host.edits.get("northrop-mall")?.headingDeg).toBe(10);
    host.setLoad(async () => {
      host.setStatus(status({ sceneId: "umn-minneapolis", revision: "rev-m", generation: 2, entries: [entry("northrop-mall")] }));
      return true;
    });
    await host.load("minneapolis/scene.json", false);
    expect(host.edits.get("northrop-mall")?.headingDeg).toBe(50);
  });

  it("keeps the previous live pose when a replacement fails or is superseded", async () => {
    const host = harness();
    await host.load();
    host.overrides.setNumbers("northrop-mall", desiredOf({ headingDeg: 18 }));
    let release: (ok: boolean) => void = () => {};
    host.setLoad(() => new Promise(resolve => { release = resolve; }));
    const pending = host.load("minneapolis/scene.json", false);
    host.setStatus(status({ generation: 9 }));
    expect(host.edits.get("northrop-mall")?.headingDeg).not.toBe(18);
    release(false);
    await pending;
    expect(host.edits.get("northrop-mall")?.headingDeg).toBe(18);
    expect(host.overrides.scene()?.sceneId).toBe("umn-twin-cities");
    expect(host.overrides.record("northrop-mall")?.imagePose.headingDeg).toBe(18);
  });

  it("does not loop when applying a pose notifies status, and does not replay over a drag", async () => {
    const host = harness();
    await host.load();
    const before = host.repositioned.length;
    host.overrides.setNumbers("northrop-mall", desiredOf({ headingDeg: 6 }));
    const afterFirst = host.repositioned.length;
    expect(afterFirst).toBe(before + 1);
    host.setStatus(status());
    expect(host.repositioned.length).toBe(afterFirst);
    host.overrides.setNumbers("northrop-mall", desiredOf({ headingDeg: 7 }));
    expect(host.edits.get("northrop-mall")?.headingDeg).toBe(7);
  });

  it("keeps a session edit after the scene generation changes when storage cannot persist it", async () => {
    const storage: PoseStorage = {
      getItem: () => null,
      setItem: () => { throw new Error("full"); },
      removeItem: () => { throw new Error("full"); },
    };
    const host = harness({ storage });
    await host.load();
    host.overrides.setNumbers("northrop-mall", desiredOf({ headingDeg: 21 }));
    expect(host.overrides.status().persistence).toBe("session");
    host.setLoad(async () => { host.setStatus(status({ revision: "rev-2", generation: 4 })); return true; });
    await host.load();
    expect(host.overrides.record("northrop-mall")?.imagePose.headingDeg).toBe(21);
    expect(host.edits.get("northrop-mall")?.headingDeg).toBe(21);
    expect(host.overrides.conflicts("northrop-mall")).not.toContain("revision");
  });

  it("retains an unknown id for export and marks an older authored baseline", async () => {
    const host = harness();
    host.store.setNumbers("umn-twin-cities", SCENE_URL, baselineOf("gone"), desiredOf({ headingDeg: 4 }), "memory");
    host.store.setNumbers("umn-twin-cities", SCENE_URL, baselineOf("northrop-mall"), desiredOf({ headingDeg: 9 }), "memory");
    await host.load();
    host.setStatus(status({ entries: [entry("northrop-mall", { pose: { headingDeg: 3, pitchDeg: 0, rollDeg: 0, aligned: false } })] }));
    expect(host.overrides.unknownIds()).toContain("gone");
    expect(host.edits.has("gone")).toBe(false);
    const exported = host.overrides.exportDocument("2026-10-14T22:30:00.000Z");
    expect(exported.text).toContain("gone");
    expect(exported.disclosures.join(" ")).toMatch(/gone/);
  });
});

function baselineOf(entityId: string): PublishedBaseline {
  return {
    entityId, title: entityId, revision: "rev-1", mode: "ground-relative",
    longitudeDeg: -93.23, latitudeDeg: 44.97, heightMeters: null, headingDeg: 0, pitchDeg: 0, rollDeg: 0,
    offsetM: 25, aligned: false, eastM: 0, northM: 0,
  };
}

function desiredOf(over: Partial<{ headingDeg: number; offsetM: number }> = {}) {
  return { mode: "ground-relative" as const, longitudeDeg: -93.23, latitudeDeg: 44.97, heightMeters: null, headingDeg: 0, pitchDeg: 0, offsetM: 25, ...over };
}
