/**
 * Earth owns assembly over the public Engine, Renderer and Sky contracts.
 * Installed-owner qualification remains pending; no duplicate device or scheduler.
 */
import {
  createGlobeRuntime,
  NAVIGATION_PRESENTATION_LAYER,
  NativeMapStartupError,
  type SettledGlobeRuntime,
  type GlobeRuntimeOptions,
} from "@foss-earth/engine/babylon";
import {
  createRenderScheduler, createBorrowedFrameClosure,
  type WorkRenderScheduler,
  type RenderSchedulerOptions,
} from "@foss-earth/renderer";
import {
  bindFrameProfileSettings,
  createBabylonRendererLifecycle,
  createFrameProfileSession,
  type BabylonRendererLifecycle,
  type BabylonRendererLifecycleOptions,
  type FrameProfileSession,
} from "@foss-earth/renderer/babylon";
import {
  bindSkyReadingsAndNotes,
  createSkyRuntime,
  type SkyRuntime,
  type SkyRuntimeOptions,
} from "@foss-earth/sky/babylon";

type SharedWorldKeys = "renderer" | "scene" | "settings" | "clock";
type SkyContextKeys = "scene" | "settings" | "clock" | "isHidden" | "isGround" |
  "getWorldMatrix" | "requestRender" | "onDownloadBytes" | "onLightingChange";

export interface EarthRuntimeCompositionOptions extends Pick<GlobeRuntimeOptions, SharedWorldKeys> {
  canvas: HTMLCanvasElement;
  world: Omit<GlobeRuntimeOptions, SharedWorldKeys | "scheduler" | "frameProfile" | "lifecycle" | "sky" | "platform"> &
    { platform: Omit<GlobeRuntimeOptions["platform"], "isHidden"> };
  sky: Omit<SkyRuntimeOptions, SkyContextKeys>;
  /** RAF timestamps and clock.nowMs use the same monotonic millisecond epoch. */
  frames: Pick<RenderSchedulerOptions, "requestFrame" | "cancelFrame">;
  isHidden(): boolean;
  presentation: Omit<BabylonRendererLifecycleOptions,
    "renderer" | "scene" | "scheduler" | "settings" | "isPreparingFrame" | "applyClipping" | "presentationLayer" | "platform"> &
    Required<Pick<BabylonRendererLifecycleOptions, "timers" | "readinessPolicy" | "onDeviceLost">> &
    { platform: Omit<BabylonRendererLifecycleOptions["platform"], "isHidden"> };
  /** A fatal frame stops this scheduler; recovery composes a new host session. */
  fatalFramePolicy: "stop";
  /** Surface failure after frame closure and scheduler stop. */
  onFrameError(error: unknown): void;
  /** Hidden resource/fence work uses this scheduler's RAF without requesting a scene paint. */
  resourceWork?: { prepare(nowMs: number): void };
  /** Host-owned scene/device/broker cleanup runs after owner cleanup and frame closure. */
  disposeHost?(): void;
  whenHostSettled?(): Promise<void>;
  /** A failed constructor may still own a nonabortable model parser. */
  onWorldStartupRetirement?(drain: Promise<void>): void;
  /** Names the owners of GPU textures and meshes in the profile's GPU memory streamgraph. */
  gpuMemoryOwner?(name: string, kind: "texture" | "mesh"): string | null;
}

export interface EarthRuntimeComposition {
  readonly world: SettledGlobeRuntime;
  readonly sky: SkyRuntime;
  readonly scheduler: WorkRenderScheduler;
  readonly presentation: BabylonRendererLifecycle;
  readonly profile: FrameProfileSession;
  /** Releases owners, then invokes disposeHost when supplied; ownership remains explicit. */
  destroy(): void;
  whenSettled(): Promise<void>;
}

