// @vitest-environment jsdom
/** Real installed owners compose over a CPU device boundary. GPU behavior has
 * its separate real-browser receipt; no owner admission is mocked successful. */
import { NullEngine, Scene, Texture } from "@babylonjs/core";
import { createSettingsRegistry } from "@foss-earth/ui/settings";
import { frameProfilingParameters } from "@foss-earth/renderer/settings";
import { RASTER_BASE_MAP_SOURCES } from "@foss-earth/engine";
import type { GlobeRuntimeOptions, BoundedMapTexturePorts } from "@foss-earth/engine/babylon";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FOSS_EARTH_PARAMETERS } from "../settings/catalogue";
import { createEarthBrowserPolicy } from "./browserPolicy";
import { createEarthBrowserRuntime } from "./browserRuntime";

const observed = vi.hoisted(() => ({ bootstrap: vi.fn(), worlds: [] as GlobeRuntimeOptions[], maps: [] as BoundedMapTexturePorts[] }));
vi.mock("@foss-earth/renderer/babylon", async importOriginal => ({
  ...await importOriginal<typeof import("@foss-earth/renderer/babylon")>(),
  // Only replace actual GPU creation; native services/lifecycle remain public owners.
  bootstrapGlobeRenderer: observed.bootstrap,
  // NullEngine cannot perform GPU image uploads. This native boundary double
  // does no work until a test replaces upload; broker/file/admission stay real.
  createImageTextureUploader: () => ({
    upload: vi.fn(async () => { throw new Error("CPU contract needs an explicit native upload double."); }),
    pump: () => 0, busy: () => false, setLimits() {}, cancelAll() {},
    stats: () => ({ outstandingBytes: 0 }),
  }),
}));
vi.mock("@foss-earth/engine/babylon", async importOriginal => {
  const actual = await importOriginal<typeof import("@foss-earth/engine/babylon")>();
  return { ...actual,
    createGlobeRuntime(canvas: HTMLCanvasElement, options: GlobeRuntimeOptions) {
      observed.worlds.push(options); return actual.createGlobeRuntime(canvas, options);
    },
    createBoundedMapTextureLoader(ports: BoundedMapTexturePorts) {
      observed.maps.push(ports); return actual.createBoundedMapTextureLoader(ports);
    },
  };
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); observed.worlds = []; observed.maps = []; });
async function host() {
  const engine = new NullEngine(), scene = new Scene(engine); engine.getCaps().maxTextureSize = 8192;
  observed.bootstrap.mockResolvedValue({ renderer: { engine, mode: "webgl2", requested: "webgl2" }, scene });
  vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  const png = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,2,0,0,0,1,8,6,0,0,0,0,0,0,0]);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(png, { headers: { "content-type": "image/png" } })));
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 2, height: 1, close: vi.fn() })));
  const settings = createSettingsRegistry({ storage: null }); settings.register(FOSS_EARTH_PARAMETERS);
  settings.register(frameProfilingParameters({ tab: "renderer", section: "performance" }));
  const canvas = document.createElement("canvas"); document.body.append(canvas);
  const policy = createEarthBrowserPolicy(settings), onFrameError = vi.fn();
  try {
    const session = await createEarthBrowserRuntime(canvas, { ...policy, settings, rendererForce: "webgl2",
      preferGoogleTiles: false, rasterBaseMap: RASTER_BASE_MAP_SOURCES[0], rasterImagery: "atlas", createWorker: () => null, onFrameError,
    });
    return { ...session, engine, scene, canvas, settings, onFrameError, dispose() { session.runtime.destroy(); canvas.remove(); } };
  } catch (error) { canvas.remove(); scene.dispose(); engine.dispose(); throw error; }
}
describe("Earth browser host over exact installed runtime contracts", () => {
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
    } finally { f.dispose(); }
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
    } finally { loaded?.dispose(); f.dispose(); }
    expect(f.broker.pools.live()).toEqual([]);
  });
  it("settles actual host readiness on demand and removes checks on abort", async () => {
    vi.useFakeTimers(); const f = await host(); const texture = new Texture(null, f.scene);
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
    } finally { texture.dispose(); f.dispose(); }
  });
});
