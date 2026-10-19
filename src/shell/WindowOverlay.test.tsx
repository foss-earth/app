// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { ViewerTabsSnapshot } from "@foss-earth/sphere-image/panels";
import { SAVED_WORKSPACE_STORAGE_KEY } from "@foss-earth/ui/browser";
import { WindowOverlay } from "./WindowOverlay";

it.each([390, 1280])("remembers window sizes through map/photo transitions and reloads at %i px", async screenWidth => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("innerHeight", 1000);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(screenWidth);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const panel = this.classList.contains("foss-earth-dock-panel");
    const width = panel ? Number.parseFloat(this.style.width) || 300 : 300;
    const height = panel ? Number.parseFloat(this.style.height) || 30 : 60;
    return { x: 0, y: 0, left: 0, top: 0, width, height, right: width, bottom: height, toJSON() {} };
  });
  const values = new Map([[SAVED_WORKSPACE_STORAGE_KEY, JSON.stringify({
    primary: { tabs: ["map"], activeTab: "map", collapsed: false, width: 340, height: 280 },
    secondary: { tabs: [], activeTab: null, collapsed: false, width: 300, height: 320 },
  })]]);
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const mapTab = document.createElement("div"), rendererTab = document.createElement("div");
  const sphere = document.createElement("div"), photograph = document.createElement("p");
  sphere.className = "foss-earth-sphere-tab";
  photograph.className = "foss-earth-sphere-photograph";
  photograph.textContent = "Photograph description";
  sphere.append(photograph);
  let snapshot: ViewerTabsSnapshot = { title: null, onScreen: false };
  const listeners = new Set<() => void>();
  const sphereTabs = {
    sphere, settings: document.createElement("div"), getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    leave() {}, destroy() {},
  };
  const show = (title: string | null, onScreen = title !== null) => act(async () => {
    snapshot = { title, onScreen };
    for (const listener of listeners) listener();
  });
  const host = document.createElement("div"); document.body.append(host);
  let root = createRoot(host);
  const render = () => act(async () => root.render(<WindowOverlay
    getViewState={() => null} setViewState={() => {}} storage={storage}
    mapTab={mapTab} rendererTab={rendererTab} sphereTabs={sphereTabs}
    locationSearchProvider={async () => []}
  />));
  const phone = screenWidth === 390;
  const side = "left";
  const slot = "primary";
  const panel = () => host.querySelector<HTMLElement>(`.foss-earth-dock-panel[data-side="${side}"]`)!;
  const size = () => ({ width: panel().style.width, height: panel().style.height });
  const savedSize = () => {
    const saved = JSON.parse(values.get(SAVED_WORKSPACE_STORAGE_KEY)!)[slot];
    return { width: saved.width, height: saved.height };
  };
  try {
    await render();
    const initial = { width: "340px", height: "280px" };
    expect(size()).toEqual(initial);
    expect(document.documentElement.dataset.worldPresentation).toBe("overlay");
    expect(document.documentElement.dataset.worldEdges).toBe("flush");
    expect(document.documentElement.style.getPropertyValue("--foss-world-top")).toBe("");
    await show("Northrop", false);
    expect(panel().dataset.collapsed).toBe("false");
    expect(size()).toEqual(initial);
    await show("Northrop");
    expect(size()).toEqual(initial);
    expect(panel().querySelector(".foss-earth-tab-shell-selected .foss-earth-tab-button")!.textContent).toBe("Map");
    expect(host.querySelector('[aria-label="Close Northrop tab"]')).toBeNull();
    const grip = document.querySelector<HTMLElement>(`.foss-earth-dock-panel[data-side="${side}"] .foss-earth-dock-panel-resize-handle`)
      ?? document.querySelector<HTMLElement>('.foss-earth-dock-panel-resize-handle[data-lifted="true"]');
    expect(grip).not.toBeNull();
    const pointer = (type: string, clientX: number, clientY: number) => act(async () => {
      grip!.dispatchEvent(new PointerEvent(type, { button: 0, clientX, clientY, pointerId: 1, bubbles: true }));
    });
    await pointer("pointerdown", 200, Number.parseFloat(initial.height));
    await pointer("pointermove", 235, 360);
    await pointer("pointerup", 235, 360);
    const resized = { width: phone ? "390px" : "375px", height: "360px" };
    expect(size()).toEqual(resized);
    expect(savedSize()).toEqual({ height: 360, width: phone ? null : 375 });
    await show(null);
    expect(size()).toEqual(resized);
    await show("Another photograph with a longer description");
    await act(async () => { photograph.textContent = "A longer description. ".repeat(100); });
    expect(size()).toEqual(resized);
    await show(null);
    await act(async () => root.unmount());
    root = createRoot(host);
    await render();
    expect(size()).toEqual(resized);
    expect(document.documentElement.dataset.worldPresentation).toBe("overlay");
    expect(document.documentElement.dataset.worldEdges).toBe("flush");
    await show("Northrop", false);
    expect(size()).toEqual(resized);
    await show("Northrop");
    expect(size()).toEqual(resized);
    await show(null);
    expect(size()).toEqual(resized);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
  expect(listeners.size).toBe(0);
});


it("keeps a saved Native tab in place under the Component execution name", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const values = new Map([[SAVED_WORKSPACE_STORAGE_KEY, JSON.stringify({
    primary: { tabs: ["native"], activeTab: "native", collapsed: false, width: 340, height: 280 },
    secondary: { tabs: [], activeTab: null, collapsed: false, width: 300, height: 320 },
  })]]);
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<WindowOverlay getViewState={() => null} setViewState={() => {}} storage={storage}
      nativeSections={[{ id: "selection", title: "Global defaults", element: document.createElement("div") }]}
      locationSearchProvider={async () => []} />));
    expect(host.querySelector('[data-tab-id="native"]')?.textContent).toBe("Component execution");
    expect(host.textContent).toContain("Global defaults");
  } finally {
    await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
  }
});