/** One host-created scheduler/profile/lifecycle/Sky over the existing scene/device. */
export function composeEarthRuntime(options: EarthRuntimeCompositionOptions): EarthRuntimeComposition {
  if (options.scene.getEngine() !== options.renderer.engine) {
    throw new Error("Earth composition must use the supplied scene's renderer.");
  }
  if (options.fatalFramePolicy !== "stop" || typeof options.presentation.onDeviceLost !== "function") {
    throw new TypeError("Earth composition requires stop-on-frame-error and host device-loss cancellation.");
  }
  // Owners may forward these methods as callbacks; preserve the supplied receiver once.
  const clock: GlobeRuntimeOptions["clock"] = {
    nowMs: () => options.clock.nowMs(),
    after: (callback, delayMs) => options.clock.after(callback, delayMs),
  };
  let world: SettledGlobeRuntime | undefined;
  let sky: SkyRuntime | undefined;
  let scheduler: WorkRenderScheduler | undefined;
  let presentation: BabylonRendererLifecycle | undefined;
  let profile: FrameProfileSession | undefined;
  let detachProfile: (() => void) | undefined;
  let detachSky: (() => void) | undefined;
  let startupRetirement: Promise<void> | undefined;
  const closure = createBorrowedFrameClosure({
    presentation: () => presentation,
    prepareFrame: time => { world?.prepareFrame(time); }, afterFrame: (time, rendered) => { world?.afterFrame(time, rendered); },
    shouldKeepRendering: () => world?.shouldKeepRendering() ?? false,
    minFrameIntervalMs: () => world?.minFrameIntervalMs() ?? 0,
    stopScheduler: () => scheduler?.stop(), onFrameError: options.onFrameError, resourceWork: options.resourceWork,
    cleanup: [() => world?.destroy(), () => { const stop = detachSky; detachSky = undefined; stop?.(); },
      () => sky?.dispose(), () => presentation?.dispose(),
      () => { const stop = detachProfile; detachProfile = undefined; stop?.(); },
      () => profile?.dispose(), () => scheduler?.stop(), () => options.disposeHost?.()],
    whenOwnersSettled: [async () => { await world?.whenSettled(); await startupRetirement; }, ...(options.whenHostSettled ? [options.whenHostSettled] : [])],
  });
  const release = () => closure.dispose();
  try {
    scheduler = createRenderScheduler(closure.schedulerOptions(options.frames));
    profile = createFrameProfileSession({
      scene: options.scene,
      engine: options.renderer.engine,
      now: clock.nowMs,
      gpuMemoryOwner: options.gpuMemoryOwner,
    });
    detachProfile = bindFrameProfileSettings(options.settings, profile);
    presentation = createBabylonRendererLifecycle({
      ...options.presentation,
      platform: {
        devicePixelRatio: () => options.presentation.platform.devicePixelRatio(),
        isHidden: () => options.isHidden(),
        onResize: listener => options.presentation.platform.onResize(listener),
        onVisibilityChange: listener => options.presentation.platform.onVisibilityChange(listener),
      },
      presentationLayer: NAVIGATION_PRESENTATION_LAYER,
      renderer: options.renderer,
      scene: options.scene,
      scheduler,
      settings: options.settings,
      isPreparingFrame: () => world?.isPreparingFrame() ?? false,
      // Geospatial clipping is applied exactly once inside engine.
    });
    world = createGlobeRuntime(options.canvas, {
      ...options.world,
      platform: {
        ...options.world.platform,
        isHidden: () => options.isHidden(),
        abortError: message => options.world.platform.abortError(message),
        hasPickablePointAt: (...args) => options.world.platform.hasPickablePointAt(...args),
      },
      renderer: options.renderer,
      scene: options.scene,
      settings: options.settings,
      clock,
      scheduler,
      frameProfile: profile,
      lifecycle: presentation,
      sky: {
        attach(context) {
          if (sky) throw new Error("Earth host must attach exactly one Sky instance.");
          sky = createSkyRuntime({
            ...options.sky,
            ...context,
            scene: options.scene,
            settings: options.settings,
            clock: clock.nowMs,
            isHidden: () => options.isHidden(),
          });
          detachSky = bindSkyReadingsAndNotes({ settings: options.settings, sky });
          return { runtime: sky, detach() {
            const stop = detachSky;
            detachSky = undefined;
            stop?.();
          } };
        },
      },
    });
    if (!sky) throw new Error("The globe did not attach its host-owned Sky instance.");
    scheduler.setPaused(options.isHidden());
    // Initial content asks for the same scheduler's first frame.
    scheduler.requestRender();
    return { world, sky, scheduler, presentation, profile, destroy: release, whenSettled: () => closure.whenSettled() };
  } catch (error) {
    const failures: unknown[] = [error];
    // Register this proof before release invokes the host's asynchronous drain.
    // The proof covers the failed world, not this closure's host settlement.
    if (error instanceof NativeMapStartupError) {
      startupRetirement = error.whenSettled();
      void startupRetirement.catch(() => {});
      try { options.onWorldStartupRetirement?.(startupRetirement); } catch (cleanup) { failures.push(cleanup); }
    }
    try { release(); } catch (cleanup) { failures.push(cleanup); }
    if (failures.length > 1) throw new AggregateError(failures, "Earth composition setup and cleanup failed.");
    throw error;
  }
}
