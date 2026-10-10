/** Earth browser composition. Providers own all world, device and image algorithms. */
import { bindEarthMapCache } from "./cacheCompatibility";
import { TilesRenderer } from "3d-tiles-renderer/babylonjs";
import { GoogleCloudAuthPlugin } from "3d-tiles-renderer/core/plugins";
import { TransformNode } from "@babylonjs/core";
import { createImageSessionBroker, type ImageSessionLimits } from "@foss-earth/images";
import { createCanvasRgbaSurface, type ImageTransferLimits } from "@foss-earth/images/browser";
import {
  bootstrapGlobeRenderer, createBrowserRendererHost, createBrowserRendererPlatform,
  whenMeshesReady, type ImageUploadLimits,
} from "@foss-earth/renderer/babylon";
import { checkUntilSettled, type RendererMode, type ReadinessPolicy, type ReadinessTimers } from "@foss-earth/renderer";
import { createTerrainTileLoader, ecefToGeodetic, retryDelayMs, type TerrainLoaderLimits } from "@foss-earth/engine";
import {
  createAtlasImageryWorkerBridge, createBoundedAtlasImageryLoader, createMapCache,
  createTerrainImageDecoder, latestResourceTiming, measureMapResponse,
  type AtlasImageryWorkerPort, type BoundedAtlasImageryLoaderOptions,
} from "@foss-earth/engine/browser";
import { createBoundedMapTextureLoader, createTerrainLightingAdapter, hasPickablePointAt, type GlobeRuntimeOptions } from "@foss-earth/engine/babylon";
import {
  createGlobeRuntimeBudgets, createTerrainImageDecodeLimits,
  loadGlobeAnchorRotationPreference, saveGlobeAnchorRotationPreference,
} from "@foss-earth/engine/settings";
import {
  GROUND_LIGHT_TABLE, GROUND_LIGHT_SAMPLES, GROUND_LIGHT_LEAST_SINE,
  MERCATOR_MAX_LAT_DEG, NIGHT_RADIANCE_UNITS, groundLightAt,
} from "@foss-earth/sky";
import type { SettingsRegistry } from "@foss-earth/ui/settings";
import { composeEarthRuntime } from "./runtimeComposition";
import { createEarthNativeResources, attemptEarthCleanup } from "./nativeResources";

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
  framePreparation?: GlobeRuntimeOptions["framePreparation"];
  onFrameError(error: unknown): void;
}

