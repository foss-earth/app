// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SceneController, SceneEntryStatus, ScenePlacement, SceneStatus } from "@foss-earth/scenes/browser";
import type { SpherePoseEdit } from "../sceneWorld";
import { mountPoseEditor, type PoseEditorHost } from "./editor";
import { poseEditTitle, requestPoseEditStop, setPoseEditTitle } from "./poseEditTab";
import { createPoseOverrides } from "./poseOverrides";
import { createPoseStore, type PoseStorage } from "./poseStore";

const BASE = "https://umn-vr.github.io/tour/";

function entry(id: string, title = "Northrop"): SceneEntryStatus {
  return {
    id, title, description: null, supported: true, message: null, placement: "placed", preview: "ready",
    marker: { mode: "ground-relative", eastM: 4, northM: 2, offsetM: 25, radiusMeters: 3, authoredRadius: false },
    capture: { longitudeDeg: -93.23, latitudeDeg: 44.97, heightMeters: null, horizontalAccuracyMeters: null },
    pose: { headingDeg: 0, pitchDeg: 0, rollDeg: 0, aligned: false },
    attribution: null, previewDetail: null, images: [], links: [],
  };
}

function sceneStatus(over: Partial<SceneStatus> = {}): SceneStatus {
  return {
    phase: "overview", active: null, target: null, sceneId: "umn-twin-cities", revision: "rev-1", title: "Twin Cities",
    generation: 1, hovered: null, entries: [entry("northrop-mall")], groups: [], layers: [], credits: [],
    overview: "none", warnings: [], renderingAvailable: true, unavailableReason: null, lastError: null, view: null, ...over,
  };
}

function placement(edit: SpherePoseEdit | null): ScenePlacement {
  return {
    state: "placed",
    placement: {
      marker: [edit?.longitudeDeg ?? -93.23, edit?.latitudeDeg ?? 44.97, edit?.offsetM ?? 25],
      radiusMeters: 3,
      content: [[edit?.headingDeg ?? 0, edit?.pitchDeg ?? 0, 0], [0, 1, 0], [0, 0, 1]],
      outline: null, hoverScale: 1,
    },
  };
}

function mounted(options?: { phase?: SceneStatus["phase"]; active?: string | null; url?: string }) {
  let current = sceneStatus({ phase: options?.phase ?? "overview", active: options?.active ?? null });
  const listeners = new Set<(state: { status: SceneStatus | null }) => void>();
  const edits = new Map<string, SpherePoseEdit | null>();
  const cleared: string[] = [];
  const controller = {
    examples: [{ id: "twin-cities", title: "Twin Cities", description: "", url: options?.url ?? "twin-cities/scene.json" }],
    state: () => ({ loading: null, errors: [], status: current }),
    handle: () => ({ pick: () => ["northrop-mall"] as string[] }),
    load: async () => true,
    unload() { current = null as unknown as SceneStatus; emit(); },
    consumePointerPress: vi.fn(),
    subscribe(listener: (state: { status: SceneStatus | null }) => void) {
      listeners.add(listener); listener({ status: current }); return () => listeners.delete(listener);
    },
    onFailure: () => () => {}, onProgress: () => () => {}, whenSettled: async () => {}, destroy() {},
  };
  function emit() { for (const listener of listeners) listener({ status: current }); }
  const values = new Map<string, string>();
  const storage: PoseStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: key => { values.delete(key); },
  };
  const store = createPoseStore({ storage, nowIso: () => "2026-10-14T22:28:00.000Z", nowMs: () => 0, schedule: run => { run(); return { cancel() {} }; } });
  const overrides = createPoseOverrides({
    baseUrl: BASE, controller: controller as unknown as SceneController,
    world: {
      setPoseEdit(id: string, edit: SpherePoseEdit | null) {
        if (edit === null) cleared.push(id);
        edits.set(id, edit);
        return placement(edit);
      },
      posePlacement: (id: string) => placement(edits.get(id) ?? null),
    },
    viewer: { reposition() {}, syncPresentedCamera() {} },
    persist: true, store,
  });
  const canvas = document.createElement("canvas");
  const tab = document.createElement("div");
  document.body.append(canvas, tab);
  const host: PoseEditorHost = {
    document, canvas, baseUrl: BASE, sceneUrl: () => overrides.scene()?.sceneUrl ?? null,
    controller: controller as unknown as SceneController, overrides, exportPrefix: "umn-tour-poses",
    viewer: { setImageOpacity() {} },
    world: { posePlacement: id => placement(edits.get(id) ?? null) },
    renderer: { cameraFrame: () => null },
    runtime: { getPresentationView: () => null, setPresentedWorldVisible() {}, syncPresentedCamera: () => false, requestRender() {} },
    beforeFrame: () => () => {}, afterFrame: () => () => {}, dragThresholdPx: () => 4, tab,
  };
  return { controller, overrides, store, canvas, tab, edits, cleared, emit, setStatus(next: SceneStatus) { current = next; emit(); }, host };
}

