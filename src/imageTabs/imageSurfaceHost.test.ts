// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BaseTexture } from "@babylonjs/core";
import { createImageSessionBroker, MIB } from "@foss-earth/images";
import type { RectangleSurfaceDraw } from "@foss-earth/image-viewer/babylon";
import type { SurfaceGeometry } from "@foss-earth/ui/browser";
import type { WindowSideSnapshot, WindowSlotId, WindowWorkspaceSnapshot } from "@foss-earth/ui/windowing";
import { OPEN_IMAGE_TAB, type ImageDocumentDescription } from "./imageDocuments";
import { createImageSurfaceHost, IMAGE_SURFACE_KEYS, type ImageSurfaceHost } from "./imageSurfaceHost";
import type { RectangleImageSourceLoader } from "./imageSources";

const description = (assetKey: string, width = 400, height = 300): ImageDocumentDescription => ({
  assetKey, revision: `${width}x${height}:100`, title: assetKey, source: { kind: "url", url: `https://example.org/${assetKey}.png` },
  width, height, mimeType: "image/png", encodedBytes: 100,
});
const side = (tabs: string[], extra: Partial<WindowSideSnapshot<string>> = {}): WindowSideSnapshot<string> =>
  ({ tabs, activeTab: tabs.at(-1) ?? null, collapsed: false, contextHidden: [], ...extra });
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

function setup(options: { ratio?: number; keptGpuBytes?: number } = {}) {
  const ratio = options.ratio ?? 2;
  const broker = createImageSessionBroker({ pools: { sourceGpu: 256 * MIB, decoded: 256 * MIB, encoded: 64 * MIB, uploadOutstanding: 16 * MIB, overlap: 128 * MIB }, requests: 2, decodes: 1 });
  const geometry: SurfaceGeometry = { revision: 1, cssRect: { x: 0, y: 0, width: 800, height: 600 },
    framebufferRect: { x: 0, y: 0, width: 800 * ratio, height: 600 * ratio }, pixelsPerCssX: ratio, pixelsPerCssY: ratio, visible: true };
  let read: (() => RectangleSurfaceDraw | null) | null = null;
  const beforeRender = new Set<() => void>(), lost = new Set<() => void>(), restored = new Set<() => void>();
  const loads: string[] = [], disposed: string[] = [];
  const load: RectangleImageSourceLoader = async (document, scope) => {
    loads.push(document.assetKey);
    return { texture: { texture: { name: document.assetKey } as unknown as BaseTexture, width: document.width, height: document.height },
      gpuBytes: 4 * document.width * document.height, isCurrent: () => scope.isCurrent(),
      dispose: () => { disposed.push(document.assetKey); }, settleReplacement() {} };
  };
  let now = 0;
  const host = createImageSurfaceHost({
    window, canvas: document.createElement("canvas"), load,
    renderer: { unavailableReason: null, addSurface(next) { read = next; return { dispose() { read = null; } }; } },
    observeGeometry: () => ({ read: () => geometry, refresh: () => geometry, subscribe: () => () => {}, dispose() {} }),
    onBeforeRender(callback) { beforeRender.add(callback); return () => { beforeRender.delete(callback); }; },
    requestRender() {}, nowMs: () => now, inputMode: () => "mouse", safariGestures: false,
    onDeviceLost(listener) { lost.add(listener); return () => { lost.delete(listener); }; },
    onDeviceRestored(listener) { restored.add(listener); return () => { restored.delete(listener); }; },
    keptGpuBytes: options.keptGpuBytes ?? 0,
    discovery: { broker, limits: () => ({ responseBytes: MIB, timeoutMs: 1000 }), fetch: vi.fn() as unknown as typeof fetch, maxTextureSide: () => 4096, baseUrl: "https://earth.example/" },
  });
  let snapshot: WindowWorkspaceSnapshot<string> = { revision: 0, primary: side([]), secondary: side([]), focusedSide: null, compact: false, contextActive: false };
  const listeners = new Set<() => void>();
  const opened: [string, WindowSlotId][] = [];
  const set = (next: Partial<WindowWorkspaceSnapshot<string>>) => {
    snapshot = { ...snapshot, ...next, revision: snapshot.revision + 1 };
    for (const listener of [...listeners]) listener();
  };
  host.bindWorkspace({
    workspace: { getSnapshot: () => snapshot, subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; } },
    openTabInSlot(tabId, slotId) { opened.push([tabId, slotId]); },
  });
  const surface = document.createElement("div");
  surface.tabIndex = 0;
  surface.setAttribute("data-takes-keys", IMAGE_SURFACE_KEYS);
  document.body.append(surface);
  const detach = host.attachSurface(surface);
  return { host, broker, set, opened, loads, disposed, surface, detach,
    draw: () => read?.() ?? null,
    frame(ms: number) { now += ms; for (const callback of [...beforeRender]) callback(); },
    loseDevice() { broker.invalidate(); for (const listener of [...lost]) listener(); },
    restoreDevice() { for (const listener of [...restored]) listener(); } };
}

