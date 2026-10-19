// @vitest-environment jsdom
/** Real installed owners compose over a CPU device boundary. GPU behavior has
 * its separate real-browser receipt; no owner admission is mocked successful. */
import { MeshBuilder, NullEngine, Scene, Texture } from "@babylonjs/core";
import { createSettingsRegistry } from "@foss-earth/ui/settings";
import { frameProfilingParameters } from "@foss-earth/renderer/settings";
import { RASTER_BASE_MAP_SOURCES } from "@foss-earth/engine";
import type { GlobeRuntimeOptions, BoundedMapTexturePorts } from "@foss-earth/engine/babylon";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FOSS_EARTH_PARAMETERS } from "../settings/catalogue";
import { createEarthBrowserPolicy } from "./browserPolicy";
import { createEarthBrowserRuntime } from "./browserRuntime";

const observed = vi.hoisted(() => {
  // The shared settings catalogue is imported by setup before these host mocks.
  vi.resetModules();
  return { bootstrap: vi.fn(), worlds: [] as GlobeRuntimeOptions[], maps: [] as BoundedMapTexturePorts[], googleCodeLoads: 0 };
});
vi.mock("@foss-earth/renderer/babylon", async importOriginal => {
  const actual = await importOriginal<typeof import("@foss-earth/renderer/babylon")>();
  return { ...actual,
  // Only replace actual GPU creation; native services/lifecycle remain public owners.
  bootstrapGlobeRenderer: observed.bootstrap,
  whenBorrowedDeviceSettled(options: Parameters<typeof actual.whenBorrowedDeviceSettled>[0]) {
    // NullEngine submits no native commands. Supply its completion boundary only
    // after all actual owner drains, retaining the real marker implementation.
    const engine = options.scene.getEngine();
    const previous = Object.getOwnPropertyDescriptor(engine, "_gl");
    Object.defineProperty(engine, "_gl", { value: { finish: vi.fn() }, configurable: true });
    try { return actual.whenBorrowedDeviceSettled(options); }
    finally {
      if (previous) Object.defineProperty(engine, "_gl", previous);
      else Reflect.deleteProperty(engine, "_gl");
    }
  },
  createNativeImageResources(options: Parameters<typeof import("@foss-earth/renderer/babylon")["createNativeImageResources"]>[0]) {
    return actual.createNativeImageResources({ ...options, createUploader: () => ({
      // NullEngine has no native image commands; tests supply this CPU boundary.
      upload: vi.fn(async () => { throw new Error("CPU contract needs an explicit native upload double."); }),
      pump: () => 0, busy: () => false, setLimits() {}, cancelAll() {},
      stats: () => ({ queuedJobs: 0, outstandingBytes: 0, lastFrameBytes: 0, uploadedBytes: 0,
        publishedCompletionFailures: 0, lastPublishedCompletionFailure: null }),
      async whenSettled() { /* No native work exists at this CPU boundary. */ },
    }) });
  },
}; });
vi.mock("@foss-earth/engine/babylon", async importOriginal => {
  const actual = await importOriginal<typeof import("@foss-earth/engine/babylon")>();
  return { ...actual,
    createGlobeRuntime(canvas: HTMLCanvasElement, options: GlobeRuntimeOptions) {
      observed.worlds.push(options); return actual.createGlobeRuntime(canvas, options);
    },

  };
});
vi.mock("@foss-earth/engine/browser-globe", async importOriginal => {
  const actual = await importOriginal<typeof import("@foss-earth/engine/browser-globe")>();
  return { ...actual,
    async loadBrowserGlobeGoogleProviders() {
      observed.googleCodeLoads++;
      return { createTilesRenderer() { throw new Error("CPU fixture must supply Google native work explicitly."); },
        createAuthPlugin() { throw new Error("CPU fixture must supply Google authentication explicitly."); } };
    },
    createBrowserGlobeBindings(options: Parameters<typeof actual.createBrowserGlobeBindings>[0]) {
    const binding = actual.createBrowserGlobeBindings(options);
    observed.maps.push({ broker: options.broker, files: binding.files, uploader: options.native.uploader,
      maxTextureSide: () => options.renderer.engine.getCaps().maxTextureSize, whenReady: binding.whenReady });
    return binding;
  } };
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); observed.worlds = []; observed.maps = []; observed.googleCodeLoads = 0; });
async function host(beforeRuntime?: (scene: Scene) => void, google: { googleApiKey?: string; preferGoogleTiles?: boolean } = {}) {
  const engine = new NullEngine(), scene = new Scene(engine); engine.getCaps().maxTextureSize = 8192;
  // NullEngine stores no GPU data and leaves raw textures unready by default.
  // The CPU native boundary completes those allocations explicitly.
  const createRawTexture = engine.createRawTexture.bind(engine);
  vi.spyOn(engine, "createRawTexture").mockImplementation((...args) => {
    const texture = createRawTexture(...args); texture.isReady = true; return texture;
  });
  observed.bootstrap.mockResolvedValue({ renderer: { engine, mode: "webgl2", requested: "webgl2" }, scene });
  vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  const png = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,2,0,0,0,1,8,6,0,0,0,0,0,0,0]);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(png, { headers: { "content-type": "image/png" } })));
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 2, height: 1, close: vi.fn() })));
  const settings = createSettingsRegistry({ storage: null }); settings.register(FOSS_EARTH_PARAMETERS);
  settings.register(frameProfilingParameters({ tab: "renderer", section: "performance" }));
  // Each core where it always ran: these contracts are startup and readiness, Node has no
  // workers, and the Google worker's adapter loads by a dynamic import fake timers do not await.
  settings.set("native.tier", "typescript");
  const canvas = document.createElement("canvas"); document.body.append(canvas);
  const policy = createEarthBrowserPolicy(settings), onFrameError = vi.fn();
  beforeRuntime?.(scene);
  try {
    const preparing = createEarthBrowserRuntime(canvas, { ...policy, settings, rendererForce: "webgl2",
      preferGoogleTiles: false, rasterBaseMap: RASTER_BASE_MAP_SOURCES[0], rasterImagery: "atlas", createWorker: () => null, onFrameError,
      ...google,
    });
    const session = await preparing;
    return { ...session, engine, scene, canvas, settings, onFrameError, async dispose() {
      session.runtime.destroy();
      await session.whenSettled(); canvas.remove();
    } };
  } catch (error) { canvas.remove(); scene.dispose(); engine.dispose(); throw error; }
}
describe("Earth browser host over exact installed runtime contracts", () => {
  it("starts the globe without the Google 3D Tiles code unless it starts on Google, and loads it once when Google asks", async () => {
    const f = await host();
    try {
      expect(observed.googleCodeLoads).toBe(0);
      const google = observed.worlds[0].mapPorts.google;
      const loading = google.ready?.();
      expect(loading).toBeInstanceOf(Promise);
      expect(google.ready?.()).toBe(loading);
      await loading;
      expect(google.ready?.()).toBeNull();
      expect(observed.googleCodeLoads).toBe(1);
      expect(() => google.createAuthPlugin({ apiToken: "fixture-only" } as Parameters<typeof google.createAuthPlugin>[0]))
        .toThrow("CPU fixture must supply Google authentication explicitly.");
    } finally { await f.dispose(); }
    // A key with another map preferred loads nothing more.
    const keyed = await host(undefined, { googleApiKey: " fixture-only ", preferGoogleTiles: false });
    try { expect(observed.googleCodeLoads).toBe(1); } finally { await keyed.dispose(); }
  });
  it("loads the Google 3D Tiles code before the globe where it starts on Google", async () => {
    const f = await host(undefined, { googleApiKey: "fixture-only", preferGoogleTiles: true });
    try {
      expect(observed.googleCodeLoads).toBe(1);
      expect(observed.worlds[0].mapPorts.google.ready?.()).toBeNull();
    } finally { await f.dispose(); }
  });
  it("publishes startup after visible content settles through the actual renderer readiness helper", async () => {
    vi.useFakeTimers();
    let ready: ReturnType<typeof vi.spyOn> | undefined;
    const clear = vi.spyOn(window, "clearTimeout"), schedule = vi.spyOn(window, "setTimeout");
    const pending = host(scene => {
      const mesh = MeshBuilder.CreateBox("startup-visible-content", {}, scene);
      ready = vi.spyOn(mesh, "isReady").mockReturnValue(false);
    });
    let published = false; void pending.then(() => { published = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(published).toBe(false); expect(ready).toHaveBeenCalled();
    const deadline = schedule.mock.results[schedule.mock.calls.findIndex(args => args[1] === 10_000)].value;
    ready!.mockReturnValue(true); await vi.advanceTimersByTimeAsync(100);
    const f = await pending;
    try {
      expect(published).toBe(true); expect(clear).toHaveBeenCalledWith(deadline);
      const reads = ready!.mock.calls.length;
      await vi.advanceTimersByTimeAsync(100);
      expect(ready).toHaveBeenCalledTimes(reads);
      expect(f.runtime.scene).toBe(f.scene); expect(f.onFrameError).not.toHaveBeenCalled();
    } finally { await f.dispose(); }
  });
  it("bounds initial readiness failure and releases the composed resource graph", async () => {
    vi.useFakeTimers(); let initialScene: Scene | undefined;
    const pending = host(scene => {
      initialScene = scene;
      const mesh = MeshBuilder.CreateBox("startup-never-ready", {}, scene);
      vi.spyOn(mesh, "isReady").mockReturnValue(false);
    });
    const failure = expect(pending).rejects.toThrow("Earth initial surface and sky readiness failed");
    await vi.advanceTimersByTimeAsync(10_000); await failure;
    expect(initialScene!.isDisposed).toBe(true);
    expect(initialScene!.getEngine().isDisposed).toBe(true);
  });
  it("admits the actual world/managed atlas using the host's single broker/device/scheduler", async () => {
    const f = await host();
    try {
      expect(observed.worlds).toHaveLength(1); expect(observed.maps).toHaveLength(1);
      expect(f.runtime.status.mode).toBe("raster-basemap");
      expect(f.runtime.scene).toBe(f.scene); expect(f.runtime.engine).toBe(f.engine);
      expect(observed.maps[0].broker).toBe(f.broker); expect(observed.maps[0].uploader).toBe(f.native.uploader);
      expect(observed.maps[0].files).toBe(f.files);
      expect(observed.worlds[0].mapPorts.raster.imageryPorts.managedAtlas).toBe(f.native.managedAtlas);
      expect(observed.worlds[0].mapPorts.raster.asyncMapTextures?.acquire).toBeTypeOf("function");
      f.runtime.prepareFrame(0);
      expect(f.runtime.getRasterDetailFeedback()?.support).toBe("ready");
      expect(f.onFrameError).not.toHaveBeenCalled();
    } finally { await f.dispose(); }
    expect(f.broker.pools.live()).toEqual([]); expect(f.engine.isDisposed).toBe(true);
  });
  it("uses reviewed dimensions and actual validated headers through the same bounded common services", async () => {
    const f = await host(); let loaded: Awaited<ReturnType<NonNullable<GlobeRuntimeOptions["mapPorts"]["raster"]["asyncMapTextures"]>["acquire"]>> | undefined;
    try {
      const ports = observed.worlds[0].mapPorts.raster.asyncMapTextures!;
      const source = { ...RASTER_BASE_MAP_SOURCES[0], tileSize: { width: 2, height: 1 } };
      const metadata = ports.resolve(source, { z: 0, x: 0, y: 0 }, "https://fixture.invalid/misleading.jpg");
      expect(metadata.file).toEqual({ url: "https://fixture.invalid/misleading.jpg", width: 2, height: 1 });
      const baseline = f.broker.pools.stats().sourceGpu.reserved;
      const texture = new Texture(null, f.scene); vi.spyOn(texture, "isReady").mockReturnValue(true);
      const upload = vi.spyOn(f.native.uploader, "upload").mockImplementation(async request => {
        expect(request.textureColor).toEqual({ useSRGBBuffer: false, gammaSpace: true });
        const ticket = request.reserveUpload(8, "CPU contract native boundary");
        try { return { kind: "2d", texture, width: 2, height: 1, levels: 2, gpuBytes: 12, complete: true, dispose() { texture.dispose(); } }; }
        finally { ticket.release(); }
      });
      loaded = await ports.acquire(metadata.file, { ...metadata, signal: new AbortController().signal });
      expect(upload).toHaveBeenCalledOnce(); expect(loaded.isCurrent()).toBe(true);
      expect(f.broker.pools.stats().sourceGpu.reserved).toBe(baseline + 12);
      loaded.dispose(); expect(f.broker.pools.stats().sourceGpu.reserved).toBe(baseline);
    } finally { loaded?.dispose(); await f.dispose(); }
    expect(f.broker.pools.live()).toEqual([]);
  });
  it("settles actual host readiness on demand and removes checks on abort", async () => {
    vi.useFakeTimers();
    const startup = host(); await vi.advanceTimersByTimeAsync(100);
    const f = await startup; const texture = new Texture(null, f.scene);
    const ready = vi.spyOn(texture, "isReady").mockReturnValue(false);
    try {
      const controller = new AbortController();
      const schedule = vi.spyOn(window, "setTimeout"), clear = vi.spyOn(window, "clearTimeout");
      const pending = observed.maps[0].whenReady(texture, controller.signal);
      const handle = schedule.mock.results.at(-1)!.value;
      expect(handle).toBeDefined();
      const rejection = expect(pending).rejects.toThrow("cancelled acquisition");
      controller.abort(new Error("cancelled acquisition")); await rejection;
      expect(clear).toHaveBeenCalledWith(handle);
      const abortedReads = ready.mock.calls.length;
      await vi.advanceTimersByTimeAsync(100);
      expect(ready).toHaveBeenCalledTimes(abortedReads);
      const settlement = observed.maps[0].whenReady(texture, new AbortController().signal);
      ready.mockReturnValue(true); await vi.advanceTimersByTimeAsync(f.settings.get<number>("renderer.readiness.firstCheck"));
      await settlement;
      const settledReads = ready.mock.calls.length;
      await vi.advanceTimersByTimeAsync(100);
      expect(ready).toHaveBeenCalledTimes(settledReads);
    } finally { texture.dispose(); await f.dispose(); }
  });
});