export async function createEarthBrowserRuntime(canvas: HTMLCanvasElement, options: EarthBrowserRuntimeOptions) {
  const settings = options.settings;
  const choice = settings.get("renderer.backend");
  const force = options.rendererForce ?? (choice === "webgpu" || choice === "webgl2" || choice === "webgl" ? choice : null);
  const { renderer, scene } = await bootstrapGlobeRenderer(canvas, {
    force, antialias: settings.get("renderer.antialias") !== false,
    host: createBrowserRendererHost({ window, document }),
  }).catch((cause: unknown) => { throw new Error("Renderer device initialization failed", { cause }); });
  let composition: ReturnType<typeof composeEarthRuntime> | undefined;
  let broker: ReturnType<typeof createImageSessionBroker> | undefined;
  let native: ReturnType<typeof createEarthNativeResources> | undefined;
  let worker: ReturnType<typeof createAtlasImageryWorkerBridge> | undefined;
  let loader: ReturnType<typeof createBoundedAtlasImageryLoader> | undefined;
  let detachRestore: (() => void) | undefined;
  const detachResourcePolicy: (() => void)[] = [];
  let disposed = false;
  let stage = "browser resource setup";
  const disposeHost = () => {
    if (disposed) return;
    disposed = true;
    attemptEarthCleanup([
      ...detachResourcePolicy,
      () => detachRestore?.(), () => loader?.dispose(), () => worker?.dispose(),
      () => {
        const releaseDevice = () => attemptEarthCleanup([
          () => broker?.dispose(), () => scene.dispose(), () => renderer.engine.dispose(),
        ], "Earth borrowed device cleanup failed.");
        if (native) native.dispose(releaseDevice); else releaseDevice();
      },
    ], "Earth browser host cleanup failed.");
  };
  try {
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
    const cache = createMapCache({ storage: () => window.caches, fetcher: window.fetch.bind(window), now: Date.now, Response, Request, Headers });
    detachResourcePolicy.push(bindEarthMapCache(cache));
    const mapFetch: typeof fetch = (input, init) => typeof input === "string" ? cache.fetch(input, init)
      : input instanceof URL ? cache.fetch(input.href, init) : window.fetch(input, init);
    const imageBroker = broker = createImageSessionBroker(options.imageSessionLimits());
    const resources = native = createEarthNativeResources({ broker: imageBroker, scene,
      limits: options.imageUploadLimits, createCanvas, wakeWork: () => composition?.scheduler.requestWork(),
      after: clock.after,
      observeDeviceLoss(listener) {
        const observer = renderer.engine.onContextLostObservable.add(listener);
        return () => { renderer.engine.onContextLostObservable.remove(observer); };
      },
      onRetirementError: options.onFrameError,
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
    const bridge = worker = createAtlasImageryWorkerBridge({ broker: imageBroker,
      createWorker: options.createWorker,
      decode: (bytes, mimeType) => createImageBitmap(new Blob([
        new Uint8Array(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength),
      ], { type: mimeType }), { colorSpaceConversion: "default", premultiplyAlpha: "none" }),
      onError: options.onFrameError,
    });
    const files = bridge.createFileService({ limits: options.imageTransferLimits,
      priority: options.mapPriority, fetch: mapFetch, cache: null,
    });
    const imageryLoader = loader = createBoundedAtlasImageryLoader({ broker: imageBroker, files, worker: bridge,
      describe: options.describeMapTransfer, priority: options.mapPriority,
      createSurface: (width, height) => createCanvasRgbaSurface({ width, height, createCanvas }),
      onCleanupFailure: options.onFrameError,
    });
    const lighting = createTerrainLightingAdapter({ GROUND_LIGHT_TABLE, GROUND_LIGHT_SAMPLES,
      GROUND_LIGHT_LEAST_SINE, MERCATOR_MAX_LAT_DEG, NIGHT_RADIANCE_UNITS, groundLightAt,
    });
    const caps = renderer.engine.getCaps();
    const acquireMapTexture = createBoundedMapTextureLoader({ broker: imageBroker, files, uploader: resources.uploader,
      maxTextureSide: () => renderer.engine.getCaps().maxTextureSize,
      whenReady(texture, signal) {
        signal.throwIfAborted();
        return new Promise<void>((resolve, reject) => {
          let stop = () => {};
          const clear = () => { stop(); signal.removeEventListener("abort", abort); };
          const abort = () => { clear(); reject(signal.reason); };
          const settled = () => { clear(); resolve(); };
          signal.addEventListener("abort", abort, { once: true });
          try {
            if (texture.isReady()) settled();
            else stop = checkUntilSettled(1, () => texture.isReady() ? 0 : 1, settled, timers, options.readinessPolicy);
            if (signal.aborted) abort();
          } catch (error) { clear(); reject(error); }
        });
      },
    });
    stage = "world and sky composition";
    composition = composeEarthRuntime({ canvas, renderer, scene, settings, clock,
      frames: { requestFrame: callback => window.requestAnimationFrame(callback), cancelFrame: id => window.cancelAnimationFrame(id) },
      isHidden: () => document.hidden, fatalFramePolicy: "stop", onFrameError: options.onFrameError,
      resourceWork: resources.resourceWork, disposeHost,
      presentation: { platform: createBrowserRendererPlatform({ window, document }), timers,
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
        platform: {
          abortError: message => new DOMException(message, "AbortError"),
          input: { realm: { document, window, userAgent: navigator.userAgent,
            hasGestureEvent: "GestureEvent" in window, nowMs: clock.nowMs },
            loadGlobeAnchorRotationPreference: () => loadGlobeAnchorRotationPreference(settings),
            saveGlobeAnchorRotationPreference: enabled => saveGlobeAnchorRotationPreference(settings, enabled),
          },
          passToWorld: { realm: { window, Node, Element, HTMLInputElement, WheelEvent, Event,
            getComputedStyle: element => window.getComputedStyle(element), userAgent: navigator.userAgent,
            hasGestureEvent: "GestureEvent" in window, nowMs: clock.nowMs,
          } },
          hasPickablePointAt,
          navigation: { focusReturn: () => document.activeElement, createAbortController: () => new AbortController(),
            abortReason: reason => new DOMException(reason, "AbortError"),
          },
        },
        mapPorts: {
          setCacheLimits: limits => cache.setLimits(limits),
          raster: { attachTerrainLighting: material => lighting.createMaterialPlugin(material),
            asyncMapTextures: {
              resolve(source, _tile, url) {
                // Existing providers without a descriptor retain standard 256px
                // XYZ tiles. MIME and unknown encoded size come from the shared
                // validated response; neither is guessed from the URL.
                const dimensions = source.tileSize ?? { width: 256, height: 256 };
                return { file: { url, ...dimensions }, declaredBytes: 0, priority: options.mapPriority() };
              },
              acquire: acquireMapTexture, createAbortController: () => new AbortController(),
            },
            meshRebuildCpuMs: () => settings.get<number>("map.terrain.meshRebuildTimePerFrame"), log: console,
            imageryPorts: { device: resources.device, managedAtlas: resources.managedAtlas,
              restoreManagedDevice: resources.restoreManagedDevice,
              capabilities: { backend: renderer.mode, maxTextureSize: caps.maxTextureSize,
                explicitGradients: renderer.mode !== "webgl" || Boolean(caps.textureLOD && caps.standardDerivatives) },
              loader: imageryLoader, createAbortController: () => new AbortController(),
            },
            createTerrainLoader(source, onBytes, trackMemory, onPreparationMs) {
              return createTerrainTileLoader<Blob, AbortSignal>({ source, onBytes, trackMemory,
                limits: options.terrainLoaderLimits,
                decode: createTerrainImageDecoder({ createImageBitmap: (blob, decodeOptions) => createImageBitmap(blob, decodeOptions),
                  createCanvas, nowMs: clock.nowMs, limits: createTerrainImageDecodeLimits(settings), onDecodeCpu: onPreparationMs,
                }),
                ports: { createAbortController: () => new AbortController(),
                  requestSignal: (signal, timeoutMs) => AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
                  fetchTile: (url, signal) => cache.fetch(url, { signal, mode: "cors" }), byteLength: blob => blob.size,
                },
              });
            },
          },
          google: { createTilesRenderer: (url, borrowedScene) => new TilesRenderer(url, borrowedScene),
            createAuthPlugin: authOptions => new GoogleCloudAuthPlugin(authOptions),
            createAbortController: () => new AbortController(), combineSignals: signals => AbortSignal.any([...signals]),
            whenMeshesReady: (meshes, readyOptions = {}) => whenMeshesReady(meshes, { ...readyOptions, timers, readinessPolicy: options.readinessPolicy }),
            lighting, responseRealm: { Response, TransformStream }, recordMapRequest: url => cache.recordBrowserRequest(url),
            resourceTiming: url => latestResourceTiming(url, performance.getEntriesByType("resource")),
            online: () => navigator.onLine, origin: () => location.origin, log: console,
          },
        },
      },
      sky: { ecefToGeodetic, now: Date.now,
        timers: { set: (callback, delayMs) => window.setTimeout(callback, delayMs), clear: id => window.clearTimeout(id) },
        terrain: { setLighting: value => lighting.setTerrainLighting(scene, value),
          setLocalLights: value => { lighting.setTerrainLocalLights(scene, value); },
        },
        nightTilePorts: { fetchTile: (url, init) => cache.fetch(url, init),
          measureResponse: (response, onBytes) => measureMapResponse(response, onBytes, { Response, TransformStream }),
          retryDelayMs, setNightLightMap: value => lighting.setTerrainNightLightMap(scene, value),
        },
      },
    });
    stage = "presentation lifecycle subscription";
    detachRestore = composition.presentation.onDeviceRestored(resources.restoreManagedDevice);
    // Retain live status/camera getters owned by Engine instead of snapshotting them.
    const runtime = Object.create(composition.world) as typeof composition.world;
    Object.defineProperty(runtime, "destroy", { value: () => composition!.destroy() });
    return { runtime, composition, broker: imageBroker, native: resources, files, cache, clock, timers };
  } catch (error) {
    try {
      // A post-composition subscription can fail too: release owner callbacks
      // and the scheduler before disposing their borrowed host resources.
      if (composition) composition.destroy(); else disposeHost();
    } catch (cleanup) { throw new AggregateError([error, cleanup], "Earth browser setup failed."); }
    throw new Error(`Earth ${stage} failed`, { cause: error });
  }
}