let current: ReturnType<typeof setup> | null = null;
const open = (host: ImageSurfaceHost, assetKey: string, width?: number, height?: number) => host.registry.open(description(assetKey, width, height)).tabId;
afterEach(() => { current?.host.dispose(); current?.surface.remove(); current = null; });

describe("image surface host", () => {
  it("loads the selected image once and draws it fitted, from its tab's side", async () => {
    const t = current = setup();
    const a = open(t.host, "a");
    t.set({ primary: side(["location", a]) });
    await flush();
    expect(t.loads).toEqual(["a"]);
    const draw = t.draw()!;
    expect(draw.left?.source).toMatchObject({ width: 400, height: 300 });
    expect(draw.right).toBeNull();
    expect(draw.camera).toEqual({ scale: 2, x: 0, y: 0 });
    expect(t.host.getView()).toMatchObject({ presentation: "single", sides: [{ side: "left", title: "a", status: "ready" }] });
  });

  it("compares two images of one aspect with a wipe, and refuses two of different aspects without loading them", async () => {
    const t = current = setup();
    const a = open(t.host, "a"), b = open(t.host, "b", 800, 600), c = open(t.host, "c", 300, 300);
    t.set({ primary: side([a]), secondary: side([b]) });
    await flush();
    t.host.setWipe(0.25);
    const draw = t.draw()!;
    expect(draw.left?.source?.width).toBe(400);
    expect(draw.right?.source?.width).toBe(800);
    expect(draw.wipe).toBe(0.25);
    t.set({ secondary: side([b, c]) });
    await flush();
    expect(t.host.getView()).toMatchObject({ presentation: "incompatible", incompatibleReason: expect.stringContaining("aspect ratios differ") });
    expect(t.loads).toEqual(["a", "b"]);
    expect(t.draw()).toMatchObject({ left: { source: null }, right: null });
  });

  it("keeps the camera when the sides swap and refits only for another aspect", async () => {
    const t = current = setup();
    const a = open(t.host, "a"), b = open(t.host, "b", 800, 600);
    t.set({ primary: side([a]), secondary: side([b]) });
    await flush();
    t.host.native();
    const native = t.draw()!.camera;
    t.set({ primary: side([b]), secondary: side([a]) });
    expect(t.draw()!.camera).toEqual(native);
  });

  it("keeps a pair when the snapshot is marked compact", async () => {
    const t = current = setup();
    const a = open(t.host, "a"), b = open(t.host, "b");
    t.set({ primary: side([a]), secondary: side([b]), compact: true });
    await flush();
    expect(t.host.getView().presentation).toBe("pair");
    expect(t.loads.sort()).toEqual(["a", "b"]);
    expect(t.draw()).toMatchObject({ left: { source: { width: 400 } }, right: { source: { width: 400 } } });
  });

  it("shares one load between tabs of one document, and lets it go when the last closes", async () => {
    const t = current = setup();
    const a = open(t.host, "a");
    const copy = t.host.registry.duplicate(a)!.tabId;
    t.set({ primary: side([a]), secondary: side([copy]) });
    await flush();
    expect(t.loads).toEqual(["a"]);
    t.set({ primary: side([]), secondary: side([]) });
    await flush();
    expect(t.host.registry.getSnapshot().tabs).toEqual([]);
    expect(t.disposed).toEqual(["a"]);
  });

  it("keeps a recently shown image within the kept budget for switching back", async () => {
    const t = current = setup({ keptGpuBytes: 64 * MIB });
    const a = open(t.host, "a"), b = open(t.host, "b");
    t.set({ primary: side([a, b], { activeTab: a }) });
    await flush();
    t.set({ primary: side([a, b], { activeTab: b }) });
    await flush();
    t.set({ primary: side([a, b], { activeTab: a }) });
    await flush();
    expect(t.loads).toEqual(["a", "b"]);
    expect(t.disposed).toEqual([]);
  });

  it("waits through a lost device, then loads again", async () => {
    const t = current = setup();
    const a = open(t.host, "a");
    t.set({ primary: side([a]) });
    await flush();
    t.loseDevice();
    expect(t.draw()!.left?.source).toBeNull();
    expect(t.host.getView().sides[0].status).toBe("waiting");
    t.restoreDevice();
    await flush();
    expect(t.loads).toEqual(["a", "a"]);
    expect(t.draw()!.left?.source).not.toBeNull();
  });

  it("shows the focused source one texel per framebuffer pixel, and says what a framebuffer pixel is", async () => {
    const t = current = setup({ ratio: 2 });
    // Fitted, this image is drawn at one CSS pixel (two framebuffer pixels) per texel.
    const a = open(t.host, "a", 800, 600);
    t.set({ primary: side([a]) });
    await flush();
    expect(t.draw()!.camera.scale).toBe(1);
    t.host.native();
    expect(t.draw()!.camera.scale).toBe(0.5);
    expect(t.host.getView()).toMatchObject({ native: { scale: true, aligned: true }, pixelsPerTexel: 1,
      resolution: { pixelsPerCss: 2, devicePixelRatio: window.devicePixelRatio, displayPixels: window.devicePixelRatio === 2 } });
    t.host.fit();
    expect(t.host.getView().native).toMatchObject({ scale: false });
  });

  it("opens a new image beside the Open image tab", async () => {
    const t = current = setup();
    t.set({ secondary: side([OPEN_IMAGE_TAB]) });
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "broken.png");
    expect(await t.host.openFile(file)).toBe(false);
    expect(t.host.getView().opening.error).toContain("broken.png");
    expect(t.opened).toEqual([]);
    t.host.duplicate(open(t.host, "a"));
    expect(t.opened).toEqual([[expect.stringMatching(/^image:/), "primary"]]);
  });

  it("takes the arrow keys from the globe only while its surface has the focus", async () => {
    const t = current = setup();
    const a = open(t.host, "a");
    t.set({ primary: side([a]) });
    await flush();
    const before = t.draw()!.camera;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    t.frame(100);
    expect(t.draw()!.camera).toEqual(before);
    t.surface.focus();
    t.surface.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    t.frame(16);
    t.frame(100);
    expect(t.draw()!.camera.x).toBeLessThan(before.x);
    t.surface.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight", bubbles: true }));
    // A slider in the surface keeps its own arrows.
    const wipe = document.createElement("div");
    wipe.setAttribute("role", "slider");
    wipe.tabIndex = 0;
    t.surface.append(wipe);
    wipe.focus();
    const moved = t.draw()!.camera;
    wipe.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    t.frame(100);
    expect(t.draw()!.camera).toEqual(moved);
    // Escape hands the keys back.
    t.surface.focus();
    t.surface.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.activeElement).not.toBe(t.surface);
  });
});
