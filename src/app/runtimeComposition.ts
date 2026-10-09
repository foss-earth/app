/**
 * Earth owns assembly over the public Engine, Renderer and Sky contracts.
 * Installed-owner qualification remains pending; no duplicate device or scheduler.
 */
import {
  createGlobeRuntime,
  NAVIGATION_PRESENTATION_LAYER,
  type GlobeRuntime,
  type GlobeRuntimeOptions,
} from "@foss-earth/engine/babylon";
import {
  createRenderScheduler,
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
}

export interface EarthRuntimeComposition {
  readonly world: GlobeRuntime;
  readonly sky: SkyRuntime;
  readonly scheduler: WorkRenderScheduler;
  readonly presentation: BabylonRendererLifecycle;
  readonly profile: FrameProfileSession;
  /** Releases owners, then invokes disposeHost when supplied; ownership remains explicit. */
  destroy(): void;
}

/** One host-created scheduler/profile/lifecycle/Sky over the existing scene/device. */
export function composeEarthRuntime(options: EarthRuntimeCompositionOptions): EarthRuntimeComposition {
  if (options.scene.getEngine() !== options.renderer.engine) {
    throw new Error("Earth composition must use the supplied scene's renderer.");
  }
  if (options.fatalFramePolicy !== "stop" || typeof options.presentation.onDeviceLost !== "function") {
    throw new TypeError("Earth composition requires stop-on-frame-error and host device-loss cancellation.");
  }
  let released = false;
  let cleaned = false;
  let inHostFrame = false;
  const cancelledFrame = new Error("Earth composition disposed during frame preparation.");
  // Owners may forward these methods as callbacks; preserve the supplied receiver once.
  const clock: GlobeRuntimeOptions["clock"] = {
    nowMs: () => options.clock.nowMs(),
    after: (callback, delayMs) => options.clock.after(callback, delayMs),
  };
  let frameAt = 0;
  let world: GlobeRuntime | undefined;
  let sky: SkyRuntime | undefined;
  let scheduler: WorkRenderScheduler | undefined;
  let presentation: BabylonRendererLifecycle | undefined;
  let profile: FrameProfileSession | undefined;
  let detachProfile: (() => void) | undefined;
  let detachSky: (() => void) | undefined;
  const release = (): void => {
    if (cleaned) return;
    released = true;
    // Leave borrowed frame resources alive until begin/end and world bookkeeping close.
    if (inHostFrame) return;
    cleaned = true;
    const failures: unknown[] = [];
    for (const action of [
      () => world?.destroy(),
      () => { const stop = detachSky; detachSky = undefined; stop?.(); },
      () => sky?.dispose(),
      () => presentation?.dispose(),
      () => { const stop = detachProfile; detachProfile = undefined; stop?.(); },
      () => profile?.dispose(),
      () => scheduler?.stop(),
      () => options.disposeHost?.(),
    ]) {
      try { action(); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, "Earth composition cleanup failed.");
  };
  try {
    scheduler = createRenderScheduler({
      requestFrame(callback) {
        return options.frames.requestFrame(time => {
          // The scheduler and engine consume the same host RAF timestamp.
          frameAt = time;
          callback(time);
        });
      },
      cancelFrame: handle => options.frames.cancelFrame(handle),
      work(timeMs) {
        if (released || !options.resourceWork) return;
        inHostFrame = true;
        const failures: unknown[] = [];
        try { options.resourceWork.prepare(timeMs); } catch (error) { failures.push(error); }
        finally {
          inHostFrame = false;
          if (released) { try { release(); } catch (error) { failures.push(error); } }
        }
        if (failures.length) {
          try { scheduler!.stop(); } catch (error) { failures.push(error); }
          options.onFrameError(failures.length === 1 ? failures[0] : new AggregateError(failures, "Earth resource work failed."));
        }
      },
      shouldKeepRendering: () => !released && (world?.shouldKeepRendering() ?? false),
      minFrameIntervalMs: () => world?.minFrameIntervalMs() ?? 0,
      tick() {
        if (released || !world || !presentation) return;
        inHostFrame = true;
        let rendered = false;
        const failures: unknown[] = [];
        try {
          presentation.renderFrame(() => {
            world!.prepareFrame(frameAt);
            // Renderer will close its begun frame without rendering disposed features.
            if (released) throw cancelledFrame;
          }, () => { rendered = true; });
        } catch (error) { if (error !== cancelledFrame) failures.push(error); }
        try { world.afterFrame(frameAt, rendered); } catch (error) { failures.push(error); }
        finally {
          inHostFrame = false;
          if (released) { try { release(); } catch (error) { failures.push(error); } }
        }
        if (failures.length) {
          // End continuous/inertia retry authority before calling any supplied reporter.
          if (options.fatalFramePolicy === "stop") { try { scheduler!.stop(); } catch (error) { failures.push(error); } }
          options.onFrameError(failures.length === 1 ? failures[0] : new AggregateError(failures, "Earth frame and bookkeeping failed."));
        }
      },
    });
    profile = createFrameProfileSession({
      scene: options.scene,
      engine: options.renderer.engine,
      now: clock.nowMs,
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
    return { world, sky, scheduler, presentation, profile, destroy: release };
  } catch (error) {
    try { release(); } catch (cleanup) {
      throw new AggregateError([error, cleanup], "Earth composition setup and cleanup failed.");
    }
    throw error;
  }
}