async function openEditor(options?: Parameters<typeof mounted>[0]) {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  const env = mounted(options);
  await env.controller.load("twin-cities", { exampleId: true });
  const editor = mountPoseEditor(env.host);
  return { ...env, editor };
}

function inputNamed(tab: HTMLElement, label: string): HTMLInputElement {
  const row = [...tab.querySelectorAll("label")].find(item => item.textContent?.includes(label));
  const input = row?.querySelector("input");
  if (!(input instanceof HTMLInputElement)) throw new Error(`Missing ${label}`);
  return input;
}

describe("placement editor", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", { configurable: true, value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      clear: () => values.clear(),
    } });
  });
  afterEach(() => {
    setPoseEditTitle(null);
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("undoes and redoes edits with shortcuts and discards redo after a new edit", async () => {
    const { editor, tab, overrides } = await openEditor({ phase: "immersive", active: "northrop-mall" });
    const heading = inputNamed(tab, "Heading");
    const change = (value: string) => { heading.value = value; heading.dispatchEvent(new Event("change")); };
    const shortcut = (shiftKey = false) => document.dispatchEvent(new KeyboardEvent("keydown", { key: "z", metaKey: true, shiftKey, bubbles: true, cancelable: true }));
    change("12");
    change("24");
    shortcut();
    expect(overrides.record("northrop-mall")?.imagePose.headingDeg).toBe(12);
    shortcut();
    expect(overrides.record("northrop-mall")).toBeNull();
    shortcut(true);
    expect(overrides.record("northrop-mall")?.imagePose.headingDeg).toBe(12);
    change("36");
    shortcut(true);
    expect(overrides.record("northrop-mall")?.imagePose.headingDeg).toBe(36);
    editor.dispose();
  });

  it("restores see-through on remount and after leaving the photograph", async () => {
    const env = await openEditor({ phase: "immersive", active: "northrop-mall" });
    const opacity = env.tab.querySelector<HTMLInputElement>('input[aria-label="See through"]')!;
    opacity.value = "65";
    opacity.dispatchEvent(new Event("input"));
    env.setStatus(sceneStatus());
    env.setStatus(sceneStatus({ phase: "immersive", active: "northrop-mall" }));
    expect(opacity.value).toBe("65");
    env.editor.dispose();
    const showWorld = vi.spyOn(env.host.runtime, "setPresentedWorldVisible");
    const restored = mountPoseEditor(env.host);
    expect(showWorld).toHaveBeenCalledWith(true);
    expect(env.tab.querySelector<HTMLInputElement>('input[aria-label="See through"]')!.value).toBe("65");
    restored.dispose();
  });

  it("selects the open photograph and does not reopen it after the tab stops editing", async () => {
    const { editor, setStatus, tab } = await openEditor({ phase: "immersive", active: "northrop-mall" });
    expect(poseEditTitle()).toBe("Northrop");
    expect(tab.textContent).toContain("Capture latitude");
    expect(tab.querySelector(".pose-editor-save")?.hasAttribute("hidden")).toBe(true);
    requestPoseEditStop();
    expect(poseEditTitle()).toBeNull();
    setStatus(sceneStatus({ phase: "immersive", active: "northrop-mall" }));
    expect(poseEditTitle()).toBeNull();
    editor.dispose();
    expect(poseEditTitle()).toBeNull();
  });

  it("rejects a blank number and accepts zero", async () => {
    const { editor, tab, overrides } = await openEditor({ phase: "immersive", active: "northrop-mall" });
    const latitude = inputNamed(tab, "Capture latitude");
    latitude.value = "";
    latitude.dispatchEvent(new Event("change"));
    expect(tab.textContent).toContain("Enter a number.");
    expect(overrides.record("northrop-mall")).toBeNull();
    latitude.value = "0";
    latitude.dispatchEvent(new Event("change"));
    expect(overrides.record("northrop-mall")?.capture.latitudeDeg).toBe(0);
    editor.dispose();
  });

  it("checks north only with a reference, and a later heading change clears that check", async () => {
    const { editor, tab, overrides } = await openEditor({ phase: "immersive", active: "northrop-mall" });
    const north = inputNamed(tab, "North checked");
    const reference = inputNamed(tab, "Checked against");
    north.checked = true;
    north.dispatchEvent(new Event("change"));
    expect(tab.textContent).toContain("Enter what you checked north against.");
    expect(overrides.record("northrop-mall")).toBeNull();
    reference.value = "Campus landmarks checked on the map";
    north.checked = true;
    north.dispatchEvent(new Event("change"));
    expect(overrides.record("northrop-mall")?.imagePose.aligned).toBe(true);
    expect(overrides.record("northrop-mall")?.verification.orientation?.checkedAgainst).toBe("Campus landmarks checked on the map");
    const heading = inputNamed(tab, "Heading");
    heading.value = "12";
    heading.dispatchEvent(new Event("change"));
    expect(overrides.record("northrop-mall")?.imagePose.aligned).toBe(false);
    expect(overrides.record("northrop-mall")?.verification.orientation).toBeNull();
    editor.dispose();
  });

  it("arms a touch long-press and consumes the press so the photograph does not also open", async () => {
    vi.useFakeTimers();
    const { editor, canvas, controller, tab } = await openEditor();
    canvas.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 7, pointerType: "touch", clientX: 12, clientY: 14, isPrimary: true, bubbles: true }));
    await vi.advanceTimersByTimeAsync(499);
    expect(controller.consumePointerPress).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(controller.consumePointerPress).toHaveBeenCalledWith(7);
    expect(poseEditTitle()).toBe("Northrop");
    expect(tab.textContent).toMatch(/display offsets/);
    editor.dispose();
    vi.useRealTimers();
  });

  it("downloads the latest edits without clearing them", async () => {
    const { editor, tab, overrides } = await openEditor({ phase: "immersive", active: "northrop-mall" });
    const created: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => { created.push(blob); return "blob:pose"; });
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    inputNamed(tab, "Heading").value = "15";
    inputNamed(tab, "Heading").dispatchEvent(new Event("change"));
    tab.querySelector<HTMLButtonElement>(".pose-editor-download")?.click();
    expect(tab.textContent).toContain("Download requested");
    expect(tab.textContent).not.toContain("File saved");
    expect(created[0]).toBeInstanceOf(Blob);
    expect(await created[0].text()).toContain("\"headingDeg\": 15");
    expect(tab.textContent).toMatch(/Download requested for umn-tour-poses-\d{4}-\d{2}-\d{2}\.json/);
    expect(overrides.record("northrop-mall")?.imagePose.headingDeg).toBe(15);
    editor.dispose();
    vi.unstubAllGlobals();
  });

  it("clears only the open scene on the second tap and leaves the editor's world pose to the host", async () => {
    const { editor, tab, overrides, cleared } = await openEditor({ phase: "immersive", active: "northrop-mall" });
    inputNamed(tab, "Heading").value = "9";
    inputNamed(tab, "Heading").dispatchEvent(new Event("change"));
    overrides.store.setNumbers("umn-minneapolis", "https://umn-vr.github.io/tour/minneapolis/scene.json", {
      entityId: "other", title: "Other", revision: "rev-1", mode: "ground-relative",
      longitudeDeg: -93.23, latitudeDeg: 44.97, heightMeters: null, headingDeg: 0, pitchDeg: 0, rollDeg: 0,
      offsetM: 25, aligned: false, eastM: 0, northM: 0,
    }, { mode: "ground-relative", longitudeDeg: -93.23, latitudeDeg: 44.97, heightMeters: null, headingDeg: 4, pitchDeg: 0, offsetM: 25 }, "now");
    tab.querySelector<HTMLButtonElement>(".pose-editor-clear")?.click();
    expect(overrides.record("northrop-mall")).not.toBeNull();
    tab.querySelector<HTMLButtonElement>(".pose-editor-clear")?.click();
    expect(overrides.record("northrop-mall")).toBeNull();
    expect(overrides.store.edit("umn-minneapolis", "https://umn-vr.github.io/tour/minneapolis/scene.json", "other")).not.toBeNull();
    const before = cleared.length;
    editor.dispose();
    expect(cleared.length).toBe(before);
  });
});
