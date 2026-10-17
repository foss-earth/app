/** Earth browser composition. Providers own all world, device and image algorithms. */
import { bindEarthMapCache } from "./cacheCompatibility";
import { TransformNode } from "@babylonjs/core";
import { createImageSessionBroker, type ImageSessionLimits } from "@foss-earth/images";
import { type ImageTransferLimits } from "@foss-earth/images/browser";
import {
  bootstrapGlobeRenderer, createBrowserRendererHost, createBrowserRendererPlatform,
  whenMeshesReady, whenBorrowedDeviceSettled, type ImageUploadLimits,
} from "@foss-earth/renderer/babylon";
import { type RendererMode, type ReadinessPolicy, type ReadinessTimers } from "@foss-earth/renderer";
import { observeResourceTiming, readHeapBytes } from "@foss-earth/renderer/browser";
import { createMemorySource, createNetworkSource } from "@foss-earth/renderer/profiling";
import { ecefToGeodetic, retryDelayMs, type TerrainLoaderLimits } from "@foss-earth/engine";
import { createMapCache, mapCacheLimits, type AtlasImageryWorkerPort, type BoundedAtlasImageryLoaderOptions, type TerrainDecodeWorkerPort } from "@foss-earth/engine/browser";
import { createBrowserGlobeBindings, loadBrowserGlobeGoogleProviders } from "@foss-earth/engine/browser-globe";
import { createTerrainLightingAdapter, type GlobeRuntimeOptions } from "@foss-earth/engine/babylon";
import { createGlobeRuntimeBudgets } from "@foss-earth/engine/settings";
import {
  GROUND_LIGHT_TABLE, GROUND_LIGHT_SAMPLES, GROUND_LIGHT_LEAST_SINE,
  MERCATOR_MAX_LAT_DEG, NIGHT_RADIANCE_UNITS, groundLightAt,
} from "@foss-earth/sky";
import type { SettingsRegistry } from "@foss-earth/ui/settings";
import { composeEarthRuntime } from "./runtimeComposition";
import { createImmersiveFrames } from "./immersive/frames";
import { createEarthNativeResources, attemptEarthCleanup } from "./nativeResources";
import { gpuMemoryOwner, meterMapFetch, METERED_REQUEST_OWNERS, requestOwner } from "./resourceOwners";

type EarthSelections = Pick<GlobeRuntimeOptions,
  "googleApiKey" | "preferGoogleTiles" | "rasterBaseMap" | "getSurfaceHeightMeters" |
  "terrainSource" | "rasterImagery" | "onStatusChange" | "terrainPerformanceCapture" | "observations">;
export interface EarthBrowserRuntimeOptions extends EarthSelections {
  settings: SettingsRegistry;
  /** Compatibility selection; the host supplies the external world root. */
  simMode?: boolean;
  rendererForce?: RendererMode | null;
  /** The host projects its visible named resource controls into one session. */
  imageSessionLimits(): ImageSessionLimits;
  imageTransferLimits(): ImageTransferLimits;
  imageUploadLimits(): ImageUploadLimits;
  /** Exact registered controls read by the three resource-policy projections. */
  resourceParameterIds: readonly string[];
  terrainLoaderLimits(): TerrainLoaderLimits;
  terrainPreparation: GlobeRuntimeOptions["terrainPreparation"];
  readinessPolicy: ReadinessPolicy;
  describeMapTransfer: BoundedAtlasImageryLoaderOptions["describe"];
  mapPriority(): number;
  createWorker(): AtlasImageryWorkerPort | null;
  /** A terrain decode worker; null: terrain decodes on the page. */
  createTerrainWorker?(): TerrainDecodeWorkerPort | null;
  /** The most terrain decode workers at once. */
  terrainDecodeWorkers?(): number;
  framePreparation?: GlobeRuntimeOptions["framePreparation"];
  onFrameError(error: unknown): void;
  signal?: AbortSignal;
}

