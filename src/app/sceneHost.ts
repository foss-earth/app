/** Earth application composition: one supplied world, renderer and image session. */
import { bindEarthSceneMedia } from "./cacheCompatibility";
import { randomId } from "./randomId";
import {
  createBuiltInRepresentations, createViewerSelection, validateViewerAsset,
  type SettledPublishedImageViewer, type ViewerImageInput,
} from "@foss-earth/sphere-image";
import { createImageViewer, type ViewerSettings } from "@foss-earth/sphere-image/viewer";
import { createGlobeViewerProjection, createViewerSceneDescription } from "@foss-earth/sphere-image/globe";
import { createSphereRenderer } from "@foss-earth/sphere-image/babylon";
import { createViewerResources, type ComposedImageSource } from "@foss-earth/sphere-image/resources";
import { createViewerTabs } from "@foss-earth/sphere-image/panels";
import { VIEWER_EXPERIMENT_IDS } from "@foss-earth/sphere-image/settings";
import {
  createImageSourceCache, mediaGroup, MIB, ResourceCapacityError,
  type ImageRepresentation, type MediaGroup, type ImageEstimate,
} from "@foss-earth/images";
import {
  createImageFileService, createMediaStore, openIndexedDbBackend,
  type EncodedImageFile, type ImageFileService,
} from "@foss-earth/images/browser";
import { createPreviewSheetSources } from "@foss-earth/preview-sheets/browser";
import { createPreviewSheetsExtensionHook } from "@foss-earth/preview-sheets/scene-extension";
import { type TiledCubeRepresentationRecord } from "@foss-earth/sphere-tiled-cubemap";
import {
  createBrowserSceneHistory, createSceneController, createSavedImagesSection, loadScene,
  type SceneExample, type SceneFailure,
} from "@foss-earth/scenes/browser";
import { createScenesPanel, createSceneHotspots } from "@foss-earth/scenes/panel";
import { NAVIGATION_PRESENTATION_LAYER } from "@foss-earth/engine/babylon";
import { ecef } from "@foss-earth/engine";
import { worldViewportClientRect } from "@foss-earth/engine/browser";
import type { ReadinessPolicy } from "@foss-earth/renderer";
import type { SettingsRegistry } from "@foss-earth/ui/settings";
import type { createEarthBrowserRuntime } from "./browserRuntime";
import type { createEarthUiHost } from "./uiHost";
import {
  createEarthSceneWorld, createEarthViewerInput, createEarthViewerNavigation,
  earthViewerMath, earthViewerPoses,
} from "./sceneWorld";
import { attemptEarthCleanup } from "./nativeResources";
import { textureReadiness } from "./textureReadiness";
import { poseEditEnabled } from "./poseEditor/poseGate";
import { createPoseOverrides, openPoseStorage } from "./poseEditor/poseOverrides";
import { POSE_STORAGE_KEY } from "./poseEditor/poseStore";

export interface EarthSceneHostOptions {
  browser: Awaited<ReturnType<typeof createEarthBrowserRuntime>>;
  settings: SettingsRegistry;
  ui: ReturnType<typeof createEarthUiHost>;
  canvas: HTMLCanvasElement;
  examples: readonly SceneExample[];
  baseUrl: string;
  readinessPolicy: ReadinessPolicy;
  openSettings(): void;
  /** Filename prefix for a pose export. Defaults to `foss-earth-poses`. */
  poseExportPrefix?: string;
}

