import { createViewSession } from "./viewSession";
/** Earth application composition: one supplied world, renderer and image session. */
import { bindEarthSceneMedia } from "./cacheCompatibility";
import { randomId } from "./randomId";
import {
  createBuiltInRepresentations, createViewerSelection, validateViewerAsset,
  type SettledPublishedImageViewer, type ViewerImageInput,
} from "@foss-earth/sphere-image";
import { createImageViewer, type ViewerSettings } from "@foss-earth/sphere-image/viewer";
import { createGlobeViewerProjection, createViewerSceneDescription } from "@foss-earth/sphere-image/globe";
import { createImageAnchorMarkers } from "@foss-earth/sphere-image/globe-browser";
import { createSphereRenderer } from "@foss-earth/sphere-image/babylon";
import { createViewerResources, type ComposedImageSource } from "@foss-earth/sphere-image/resources";
import { createViewerTabs } from "@foss-earth/sphere-image/panels";
import { SHOW_IMAGE_ANCHORS_ID, VIEWER_EXPERIMENT_IDS } from "@foss-earth/sphere-image/settings";
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
import { createWheelGestureClassifier, ecef, enuDirection, enuFrame, type Vec3 } from "@foss-earth/engine";
import { isSafariGestureSupported, worldViewportClientRect } from "@foss-earth/engine/browser";
import type { ReadinessPolicy } from "@foss-earth/renderer";
import type { SettingsRegistry } from "@foss-earth/ui/settings";
import type { createEarthBrowserRuntime } from "./browserRuntime";
import type { createEarthUiHost } from "./uiHost";
import {
  createEarthSceneWorld, createEarthViewerInput, createEarthViewerNavigation,
  earthViewerMath, earthViewerPoses,
} from "./sceneWorld";
import { attemptEarthCleanup } from "./nativeResources";
import { markBootOnFrame } from "./bootMarks";
import { defineLazyFeature } from "./lazyFeature";
import { textureReadiness } from "./textureReadiness";
import { poseEditEnabled } from "./poseEditor/poseGate";
import { createPoseOverrides, openPoseStorage } from "./poseEditor/poseOverrides";
import { POSE_STORAGE_KEY } from "./poseEditor/poseStore";
import { createLayerOverrides, openLayerStorage } from "./layerEditor/layerOverrides";
import { LAYER_STORAGE_KEY } from "./layerEditor/layerStore";
import { createLinkOverrides } from "./linkEditor/linkOverrides";
import { createLinkEditor } from "./linkEditor/editor";
import { openingOptions, lookUpOpening, createOpeningViews, type OpeningLook, type OpeningMode } from "./openingView";
import { createHeadsetSession, type HeadsetSession } from "./immersive/headsetSession";
import { createHeadsetTour, type HeadsetLink } from "./immersive/headsetTour";

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
  /** Filename prefix for a layer export. Defaults to `foss-earth-layers`. */
  layerExportPrefix?: string;
  linkExportPrefix?: string;
  /** The route's automatic startup scene, for restoring this tab's view. */
  startupScene?: string;
}

/** The pose editor: only on a pose editing page, which a dev page fetches while idle. */
const poseEditorFeature = defineLazyFeature({
  id: "pose-editor",
  label: "the pose editor",
  prefetch: "idle",
  devOnly: true,
  load: () => import("./poseEditor/editor"),
});
/** What draws the Scenes tab's previews, fetched when the pointer reaches the tab. */
const thumbnailFeature = defineLazyFeature({
  id: "scene-thumbnails",
  label: "the scene previews",
  prefetch: "intent",
  tabs: ["scenes"],
  load: () => import("./thumbnailBackend"),
});