export async function createEarthBrowserRuntime(canvas: HTMLCanvasElement, options: EarthBrowserRuntimeOptions) {
  const settings = options.settings;
  const choice = settings.get("renderer.backend");
  const force = options.rendererForce ?? (choice === "webgpu" || choice === "webgl2" || choice === "webgl" ? choice : null);
  const page = window.location.href;
  // Both only observe while the frame budget measures.
  const network = createNetworkSource({
    observe: observeResourceTiming(window), owner: url => requestOwner(url, page), metered: METERED_REQUEST_OWNERS,
  });
  // Opened before the renderer, while the page is mostly idle: the first tile request waits for the saved index, and
  // on a slow phone each storage step otherwise waited out a long shader compile, holding that request about 2 s.
  const cache = createMapCache({ storage: () => window.caches, fetcher: meterMapFetch(window.fetch.bind(window), network, page),
    now: Date.now, Response, Request, Headers, ...mapCacheLimits(id => settings.get(id)) });
  cache.open().catch(() => { /* The first fetch meets the same failure. */ });
  const { renderer, scene } = await bootstrapGlobeRenderer(canvas, {
    force, antialias: settings.get("renderer.antialias") !== false,
    host: createBrowserRendererHost({ window, document }),
  }).catch((cause: unknown) => { throw new Error("Renderer device initialization failed", { cause }); });
  let composition: ReturnType<typeof composeEarthRuntime> | undefined;
  // A headset session takes these frames over while it presents.
  const immersive = createImmersiveFrames({
    requestFrame: callback => window.requestAnimationFrame(callback), cancelFrame: id => window.cancelAnimationFrame(id),
  });
  let broker: ReturnType<typeof createImageSessionBroker> | undefined;
  let native: ReturnType<typeof createEarthNativeResources> | undefined;
  let bindings: ReturnType<typeof createBrowserGlobeBindings> | undefined;
  let hostRetirement: Promise<void> | undefined;
  let detachRestore: (() => void) | undefined;
  const detachResourcePolicy: (() => void)[] = [];
  const startupRetirements = new Set<Promise<void>>();
  let disposed = false;
  let stage = "browser resource setup";
  const cancellation = new AbortController();
  const abortHost = () => { cancellation.abort(options.signal?.reason); composition?.destroy(); };
  options.signal?.addEventListener("abort", abortHost, { once: true });
  if (options.signal?.aborted) cancellation.abort(options.signal.reason);
  const disposeHost = () => {
    if (disposed) return;
    disposed = true;
    const failures: unknown[] = [];
    for (const release of [() => cancellation.abort(new DOMException("Earth host retired.", "AbortError")), ...detachResourcePolicy, () => detachRestore?.(),
      () => bindings?.retire(), () => native?.retire(),
      () => options.signal?.removeEventListener("abort", abortHost)]) {
      try { release(); } catch (error) { failures.push(error); }
    }
    hostRetirement = (async () => {
      const results = await Promise.allSettled([composition?.world.whenSettled(), bindings?.whenSettled(), native?.whenSettled(), ...startupRetirements]);
      for (const result of results) if (result.status === "rejected") failures.push(result.reason);
      // Owner decoders/model parsers completed before a final native marker.
      // This also covers commands submitted by Babylon rather than our uploader.
      try { await whenBorrowedDeviceSettled({ scene, observeDeviceLoss(listener) {
        const observer = renderer.engine.onContextLostObservable.add(listener);
        return () => { renderer.engine.onContextLostObservable.remove(observer); };
      }, onError: options.onFrameError }); } catch (error) { failures.push(error); }
      // Both real native drains completed. Every release is attempted after them.
      for (const release of [() => broker?.dispose(), () => scene.dispose(), () => renderer.engine.dispose()]) {
        try { release(); } catch (error) { failures.push(error); }
      }
      if (failures.length) throw new AggregateError(failures, "Earth browser retirement failed.");
    })();
    void hostRetirement.catch(error => { try { options.onFrameError(error); } catch { /* whenSettled retains the original failure. */ } });
  };
  try {
    cancellation.signal.throwIfAborted();
    settings.setDeviceContext({ rendererMode: renderer.mode,
      maxTextureSize: renderer.engine.getCaps().maxTextureSize,
      rendererDevicePixels: renderer.devicePixels ?? null,
    });
    const clock: GlobeRuntimeOptions["clock"] = {
      nowMs: () => performance.now(),
      after(callback, delayMs) { const id = window.setTimeout(callback, delayMs); return () => window.clearTimeout(id); },
    };
    const timers: ReadinessTimers = {
      setTimeout: (callback, ms) => window.setTimeout(callback, ms),
      clearTimeout: handle => window.clearTimeout(handle as number),
    };
    const createCanvas = (width: number, height: number) => {
      const surface = document.createElement("canvas"); surface.width = width; surface.height = height; return surface;
    };
    const memory = createMemorySource({ heapBytes: readHeapBytes(window) });
    detachResourcePolicy.push(bindEarthMapCache(cache));
    const imageBroker = broker = createImageSessionBroker(options.imageSessionLimits());
    const resources = native = createEarthNativeResources({ broker: imageBroker, scene,
      limits: options.imageUploadLimits, createCanvas, wakeWork: () => composition?.scheduler.requestWork(),
      after: clock.after,
      observeDeviceLoss(listener) {
        const observer = renderer.engine.onContextLostObservable.add(listener);
        return () => { renderer.engine.onContextLostObservable.remove(observer); };
      },
      signal: cancellation.signal, onRetirementError: options.onFrameError,
      invalidatePublishedSource(failure) { imageBroker.invalidate(); options.onFrameError(failure.error); },
    });
    const updateResources = () => {
      if (disposed) return;
      try {
        attemptEarthCleanup([
          () => imageBroker.setLimits(options.imageSessionLimits()),
          () => resources.uploader.setLimits(options.imageUploadLimits()),
        ], "Earth resource policy update failed.");
        composition?.scheduler.requestWork();
      } catch (error) { options.onFrameError(error); }
    };
    for (const id of new Set(options.resourceParameterIds)) {
      if (!settings.has(id)) throw new Error(`Resource policy parameter ${id} is not registered.`);
      detachResourcePolicy.push(settings.watch(id, updateResources));
    }
    const lighting = createTerrainLightingAdapter({ GROUND_LIGHT_TABLE, GROUND_LIGHT_SAMPLES,
      GROUND_LIGHT_LEAST_SINE, MERCATOR_MAX_LAT_DEG, NIGHT_RADIANCE_UNITS, groundLightAt });
    stage = "Google native provider acquisition";
    const googleProviders = await loadBrowserGlobeGoogleProviders();
    cancellation.signal.throwIfAborted();
    bindings = createBrowserGlobeBindings({
      renderer, scene, broker: imageBroker, native: resources, settings, clock, timers, googleProviders,
      readinessPolicy: options.readinessPolicy, cache, lighting,
      realm: { window, document, AbortController, AbortSignal, DOMException, Blob, URL, Response, TransformStream,
        Node, Element, HTMLInputElement, WheelEvent, Event, performance },
      imageTransferLimits: options.imageTransferLimits, terrainLoaderLimits: options.terrainLoaderLimits,
      describeMapTransfer: options.describeMapTransfer, mapPriority: options.mapPriority, createWorker: options.createWorker,
      createTerrainWorker: options.createTerrainWorker, terrainDecodeWorkers: options.terrainDecodeWorkers,
      createCanvas, decode: (bytes, mimeType) => createImageBitmap(new Blob([
        new Uint8Array(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength),
      ], { type: mimeType }), { colorSpaceConversion: "default", premultiplyAlpha: "none" }),
      signal: cancellation.signal, onError: options.onFrameError, log: console, managedAtlas: resources.managedAtlas,
    });
    cancellation.signal.throwIfAborted();
    const ports = bindings;
    stage = "world and sky composition";
    const pagePlatform = createBrowserRendererPlatform({ window, document, canvas });
    composition = composeEarthRuntime({ canvas, renderer, scene, settings, clock,
      frames: immersive.port, presentsEveryFrame: () => immersive.presenting,
      isHidden: () => immersive.isHidden(() => document.hidden), fatalFramePolicy: "stop", onFrameError: options.onFrameError,
      resourceWork: resources.resourceWork, disposeHost, whenHostSettled: async () => { await hostRetirement; },
      onWorldStartupRetirement(drain) { startupRetirements.add(drain); },
      gpuMemoryOwner,
      presentation: { platform: { ...pagePlatform,
        onVisibilityChange: listener => immersive.onVisibilityChange(change => pagePlatform.onVisibilityChange(change), listener) }, timers,
        readinessPolicy: options.readinessPolicy, onDeviceLost: resources.observedDeviceLoss,
      },
      world: {
        googleApiKey: options.googleApiKey, preferGoogleTiles: options.preferGoogleTiles,
        rasterBaseMap: options.rasterBaseMap, getSurfaceHeightMeters: options.getSurfaceHeightMeters,
        terrainSource: options.terrainSource, rasterImagery: options.rasterImagery ?? "atlas",
        onStatusChange: options.onStatusChange, terrainPerformanceCapture: options.terrainPerformanceCapture,
        observations: options.observations, framePreparation: options.framePreparation,
        external: options.simMode ? { worldRoot: new TransformNode("sim-world-root", scene) } : undefined,
        terrainPreparation: options.terrainPreparation, budgets: createGlobeRuntimeBudgets(settings), log: console,
        platform: ports.platform,
        mapPorts: ports.mapPorts,
      },
      sky: { ecefToGeodetic, now: Date.now,
        timers: { set: (callback, delayMs) => window.setTimeout(callback, delayMs), clear: id => window.clearTimeout(id) },
        terrain: ports.skyTerrain,
        nightTilePorts: { ...ports.nightTilePorts, retryDelayMs },
      },
    });
    stage = "presentation lifecycle subscription";
    detachRestore = composition.presentation.onDeviceRestored(resources.restoreManagedDevice);
    const streams = composition.profile.streams;
    const sky = composition.sky;
    detachResourcePolicy.push(streams.register(network), streams.register(memory),
      memory.track("images/encoded", () => imageBroker.pools.stats().encoded.reserved, { inHeap: true }),
      memory.track("images/decoded", () => imageBroker.pools.stats().decoded.reserved),
      memory.track("sky/tables", () => sky.getEnvironment()?.cost.tableBytes ?? null, { inHeap: true }),
      memory.track("sky/night lights", () => sky.getNightLights()?.state.memoryBytes ?? null, { inHeap: true }));
    stage = "initial surface and sky readiness";
    // Parallel shader compilation can leave the first frames uniformly clear.
    // Publish startup only after its visible content can draw; streamed hidden
    // terrain and imagery keep their existing independent readiness paths.
    const startup = new AbortController();
    const cancelStartupDeadline = clock.after(() => {
      startup.abort(new Error("Initial visible content did not become ready within 10 seconds."));
    }, 10_000);
    try {
      await whenMeshesReady(scene.meshes.filter(mesh => mesh.isEnabled() && mesh.isVisible), {
        signal: AbortSignal.any([startup.signal, cancellation.signal]), timers, readinessPolicy: options.readinessPolicy,
      });
    } finally { cancelStartupDeadline(); }
    composition.scheduler.requestRender();
    // Retain live status/camera getters owned by Engine instead of snapshotting them.
    const runtime = Object.create(composition.world) as typeof composition.world;
    Object.defineProperty(runtime, "destroy", { value: () => composition!.destroy() });
    return { runtime, composition, immersive, broker: imageBroker, native: resources, files: ports.files, cache, clock, timers,
      bindings: ports, signal: cancellation.signal, async whenSettled() { await composition!.whenSettled(); await hostRetirement; } };
  } catch (error) {
    try {
      // A post-composition subscription can fail too: release owner callbacks
      // and the scheduler before disposing their borrowed host resources.
      if (composition) composition.destroy(); else disposeHost();
      await hostRetirement;
    } catch (cleanup) { throw new AggregateError([error, cleanup], "Earth browser setup failed."); }
    throw new Error(`Earth ${stage} failed`, { cause: error });
  }
}