export function createEarthSceneHost(options: EarthSceneHostOptions) {
  const { browser, settings, ui, canvas } = options;
  const { runtime, broker } = browser;
  const document = canvas.ownerDocument;
  const window = document.defaultView;
  if (!window) throw new Error("Earth scenes require their canvas Window.");
  const n = (suffix: string): number => settings.get<number>(`scene.panorama.${suffix}`);
  const range = (suffix: string) => settings.get<{ min: number; max: number }>(`scene.panorama.${suffix}`);
  const count = (suffix: string, minimum = 1) => Math.max(minimum, Math.round(n(suffix)));
  const reducedMotion = () => settings.get("scene.panorama.reducedMotion") === "reduce" ||
    settings.get("scene.panorama.reducedMotion") === "system" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const detailCap = () => {
    const current = settings.inspect("scene.panorama.immersionWidth");
    return typeof current.value !== "number" || current.bounds && current.value >= current.bounds.max ? Infinity : current.value;
  };
  const maxTextureSide = () => runtime.engine.getCaps().maxTextureSize;
  const devicePixelsPerCss = () => 1 / runtime.engine.getHardwareScalingLevel();
  const appearance = () => ({ previewFovDeg: n("previewFov"),
    markerDiameterCssPx: range("markerDiameter"), hitTargetDiameterCssPx: n("hitTargetDiameter") });
  const viewerSettings = (): ViewerSettings => ({
    appearance: appearance(),
    look: { dragSensitivity: n("dragSensitivity"), swipeSensitivity: n("swipeSensitivity"),
      lookRate: n("lookRate"), zoomPerNotch: n("zoomPerNotch"), zoomRate: n("zoomRate"),
      pinchGain: n("pinchGain"), inertiaHalfLifeMs: n("inertiaHalfLife"),
      fovRangeDeg: range("verticalFovRange"), pitchRangeDeg: range("pitchRange"), reducedMotion: reducedMotion() },
    entryOrientation: settings.get("scene.panorama.entryOrientation") === "authored" ? "authored" : "geographic",
    entryFovDeg: typeof settings.get("scene.panorama.entryFov") === "number" ? n("entryFov") : null,
    flightDurationMs: !reducedMotion() && typeof settings.get("scene.panorama.flightDuration") === "number" ? n("flightDuration") : 0,
    expandDurationMs: n("expandDuration"), fadeDurationMs: n("fadeDuration"),
    reducedFadeDurationMs: n("reducedFadeDuration"), orientDurationMs: n("orientDuration"), hoverDurationMs: n("hoverDuration"),
    previewHoldMs: typeof settings.get("scene.panorama.previewHold") === "number" ? n("previewHold") * 1000 : null,
  });
  const representations = createBuiltInRepresentations(() => ({ tileMemoryBytes: n("tileMemoryMiB") * MIB,
    responseBytes: n("responseMiB") * MIB, requests: count("tileRequests"), waiting: count("tilesWaiting"),
    uploadOutstandingBytes: n("uploadOutstandingMiB") * MIB }));
  const owner = (representation: ImageRepresentation) => {
    const found = representations.find(candidate => candidate.hooks.projection === representation.projection);
    if (!found) throw new Error(`No representation owner for ${representation.projection}.`);
    return found;
  };
  const estimate = (representation: ImageRepresentation): ImageEstimate => owner(representation).hooks.estimate(representation as never, { maxTextureSide: maxTextureSide() });
  const density = (representation: ImageRepresentation) => owner(representation).faceTexels(representation as never);
  const imageName = (representation: ImageRepresentation) => representation.projection === "tiled-cube"
    ? `The ${(representation as TiledCubeRepresentationRecord).warp === "equi-angular" ? "equi-angular cube tiles" : "cube tiles"}`
    : representation.projection === "cube" ? `The ${density(representation)} px ${representation.role === "preview" ? "preview " : ""}cube`
      : `The ${density(representation) * 4} px image`;
  const cleanup: (() => void)[] = [];
  let disposed = false;
  let failure: ((event: SceneFailure) => void) | null = null;
  let viewer: SettledPublishedImageViewer;
  const retirementErrors: unknown[] = [];
  const report = (input: ViewerImageInput | null, kind: SceneFailure["kind"], error: unknown) => {
    const cause = error instanceof Error ? error.message : String(error);
    failure?.({ kind, sphere: input ? { id: input.id, title: input.title } : null,
      cause, message: input ? `${input.title}: ${cause}` : `Panoramas could not be drawn: ${cause}` });
  };
  try {
    const saved = createMediaStore({ open: () => openIndexedDbBackend(window.indexedDB), now: Date.now, maxBytes: n("savedMiB") * MIB });
    cleanup.push(bindEarthSceneMedia(saved));
    const decode = async (bytes: Uint8Array, mimeType: string) => {
      const grant = broker.pools.reserve("encoded", bytes.byteLength, "panorama native Blob input");
      if (!grant.ok) throw new ResourceCapacityError(grant.pool, grant.reason);
      try { return await window.createImageBitmap(new Blob([
        new Uint8Array(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength),
      ], { type: mimeType }), { colorSpaceConversion: "none", premultiplyAlpha: "none", imageOrientation: "from-image" }); }
      finally { grant.reservation.release(); }
    };
    const services = new Map<string, ImageFileService>();
    const service = (group: MediaGroup | null): ImageFileService => {
      if (group && services.has(group.id)) return services.get(group.id)!;
      const result = createImageFileService({ broker, limits: () => ({ responseBytes: n("responseMiB") * MIB, timeoutMs: n("requestTimeout") * 1000 }),
        priority: () => 10, fetch: window.fetch.bind(window), decode,
        cache: group ? { files: saved.files(group), settled: () => saved.settled() } : null });
      if (group) services.set(group.id, result);
      return result;
    };
    const sheetBodies = new WeakMap<EncodedImageFile, ImageFileService>();
    let cropCanvas: OffscreenCanvas | null = null;
    const sheets = createPreviewSheetSources({ broker,
      async obtain(file, declaredBytes, scope) {
        const files = service(file.mediaGroup), body = await files.obtain(file, declaredBytes, scope);
        sheetBodies.set(body, files); return body;
      },
      decode(body, file, scope) {
        const files = sheetBodies.get(body);
        if (!files) throw new Error("The sheet body belongs to another resource session.");
        sheetBodies.delete(body); return files.decode(body, file, scope);
      },
      async crop(image, x, y, width, height) {
        const grant = broker.pools.reserve("decoded", 4 * width * height, "preview crop canvas backing");
        if (!grant.ok) throw new ResourceCapacityError(grant.pool, grant.reason);
        let surface: OffscreenCanvas | HTMLCanvasElement | null = null;
        try {
        surface = typeof window.OffscreenCanvas === "function"
          ? (cropCanvas ??= new window.OffscreenCanvas(width, height)) : document.createElement("canvas");
        surface.width = width; surface.height = height;
        const context = surface.getContext("2d", { alpha: false }) as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
        if (!context) throw new Error("The browser gave no canvas to cut a preview sheet with.");
        context.globalCompositeOperation = "copy"; context.imageSmoothingEnabled = false;
        context.drawImage(image, x, y, width, height, 0, 0, width, height);
        if (surface instanceof window.HTMLCanvasElement) {
          try { return await window.createImageBitmap(surface, { colorSpaceConversion: "none", premultiplyAlpha: "none" }); }
          finally { surface.width = 0; surface.height = 0; }
        }
        return surface.transferToImageBitmap();
        } finally { if (surface) { surface.width = 0; surface.height = 0; } grant.reservation.release(); }
      },
    });
    cleanup.push(() => sheets.dispose());
    const cache = createImageSourceCache<ComposedImageSource>({ broker, keptGpuBytes: n("keptGpuMiB") * MIB,
      gpuBytes: source => source.gpuBytes });
    cleanup.push(() => cache.dispose());
    const current = (input: ViewerImageInput) => {
      const published = viewer?.describeImage?.(input.id);
      return published?.asset.id === input.asset.id && published.asset.revision === input.asset.revision
        ? viewer.currentSources(input.id) : { preview: null, shown: null };
    };
    const choice = createViewerSelection({ representations, maxTextureSide,
      viewportHeightDevicePx: () => worldViewportClientRect(canvas).height * devicePixelsPerCss(), current, imageName,
      parameters: () => ({ previewFaces: range("previewFaceRange"), previewFovDeg: n("previewFov"), previewDensity: n("previewDensity"),
        immersionWidth: detailCap(), immersionDensity: typeof settings.get("scene.panorama.immersionDensity") === "number" ? n("immersionDensity") : null,
        preference: settings.get("scene.panorama.representation") }),
      admissible(representation, overlap) {
        const bytes = estimate(representation).sourceGpu;
        const stats = broker.pools.stats();
        const fitsGpu = stats.sourceGpu.limit - stats.sourceGpu.reserved + cache.stats().keptGpuBytes >= bytes;
        const fitsOverlap = !overlap || stats.overlap.limit - stats.overlap.reserved >= bytes;
        return fitsGpu && fitsOverlap ? null : `${imageName(representation)} does not fit the current source/transition memory limits.`;
      },
    });
    const whenReady = textureReadiness(browser.timers, options.readinessPolicy);
    const resources = createViewerResources({ broker, cache, files: service(null),
      filesFor: (input, representation) => service(mediaGroup(input.asset, representation)),
      previewForTiles(input) {
        const published = viewer?.describeImage?.(input.id), preview = current(input).preview;
        return published && preview ? { asset: { id: published.asset.id, revision: published.asset.revision }, representation: preview } : null;
      },
      uploader: browser.native.uploader, atlasDevice: browser.native.regionDevice, sheets,
      previewSheetsEnabled: () => settings.get("scene.panorama.previewSheets") !== false,
      maxTextureSide, whenReady, estimate, choice, devicePixelsPerCss, requestRender: runtime.requestRender,
      tiles: { memoryBytes: () => n("tileMemoryMiB") * MIB,
        limits: () => ({ requests: count("tileRequests"), waiting: count("tilesWaiting"), decodes: count("tileDecodes"),
          uploadsPerFrame: count("tileUploadsPerFrame"), retries: count("tileRetries", 0), retryDelayMs: n("tileRetryDelay"),
          fadeMs: reducedMotion() ? n("reducedFadeDuration") : n("fadeDuration"), viewSlotShare: n("tileViewShare"), retryBackoffDoublings: count("tileRetryBackoffDoublings", 0) }),
        selection(representation) {
          const finest = representation.levelBytes.length - 1, cap = detailCap();
          return { levelCap: Math.min(finest, Number.isFinite(cap) ? Math.max(0, Math.floor(Math.log2(cap / (4 * representation.tileSize)))) : finest),
            texelsPerPixel: typeof settings.get("scene.panorama.immersionDensity") === "number" ? n("immersionDensity") : 1,
            marginDeg: n("tileMarginDeg") };
        }, outlines: () => settings.get("scene.panorama.tileOutlines") === true },
    });
    cleanup.push(() => resources.retire());
    const experiments = () => ({ bookkeeping: settings.get(VIEWER_EXPERIMENT_IDS.sphereBookkeeping) === true,
      opaqueImmersion: settings.get(VIEWER_EXPERIMENT_IDS.opaqueImmersion) === true,
      shaders: settings.get(VIEWER_EXPERIMENT_IDS.sphereShaders) === true });
    const renderer = createSphereRenderer(runtime.scene, { getCamera: () => runtime.scene.activeCamera,
      viewportHeightCssPx: () => worldViewportClientRect(canvas).height,
      presentationLayerMask: NAVIGATION_PRESENTATION_LAYER, appearance: appearance(),
      getPresentationView: runtime.getPresentationView, requestRender: runtime.requestRender,
      profiler: browser.composition.profile.profiler, experiments: experiments(), onError: error => report(null, "image", error) });
    cleanup.push(() => renderer.dispose());
    const { navigation, engineLeaseFor } = createEarthViewerNavigation(runtime);
    const input = createEarthViewerInput(runtime, canvas, engineLeaseFor, browser.clock.nowMs);
    cleanup.push(() => input.dispose());
    viewer = createImageViewer({ renderer, resources, world: earthViewerMath, poses: earthViewerPoses, navigation, input: input.input,
      settings: viewerSettings, now: browser.clock.nowMs,       devicePixelsPerCss,
      viewport: () => {
        const rect = worldViewportClientRect(canvas);
        return rect.width > 0 && rect.height > 0 ? { width: rect.width, height: rect.height } : null;
      },
      createAbortController: () => new AbortController(), requestRender: runtime.requestRender,
      signal: browser.signal, onRetirementError: error => report(null, "image", error),
      holdRendering() { runtime.beginContinuous(); let released = false; return () => { if (!released) { released = true; runtime.endContinuous(); } }; },
      isOccluded: (eye, direction, distance) => runtime.surface.raycast(ecef(eye), ecef(direction), distance) !== null,
      failure: (image, kind, error) => report(image, kind, error) });
    let world: ReturnType<typeof createEarthSceneWorld> | null = null;
    cleanup.push(() => attemptEarthCleanup([() => viewer.dispose(), () => world?.dispose()], "Earth viewer/world cleanup failed."));
    const frames = { subscribe(listener: () => void) { const observer = runtime.scene.onAfterRenderObservable.add(listener);
      return () => { runtime.scene.onAfterRenderObservable.remove(observer); }; } };
    world = createEarthSceneWorld(runtime, settings, { ...frames, wheels: input.wheels,
      minimumOverviewPreparationRadiusMeters: () => settings.get<number>("scene.overview.minimumPreparationRadius") }, canvas, viewer);
    // Viewer releases navigation before the geographic host restores its configured FOV.
    const sceneWorld = world;
    const history = createBrowserSceneHistory(window), sessionId = randomId();
    const controller = createSceneController({ examples: options.examples, baseUrl: options.baseUrl, canvas,
      dragThresholdPx: () => settings.get<number>("input.mouse.dragThreshold"),
      load(url, callbacks) {
        failure = callbacks.onFailure;
        return loadScene(url, { ...callbacks, viewer, world: sceneWorld, frames, sessionId,
          history, baseUrl: options.baseUrl, fetch: window.fetch.bind(window),
          representations: representations.map(entry => entry.hooks), validateImageAsset: validateViewerAsset,
          extensionHooks: [createPreviewSheetsExtensionHook()],
          limits: { get manifestBytes() { return Math.round(settings.get<number>("scene.manifestMiB") * MIB); },
            get entities() { return Math.round(settings.get<number>("scene.entityLimit")); },
            get assets() { return Math.round(settings.get<number>("scene.assetLimit")); },
            get links() { return Math.round(settings.get<number>("scene.linkLimit")); } },
          markerRadiusMeters: () => n("markerRadiusMeters"),
          projectLink: createGlobeViewerProjection({ viewer, renderer, runtime }),
          describeImage: createViewerSceneDescription(viewer, { representations,
            tileMemoryBytes: () => n("tileMemoryMiB") * MIB, maxTextureSide }),
        });
      },
    });
    cleanup.push(() => controller.destroy());
    const savedSection = createSavedImagesSection({ document, source: saved, refresh: ui.refresh,
      maxListedGroups: () => settings.get<number>("scene.panorama.savedGroupsShown") });
    cleanup.push(() => savedSection.destroy());
    const contributions = ["appearance", "motion", "loading", "tiles", "saved"].map(section => {
      const parameter = ui.parameterSection({ tab: "scenes", section, ...(section === "saved" ? { footer: savedSection.element } : {}) });
      cleanup.push(() => parameter.destroy());
      return { section: section as "appearance" | "motion" | "loading" | "tiles" | "saved", title: settings.getSectionTitle("scenes", section),
        element: parameter.element, destroy() { attemptEarthCleanup([() => parameter.destroy(),
          () => { if (section === "saved") savedSection.destroy(); }], "Scene parameter section cleanup failed."); } };
    });
    const panel = createScenesPanel({ document, controller, ui, contributions, externalLinkIcon: () => ui.externalLinkIcon() });
    cleanup.push(() => panel.destroy());
    const tabs = createViewerTabs({ document, viewer, image: id => viewer.describeImage?.(id) ?? null,
      sectionTitle: (tab, section) => settings.getSectionTitle(tab, section), parameterSection: ui.parameterSection, sections: ui.sections,
      representationText: imageName, detail: status => {
        const reading = status.immersionDetail;
        return reading ? { shown: reading.representation, loading: reading.loading, limitation: reading.limitation, progress: reading.progress } : null;
      }, externalLinkIcon: ui.externalLinkIcon, openSettings: options.openSettings });
    cleanup.push(() => tabs.destroy());
    if (import.meta.env.MODE !== "test") {
      const editing = poseEditEnabled(window.location.search);
      const overrides = createPoseOverrides({
        baseUrl: options.baseUrl,
        controller,
        world: sceneWorld,
        viewer: {
          reposition: (id, edit) => { viewer.reposition(id, edit); },
          syncPresentedCamera: () => { runtime.syncPresentedCamera(); },
        },
        persist: editing,
        storage: openPoseStorage(window),
        schedule: (run, delayMs) => {
          const timer = window.setTimeout(run, delayMs);
          return { cancel: () => window.clearTimeout(timer) };
        },
      });
      const onStorage = (event: StorageEvent) => {
        if (event.key !== null && event.key !== POSE_STORAGE_KEY) return;
        try { overrides.observeExternal(window.localStorage.getItem(POSE_STORAGE_KEY)); }
        catch { overrides.observeExternal(event.newValue); }
      };
      const flushEditing = () => { if (editing) overrides.flush(); };
      const onVisibility = () => { if (document.visibilityState === "hidden") flushEditing(); };
      window.addEventListener("storage", onStorage);
      window.addEventListener("pagehide", flushEditing);
      document.addEventListener("visibilitychange", onVisibility);
      cleanup.push(() => {
        window.removeEventListener("storage", onStorage);
        window.removeEventListener("pagehide", flushEditing);
        document.removeEventListener("visibilitychange", onVisibility);
        overrides.dispose();
      });
      if (editing) {
        let poseEditor: { dispose(): void } | null = null;
        let poseEditorGone = false;
        void import("./poseEditor/editor").then(({ mountPoseEditor }) => {
          if (poseEditorGone) return;
          poseEditor = mountPoseEditor({
            document: canvas.ownerDocument, canvas, baseUrl: options.baseUrl,
            sceneUrl: () => overrides.scene()?.sceneUrl ?? null,
            controller, overrides, exportPrefix: options.poseExportPrefix,
            viewer, world: sceneWorld, renderer, runtime,
            dragThresholdPx: () => settings.get<number>("input.mouse.dragThreshold"),
            tab: tabs.sphere,
            beforeFrame(listener) {
              const observer = runtime.scene.onBeforeRenderObservable.add(listener, undefined, true);
              return () => { runtime.scene.onBeforeRenderObservable.remove(observer); };
            },
            afterFrame(listener) {
              const observer = runtime.scene.onAfterRenderObservable.add(listener);
              return () => { runtime.scene.onAfterRenderObservable.remove(observer); };
            },
          });
        }).catch(error => report(null, "image", error));
        cleanup.push(() => { poseEditorGone = true; poseEditor?.dispose(); });
      }
    }
    const hotspots = createSceneHotspots({ document, controller, container: canvas.parentElement ?? canvas });
    cleanup.push(() => hotspots.destroy());
    const offSettings = settings.subscribe(changed => {
      if ([...changed].some(id => id.startsWith("scene.panorama."))) {
        cache.setKeptGpuBytes(n("keptGpuMiB") * MIB); saved.setLimits({ maxBytes: n("savedMiB") * MIB });
        renderer.setAppearance(appearance()); runtime.requestRender();
      }
      if ([...changed].some(id => Object.values(VIEWER_EXPERIMENT_IDS).includes(id as never))) {
        renderer.setExperiments(experiments()); runtime.requestRender();
      }
    });
    cleanup.push(offSettings);
    return { controller, panel, tabs, viewer, renderer, media: saved, isCurrent: () => !disposed,
      async whenSettled() {
        const results = await Promise.allSettled([controller.whenSettled(), viewer.whenSettled(), resources.whenSettled(), sceneWorld.whenSettled(), saved.settled()]);
        const failures = [...retirementErrors, ...results.flatMap(result => result.status === "rejected" ? [result.reason] : [])];
        if (failures.length) throw new AggregateError(failures, "Earth scene retirement failed.");
      },
      dispose() { if (disposed) return; disposed = true; failure = null;
        try { attemptEarthCleanup([...cleanup].reverse().concat(() => services.clear()), "Earth scene composition cleanup failed."); }
        catch (error) { retirementErrors.push(error); throw error; } },
    };
  } catch (error) {
    disposed = true;
    try { attemptEarthCleanup([...cleanup].reverse(), "Earth scene setup cleanup failed."); }
    catch (release) { throw new AggregateError([error, release], "Earth scene setup failed."); }
    throw error;
  }
}