export function createEarthSceneHost(options: EarthSceneHostOptions) {
  const { browser, settings, ui, canvas } = options;
  const { runtime, broker } = browser;
  const document = canvas.ownerDocument;
  const window = document.defaultView;
  if (!window) throw new Error("Earth scenes require their canvas Window.");
  const n = (suffix: string): number => settings.get<number>(`scene.panorama.${suffix}`);
  const range = (suffix: string) => settings.get<{ min: number; max: number }>(`scene.panorama.${suffix}`);
  const count = (suffix: string, minimum = 1) => Math.max(minimum, Math.round(n(suffix)));
  const dragMode = (): "grab" | "scroll" => settings.get("scene.panorama.dragMode") === "grab" ? "grab" : "scroll";
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
  let restoringView = false;
  // Made once the viewer and scenes exist; sizes read while a headset presents come from its eye images.
  let headset: HeadsetSession | null = null;
  const viewerSettings = (): ViewerSettings => ({
    appearance: appearance(),
    look: { dragMode: dragMode(), dragSensitivity: n("dragSensitivity"), swipeSensitivity: n("swipeSensitivity"),
      lookRate: n("lookRate"), zoomPerNotch: n("zoomPerNotch"), zoomRate: n("zoomRate"),
      pinchGain: n("pinchGain"), inertiaHalfLifeMs: n("inertiaHalfLife"),
      fovRangeDeg: range("verticalFovRange"), pitchRangeDeg: range("pitchRange"), reducedMotion: reducedMotion() },
    entryOrientation: settings.get("scene.panorama.entryOrientation") === "authored" ? "authored" : "geographic",
    entryFovDeg: typeof settings.get("scene.panorama.entryFov") === "number" ? n("entryFov") : null,
    flightDurationMs: !restoringView && !reducedMotion() && typeof settings.get("scene.panorama.flightDuration") === "number" ? n("flightDuration") : 0,
    expandDurationMs: restoringView ? 0 : n("expandDuration"), fadeDurationMs: restoringView ? 0 : n("fadeDuration"),
    reducedFadeDurationMs: restoringView ? 0 : n("reducedFadeDuration"), orientDurationMs: restoringView ? 0 : n("orientDuration"), hoverDurationMs: n("hoverDuration"),
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
      viewportHeightDevicePx: () => headset?.viewport()?.deviceHeight ?? worldViewportClientRect(canvas).height * devicePixelsPerCss(), current, imageName,
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
      viewportHeightCssPx: () => headset?.viewport()?.cssHeight ?? worldViewportClientRect(canvas).height,
      isHeadTracked: () => browser.immersive.presenting,
      presentationLayerMask: NAVIGATION_PRESENTATION_LAYER, appearance: appearance(),
      getPresentationView: runtime.getPresentationView, requestRender: runtime.requestRender,
      profiler: browser.composition.profile.profiler, experiments: experiments(), onError: error => report(null, "image", error) });
    cleanup.push(() => renderer.dispose());
    const { navigation, engineLeaseFor } = createEarthViewerNavigation(runtime);
    const input = createEarthViewerInput(runtime, canvas, engineLeaseFor, browser.clock.nowMs, settings);
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
    const openingMemory = createOpeningViews({
      storage: window.localStorage,
      schedule(run, ms) { const handle = window.setTimeout(run, ms); return { cancel: () => window.clearTimeout(handle) }; },
    });
    const flushOpening = (): void => openingMemory.flush();
    window.addEventListener("pagehide", flushOpening);
    document.addEventListener("visibilitychange", flushOpening);
    cleanup.push(() => {
      window.removeEventListener("pagehide", flushOpening);
      document.removeEventListener("visibilitychange", flushOpening);
      openingMemory.dispose();
    });
    const openingMode = (): OpeningMode => {
      const value = settings.get("scene.panorama.openingView");
      return value === "last" || value === "image" || value === "fixed" ? value : "enter";
    };
    const fixedLook = (): OpeningLook => ({
      headingDeg: n("openingHeading"),
      pitchDeg: n("openingPitch"),
      verticalFovDeg: typeof settings.get("scene.panorama.entryFov") === "number" ? n("entryFov") : 90,
    });
    const enterPhotograph = viewer.enter.bind(viewer);
    viewer.enter = (id, options) => {
      const remembered = options?.view ? null : openingMemory.resolve(openingMode(), id, fixedLook());
      return enterPhotograph(id, openingOptions(options, remembered, viewer.status().active === null));
    };
    cleanup.push(viewer.subscribe(() => {
      const current = viewer.status();
      if (current.phase === "immersive" && current.active && current.view) openingMemory.remember(current.active, current.view);
    }));
    let world: ReturnType<typeof createEarthSceneWorld> | null = null;
    cleanup.push(() => attemptEarthCleanup([() => viewer.dispose(), () => world?.dispose()], "Earth viewer/world cleanup failed."));
    const frames = { subscribe(listener: () => void) { const observer = runtime.scene.onAfterRenderObservable.add(listener);
      return () => { runtime.scene.onAfterRenderObservable.remove(observer); }; } };
    world = createEarthSceneWorld(runtime, settings, { ...frames, wheels: input.wheels,
      minimumOverviewPreparationRadiusMeters: () => settings.get<number>("scene.overview.minimumPreparationRadius") }, canvas, viewer);
    // Viewer releases navigation before the geographic host restores its configured FOV.
    const sceneWorld = world;
    const history = createBrowserSceneHistory(window), sessionId = randomId();
    let resumedGlobe = false;
    let startupLoad = Boolean(options.startupScene);
    const controller = createSceneController({ examples: options.examples, baseUrl: options.baseUrl, canvas,
      dragThresholdPx: () => settings.get<number>("input.mouse.dragThreshold"),
      async load(url, callbacks) {
        failure = callbacks.onFailure;
        const startup = startupLoad;
        startupLoad = false;
        const result = await loadScene(url, { applyOverview: !(startup && resumedGlobe), ...callbacks, viewer, world: sceneWorld, frames, sessionId,
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
        if (startup && result.ok) {
          // The page's content: the startup scene's photographs on the globe, from the first frame that draws both.
          markBootOnFrame("boot:content", { onFrame: frames.subscribe }, () => (runtime.getTileMetrics()?.visibleTiles ?? 0) > 0);
          runtime.requestRender();
        }
        if (startup) {
          try {
            const saved = viewSession.saved?.panorama;
            if (result.ok && resumedGlobe && saved?.sceneId === result.handle.status.sceneId && result.handle.status.entries.some(entry => entry.id === saved.id)) {
              restoringView = true;
              await viewer.enter(saved.id, { view: saved.look });
            }
          } finally { restoringView = false; viewSession.start(); }
        }
        return result;
      },
    });
    cleanup.push(() => controller.destroy());
    let viewStorage: Storage | null = null;
    try { viewStorage = window.sessionStorage; } catch { /* This tab can still navigate. */ }
    const viewSession = createViewSession({
      storage: viewStorage, key: `foss-earth.view-session.v1:${window.location.pathname}:${options.startupScene ?? ""}`,
      capture: () => runtime.captureNavigationSnapshot(), restore: snapshot => runtime.restoreNavigationSnapshot(snapshot),
      held: () => runtime.getNavigationState() !== null,
      panorama: () => { const status = controller.state().status; return status ? { sceneId: status.sceneId, ...viewer.status() } : null; },
      schedule(run, ms) { const timer = window.setTimeout(run, ms); return { cancel: () => window.clearTimeout(timer) }; },
    });
    resumedGlobe = viewSession.restoreGlobe();
    if (!options.startupScene) viewSession.start();
    const offViewFrame = frames.subscribe(viewSession.observe);
    const flushView = (): void => viewSession.flush();
    const hideView = (): void => { if (document.hidden) flushView(); };
    window.addEventListener("pagehide", flushView);
    document.addEventListener("visibilitychange", hideView);
    cleanup.push(() => { offViewFrame(); window.removeEventListener("pagehide", flushView); document.removeEventListener("visibilitychange", hideView); });
    const savedSection = createSavedImagesSection({ document, source: saved, refresh: ui.refresh,
      maxListedGroups: () => settings.get<number>("scene.panorama.savedGroupsShown"),
      createHelpTooltip: ui.publicUi.createHelpTooltip, createIconButton: ui.publicUi.createIconButton });
    cleanup.push(() => savedSection.destroy());
    const contributions = ["appearance", "motion", "loading", "tiles", "saved"].map(section => {
      const parameter = ui.parameterSection({ tab: "scenes", section, ...(section === "saved" ? { footer: savedSection.element } : {}) });
      cleanup.push(() => parameter.destroy());
      return { section: section as "appearance" | "motion" | "loading" | "tiles" | "saved", title: settings.getSectionTitle("scenes", section),
        element: parameter.element, destroy() { attemptEarthCleanup([() => parameter.destroy(),
          () => { if (section === "saved") savedSection.destroy(); }], "Scene parameter section cleanup failed."); } };
    });
    const arrangeLayers = import.meta.env.MODE !== "test" && (import.meta.env.DEV || poseEditEnabled(window.location.search));
    const layerArrangement = arrangeLayers ? createLayerOverrides({
      baseUrl: options.baseUrl, controller, persist: true, exportPrefix: options.layerExportPrefix,
      storage: openLayerStorage(window),
      schedule: (run, delayMs) => {
        const timer = window.setTimeout(run, delayMs);
        return { cancel: () => window.clearTimeout(timer) };
      },
    }) : undefined;
    if (layerArrangement) {
      const flushLayers = () => layerArrangement.flush();
      const onLayerStorage = (event: StorageEvent) => {
        if (event.key !== null && event.key !== LAYER_STORAGE_KEY) return;
        try { layerArrangement.observeExternal(window.localStorage.getItem(LAYER_STORAGE_KEY)); }
        catch { layerArrangement.observeExternal(event.newValue); }
      };
      const onLayerVisibility = () => { if (document.visibilityState === "hidden") flushLayers(); };
      window.addEventListener("storage", onLayerStorage);
      window.addEventListener("pagehide", flushLayers);
      document.addEventListener("visibilitychange", onLayerVisibility);
      cleanup.push(() => {
        window.removeEventListener("storage", onLayerStorage);
        window.removeEventListener("pagehide", flushLayers);
        document.removeEventListener("visibilitychange", onLayerVisibility);
        layerArrangement.dispose();
      });
    }
    let linkStorage: Storage | null = null;
    try { linkStorage = window.localStorage; } catch { /* Session links remain usable. */ }
    const imageLinks = createLinkOverrides({ controller, baseUrl: options.baseUrl, storage: linkStorage, exportPrefix: options.linkExportPrefix });
    cleanup.push(() => imageLinks.dispose());
    const linkEditor = arrangeLayers ? createLinkEditor(document, controller, imageLinks) : null;
    // The panel normally destroys it; this also releases it if panel setup throws.
    if (linkEditor) cleanup.push(() => linkEditor.destroy());
    const panel = createScenesPanel({
      document, controller, ui,
      // Off screen until the Scenes tab opens (createGlobeApp's onTabVisibility).
      shown: false,
      contributions: [...contributions, ...(linkEditor ? [{ section: "links" as const, title: "Image links", element: linkEditor.element, destroy: () => linkEditor.destroy() }] : [])],
      layerArrangement,
      previewBackend: () => thumbnailFeature.load().then(module => module.createThumbnailBackend(document, runtime.engine)),
      externalLinkIcon: () => ui.externalLinkIcon(),
      look: { input: {
        createWheelGestureClassifier: options => createWheelGestureClassifier({ ...options, nowMs: browser.clock.nowMs }),
        inputMode: () => { const mode = runtime.getInputMode(); return mode === "touch" ? "auto" : mode; },
        safariGestures: isSafariGestureSupported({ userAgent: window.navigator.userAgent, hasGestureEvent: "GestureEvent" in window }),
        controlTakesKey: () => true,
        anchorMarkers: {
          enabled: () => settings.get(SHOW_IMAGE_ANCHORS_ID) === true,
          create: createImageAnchorMarkers,
          subscribe: changed => settings.watch(SHOW_IMAGE_ANCHORS_ID, changed),
        },
      }, dragMode, swipeSensitivity: () => n("swipeSensitivity"), inertiaHalfLifeMs: () => n("inertiaHalfLife"), reducedMotion, dragSensitivity: () => n("dragSensitivity"), zoomPerNotch: () => n("zoomPerNotch"), pinchGain: () => n("pinchGain"), pitchRange: () => range("pitchRange"), fovRange: () => range("verticalFovRange") },
      opening: {
        mode: openingMode,
        setMode: mode => { settings.set("scene.panorama.openingView", mode); },
        lookUp: () => lookUpOpening(range("pitchRange"), (id, value) => { settings.set(id, value); }),
        lookFor: id => openingMemory.resolve(openingMode(), id, fixedLook()),
        remember: (id, look) => openingMemory.remember(id, look),
        subscribe: listener => settings.subscribe(changed => {
          if ([...changed].some(id => id === "scene.panorama.openingView" || id === "scene.panorama.openingHeading" || id === "scene.panorama.openingPitch")) listener();
        }),
      },
    });
    cleanup.push(() => panel.destroy());
    const tabs = createViewerTabs({ document, viewer, image: id => viewer.describeImage?.(id) ?? null,
      sectionTitle: (tab, section) => settings.getSectionTitle(tab, section), parameterSection: ui.parameterSection, sections: ui.sections,
      representationText: imageName, detail: status => {
        const reading = status.immersionDetail;
        return reading ? { shown: reading.representation, loading: reading.loading, limitation: reading.limitation, progress: reading.progress } : null;
      }, externalLinkIcon: ui.externalLinkIcon, openSettings: options.openSettings, helpTooltip: ui.helpTooltip, iconButton: ui.iconButton });
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
        void poseEditorFeature.load().then(({ mountPoseEditor }) => {
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
    const headsetLinks = (): readonly HeadsetLink[] => {
      const status = viewer.status();
      const image = status.phase === "immersive" && status.active ? viewer.describeImage?.(status.active) : null;
      const capture = image?.details?.capture;
      if (!image || !capture) return [];
      const frame = enuFrame(capture.longitudeDeg, capture.latitudeDeg);
      return image.actions.flatMap(action => {
        if (!action.direction) return [];
        const [e, n, u] = enuDirection(action.direction.headingDeg, action.direction.pitchDeg);
        const along = (i: 0 | 1 | 2): number => frame.east[i] * e + frame.north[i] * n + frame.up[i] * u;
        const direction: Vec3 = [along(0), along(1), along(2)];
        return [{ id: action.id, label: action.label, direction }];
      });
    };
    headset = createHeadsetSession({
      scene: runtime.scene, frames: browser.immersive, navigator: window.navigator,
      holdRendering() { runtime.beginContinuous(); let released = false; return () => { if (!released) { released = true; runtime.endContinuous(); } }; },
      requestRender: runtime.requestRender,
      place() {
        const presented = runtime.getPresentationView();
        if (presented) return { position: [presented.position.x, presented.position.y, presented.position.z], forward: [presented.forward.x, presented.forward.y, presented.forward.z] };
        const camera = runtime.geospatialCamera;
        if (!camera) return null;
        // A right-handed view matrix looks along its −z.
        const view = camera.getViewMatrix().m, eye = camera.globalPosition;
        return { position: [eye.x, eye.y, eye.z], forward: [-view[2]!, -view[6]!, -view[10]!] };
      },
      globeCamera: () => runtime.geospatialCamera,
      createTour: () => createHeadsetTour({
        scene: runtime.scene, layerMask: 0x0fffffff | NAVIGATION_PRESENTATION_LAYER, links: headsetLinks,
        pickImages: ray => controller.handle() ? viewer.pickRay?.(ray.origin, ray.direction) ?? [] : [],
        hoverImage: id => controller.handle()?.hover(id),
        follow: id => { void controller.handle()?.follow(id); },
        enter: id => { void controller.handle()?.enter(id); },
        back: () => { const handle = controller.handle(); if (handle) void handle.exit(); else viewer.exit(); },
      }),
      report: (message, error) => console.warn(message, error),
    });
    cleanup.push(() => headset?.dispose());
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
    cleanup.push(() => viewSession.dispose());
    return { controller, panel, tabs, viewer, renderer, headset, media: saved, isCurrent: () => !disposed,
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
