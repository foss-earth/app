import { describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import type { SceneController, SceneControllerState, SceneEntryStatus, SceneHandle, SceneStatus } from "@foss-earth/scenes/browser";
import { createLinkOverrides, LINK_STORAGE_KEY, linkGeometry, parseLinkDocument, type ImageLink } from "./linkOverrides";
import { createLinkEditor } from "./editor";

function harness(options: { storage?: Storage | null; sceneId?: string; authored?: Record<string, string[]>; latitude?: Record<string, number> } = {}) {
  const dom = new JSDOM("", { url: "https://tour.example/" });
  const storage = options.storage === undefined ? dom.window.localStorage : options.storage;
  const listeners = new Set<(state: SceneControllerState) => void>();
  let status: SceneStatus | null = null, handle: SceneHandle | null = null;
  const authoredLinks = (id: string) => (options.authored?.[id] ?? []).map(target => ({ id: `image-link-${target}`, label: target.toUpperCase(), target, enabled: true, placed: true }));
  const entry = (id: string, latitudeDeg: number): SceneEntryStatus => ({ id, title: id.toUpperCase(), supported: true, description: null, message: null,
    placement: "placed", preview: "ready", marker: null, capture: { longitudeDeg: -93, latitudeDeg: options.latitude?.[id] ?? latitudeDeg, heightMeters: 200, horizontalAccuracyMeters: null },
    pose: null, attribution: null, previewDetail: null, images: [], links: authoredLinks(id) });
  const state = (): SceneControllerState => ({ loading: null, status, errors: [] });
  const emit = () => { for (const listener of [...listeners]) listener(state()); };
  const enter = vi.fn(async () => ({ ok: true }));
  const setAdditionalLinks = vi.fn((id: string, links: ImageLink[]) => {
    const source = status?.entries.find(e => e.id === id);
    if (!source) return false;
    source.links = [...authoredLinks(id), ...links.filter(l => !options.authored?.[id]?.includes(l.target)).map(l => ({ ...l, id: `editor-link-${l.target}`, enabled: true, placed: !!l.direction }))]; emit(); return true;
  });
  const controller = {
    examples: [], state, handle: () => handle, subscribe(listener: (state: SceneControllerState) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    load: vi.fn(async () => {
      status = { sceneId: options.sceneId ?? "campus", revision: "r1", phase: "overview", active: null, target: null, entries: [entry("a", 45), entry("far", 45.1), entry("b", 45.001)], layers: [] } as unknown as SceneStatus;
      handle = { get status() { return status!; }, setAdditionalLinks, enter } as unknown as SceneHandle;
      emit(); return true;
    }),
  } as unknown as SceneController;
  const links = createLinkOverrides({ controller, baseUrl: "https://tour.example/", storage, exportPrefix: "umn-tour-links", nowIso: () => "2026-10-16T04:30:00.000Z" });
  return { dom, storage, controller, links, setAdditionalLinks, enter, state, emit };
}

describe("image link editing", () => {
  it("adds both directions, persists, exports and restores them without duplicating authored links", async () => {
    const f = harness(); await f.controller.load("scene.json");
    expect(f.links.add("a", "b", true)).toBe(true);
    expect(f.links.add("a", "b", true)).toBe(false);
    expect(f.links.count()).toBe(2);
    expect(f.links.additions("a")[0]).toMatchObject({ target: "b", direction: { headingDeg: 0, pitchDeg: 0 } });
    expect(f.links.additions("b")[0].direction?.headingDeg).toBeCloseTo(180);
    expect(f.links.exportDocument().filename).toBe("umn-tour-links-2026-10-16.json");
    expect(JSON.parse(f.links.exportDocument().text)).toMatchObject({ format: "foss-earth-link-overrides", scenes: [{ sceneUrl: "https://tour.example/scene.json" }] });
    f.links.dispose();
    const restored = harness({ storage: f.storage }); await restored.controller.load("scene.json");
    expect(restored.state().status?.entries[0].links).toMatchObject([{ target: "b" }]);
    restored.links.remove("a", "b"); expect(restored.links.count()).toBe(1);
    expect(restored.state().status?.entries[0].links).toEqual([]);
    restored.links.reset(); expect(restored.links.count()).toBe(0); restored.links.dispose();
  });
  it("forgets saved additions once the scene authors them, keeping the rest", async () => {
    const f = harness(); await f.controller.load("scene.json");
    f.links.add("a", "b", true); f.links.add("a", "far", false); f.links.dispose();
    const published = harness({ storage: f.storage, authored: { a: ["b"], b: ["a"] } }); await published.controller.load("scene.json");
    expect(published.links.additions("a")).toMatchObject([{ target: "far" }]); expect(published.links.additions("b")).toEqual([]);
    expect(published.links.count()).toBe(1);
    expect(JSON.parse(published.storage!.getItem(LINK_STORAGE_KEY)!).scenes[0].edits).toMatchObject([{ entityId: "a", links: [{ target: "far" }] }]);
    const editor = createLinkEditor(published.dom.window.document, published.controller, published.links);
    const rows = [...editor.element.querySelectorAll("h3 ~ div")].map(row => row.textContent);
    expect(rows).toEqual(["BIn scene", "FARRemove"]);
    editor.destroy(); editor.destroy(); published.links.dispose();
  });
  it("points restored links at the destination as this scene places it", async () => {
    const f = harness(); await f.controller.load("scene.json"); f.links.add("a", "b", false); f.links.dispose();
    expect(f.links.additions("a")[0].direction?.headingDeg).toBeCloseTo(0);
    const moved = harness({ storage: f.storage, latitude: { b: 44.999 } }); await moved.controller.load("scene.json");
    expect(moved.setAdditionalLinks).toHaveBeenLastCalledWith("a", [expect.objectContaining({ target: "b", direction: expect.objectContaining({ headingDeg: expect.closeTo(180, 5) }) })]);
    moved.links.dispose();
  });
  it("keeps additions separate by scene URL and rejects self or missing destinations", async () => {
    const f = harness(); await f.controller.load("first.json");
    expect(f.links.add("a", "a", true)).toBe(false); expect(f.links.add("a", "missing", true)).toBe(false);
    f.links.add("a", "b", false); await f.controller.load("other.json");
    expect(f.links.additions("a")).toEqual([]); expect(f.state().status?.entries[0].links).toEqual([]);
    await f.controller.load("first.json"); expect(f.links.additions("a")).toHaveLength(1); f.links.dispose();
  });
  it("retains session edits when storage fails or another tab writes, without overwriting saved data", async () => {
    const f = harness(); await f.controller.load("scene.json");
    f.storage!.setItem(LINK_STORAGE_KEY, "another tab"); f.links.add("a", "b", true);
    expect(f.links.count()).toBe(2); expect(f.storage!.getItem(LINK_STORAGE_KEY)).toBe("another tab"); expect(f.links.note()).toContain("another tab");
    f.links.dispose();
    const session = harness({ storage: null }); await session.controller.load("scene.json"); session.links.add("a", "b", false);
    expect(session.links.note()).toContain("session"); expect(JSON.parse(session.links.exportDocument().text).scenes[0].edits).toHaveLength(1); session.links.dispose();
  });
  it("rejects corrupt, duplicate and credential-bearing storage without replacing it", async () => {
    const f = harness(); await f.controller.load("scene.json"); f.links.add("a", "b", false);
    const valid = JSON.parse(f.links.exportDocument().text);
    expect(parseLinkDocument(JSON.stringify(valid))).not.toBeNull();
    const invalid = structuredClone(valid); invalid.scenes[0].edits[0].links[0].target = "a";
    expect(parseLinkDocument(JSON.stringify(invalid))).toBeNull();
    invalid.scenes[0].sceneUrl = "https://user:secret@tour.example/scene.json"; expect(parseLinkDocument(JSON.stringify(invalid))).toBeNull();
    valid.scenes.push(valid.scenes[0]); expect(parseLinkDocument(JSON.stringify(valid))).toBeNull();
    f.links.dispose(); f.storage!.setItem(LINK_STORAGE_KEY, "broken");
    const broken = harness({ storage: f.storage }); await broken.controller.load("scene.json"); broken.links.add("a", "b", true);
    expect(broken.storage!.getItem(LINK_STORAGE_KEY)).toBe("broken"); expect(broken.links.note()).toContain("could not be read"); broken.links.dispose();
  });
  it("lists nearby targets first and adds and removes links through the tab", async () => {
    const f = harness(); await f.controller.load("scene.json");
    const editor = createLinkEditor(f.dom.window.document, f.controller, f.links); f.dom.window.document.body.append(editor.element);
    const target = editor.element.querySelector<HTMLSelectElement>('[aria-label="Link to image"]')!;
    expect(target.options[0].value).toBe("b");
    expect(target.options[0].textContent).toContain("111 m");
    const button = (text: string) => [...editor.element.querySelectorAll("button")].find(b => b.textContent === text)!;
    button("Add link").click(); expect(f.links.count()).toBe(2);
    expect(button("Add link").disabled).toBe(true);
    button("B").click(); expect(f.enter).toHaveBeenCalledWith("b");
    button("Remove").click(); expect(f.links.count()).toBe(1);
    editor.destroy(); f.links.dispose();
  });
  it("computes bearings across the date line and keeps coincident images finite", () => {
    const point = (longitudeDeg: number) => ({ longitudeDeg, latitudeDeg: 0, heightMeters: null });
    expect(linkGeometry(point(179.999), point(-179.999)).direction.headingDeg).toBeCloseTo(90);
    expect(linkGeometry(point(0), point(0))).toEqual({ distance: 0, direction: { headingDeg: 0, pitchDeg: 0 } });
  });
});
