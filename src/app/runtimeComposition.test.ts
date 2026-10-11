import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GlobeRuntimeOptions } from "@foss-earth/engine/babylon";
import { NativeMapStartupError } from "@foss-earth/engine/babylon";
import type { RenderSchedulerOptions } from "@foss-earth/renderer";
import { composeEarthRuntime, type EarthRuntimeCompositionOptions } from "./runtimeComposition";

const owner = vi.hoisted(() => ({
  globe: vi.fn(), scheduler: vi.fn(), profile: vi.fn(), presentation: vi.fn(),
  bindProfile: vi.fn(), sky: vi.fn(), bindSky: vi.fn(),
}));
vi.mock("@foss-earth/engine/babylon", async importOriginal => ({
  ...await importOriginal<typeof import("@foss-earth/engine/babylon")>(),
  createGlobeRuntime: owner.globe, NAVIGATION_PRESENTATION_LAYER: 16,
}));
vi.mock("@foss-earth/renderer", async importOriginal => ({
  ...await importOriginal<typeof import("@foss-earth/renderer")>(), createRenderScheduler: owner.scheduler,
}));
vi.mock("@foss-earth/renderer/babylon", () => ({
  createBabylonRendererLifecycle: owner.presentation, createFrameProfileSession: owner.profile,
  bindFrameProfileSettings: owner.bindProfile,
}));
vi.mock("@foss-earth/sky/babylon", () => ({ createSkyRuntime: owner.sky, bindSkyReadingsAndNotes: owner.bindSky }));

/** Public owner factories are replaced only to observe Earth's host wiring. */
function session() {
  const order: string[] = [];
  const engine = {}, renderer = { engine }, scene = { getEngine: () => engine }, settings = {};
  let frame: ((timeMs: number) => void) | undefined;
  let schedulerOptions: RenderSchedulerOptions | undefined;
  let worldOptions: GlobeRuntimeOptions | undefined;
  const scheduler = {
    requestRender: vi.fn(), requestWork: vi.fn(), setPaused: vi.fn(),
    stop: vi.fn(() => { order.push("scheduler"); }),
  };
  const profile = { dispose: vi.fn(() => { order.push("profile"); }) };
  const sky = { dispose: vi.fn(() => { order.push("sky"); }) };
  const detachSky = vi.fn(() => { order.push("detachSky"); });
  const detachProfile = vi.fn(() => { order.push("detachProfile"); });
  const world = {
    prepareFrame: vi.fn(() => { order.push("prepare"); }),
    afterFrame: vi.fn(() => { order.push("after"); }),
    shouldKeepRendering: () => false, minFrameIntervalMs: () => 0, isPreparingFrame: () => false,
    destroy: vi.fn(() => { order.push("world"); }),
    async whenSettled() { /* This wiring double starts no native work. */ },
  };
  const presentation = {
    renderFrame: vi.fn((prepare: () => void, rendered: () => void) => {
      order.push("begin");
      try { prepare(); order.push("render"); rendered(); }
      finally { order.push("end"); }
    }),
    dispose: vi.fn(() => { order.push("presentation"); }),
  };
  owner.scheduler.mockImplementation((ports: RenderSchedulerOptions) => { schedulerOptions = ports; return scheduler; });
  owner.profile.mockReturnValue(profile); owner.presentation.mockReturnValue(presentation);
  owner.bindProfile.mockReturnValue(detachProfile); owner.sky.mockReturnValue(sky); owner.bindSky.mockReturnValue(detachSky);
  owner.globe.mockImplementation((_canvas: HTMLCanvasElement, ports: GlobeRuntimeOptions) => {
    worldOptions = ports;
    // The actual Engine attachment contract calls this once during setup.
    ports.sky.attach({} as Parameters<GlobeRuntimeOptions["sky"]["attach"]>[0]);
    return world;
  });
  const clock = {
    at: 123,
    nowMs() { return this.at; },
    after(callback: () => void) { callback(); return () => {}; },
  };
  const onFrameError = vi.fn();
  const prepareResource = vi.fn(() => { order.push("resource"); });
  const disposeHost = vi.fn(() => { order.push("host"); });
  const options = {
    renderer, scene, settings, clock, canvas: {},
    world: { platform: { abortError: (message: string) => new Error(message), hasPickablePointAt: () => false } },
    sky: {},
    frames: { requestFrame(callback: (timeMs: number) => void) { frame = callback; return 1; }, cancelFrame: vi.fn() },
    isHidden: () => false,
    presentation: {
      timers: {}, readinessPolicy: {}, onDeviceLost: vi.fn(),
      platform: { devicePixelRatio: () => 1, onResize: () => () => {}, onVisibilityChange: () => () => {} },
    },
    fatalFramePolicy: "stop", onFrameError, resourceWork: { prepare: prepareResource }, disposeHost,
  } as unknown as EarthRuntimeCompositionOptions;
  return {
    order, engine, renderer, scene, settings, clock, scheduler, profile, sky, detachSky, detachProfile,
    world, presentation, options, onFrameError, prepareResource, disposeHost,
    get worldPorts() { return worldOptions!; },
    get schedulerPorts() { return schedulerOptions!; },
    paint(timeMs: number) {
      schedulerOptions!.requestFrame(() => schedulerOptions!.tick());
      frame!(timeMs);
    },
    work(timeMs: number) { schedulerOptions!.work!(timeMs); },
  };
}

beforeEach(() => { vi.clearAllMocks(); });

describe("Earth runtime assembly over public owners", () => {
  it("passes one borrowed scene, renderer, scheduler, clock and profile to their owners", () => {
    const fixture = session(), composed = composeEarthRuntime(fixture.options);
    expect(owner.scheduler).toHaveBeenCalledTimes(1); expect(owner.presentation).toHaveBeenCalledTimes(1);
    expect(owner.profile).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ scene: fixture.scene, engine: fixture.engine }));
    expect(owner.globe).toHaveBeenCalledExactlyOnceWith(fixture.options.canvas, expect.objectContaining({
      renderer: fixture.renderer, scene: fixture.scene, settings: fixture.settings,
      scheduler: fixture.scheduler, lifecycle: fixture.presentation, frameProfile: fixture.profile,
    }));
    expect(owner.presentation).toHaveBeenCalledWith(expect.objectContaining({
      renderer: fixture.renderer, scene: fixture.scene, settings: fixture.settings, scheduler: fixture.scheduler,
      presentationLayer: 16,
    }));
    expect(owner.sky).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ scene: fixture.scene, settings: fixture.settings }));
    // Captured callbacks preserve a host clock that relies on its receiver.
    expect(fixture.worldPorts.clock.nowMs()).toBe(123);
    expect(owner.sky.mock.calls[0][0].clock()).toBe(123);
    expect(fixture.scheduler.setPaused).toHaveBeenCalledExactlyOnceWith(false);
    expect(fixture.scheduler.requestRender).toHaveBeenCalledTimes(1);
    expect(composed.world).toBe(fixture.world); expect(composed.sky).toBe(fixture.sky);
    composed.destroy();
  });

  it("uses the same RAF timestamp for preparation and closure with one render", () => {
    const fixture = session(), composed = composeEarthRuntime(fixture.options);
    fixture.paint(712);
    expect(fixture.world.prepareFrame).toHaveBeenCalledExactlyOnceWith(712);
    expect(fixture.world.afterFrame).toHaveBeenCalledExactlyOnceWith(712, true);
    expect(fixture.order).toEqual(["begin", "prepare", "render", "end", "after"]);
    composed.destroy();
  });

  it("runs hidden resource work without granting another scene paint", () => {
    const fixture = session(), composed = composeEarthRuntime(fixture.options);
    fixture.work(713);
    expect(fixture.prepareResource).toHaveBeenCalledExactlyOnceWith(713);
    expect(fixture.presentation.renderFrame).not.toHaveBeenCalled();
    expect(fixture.scheduler.requestRender).toHaveBeenCalledTimes(1);
    composed.destroy();
  });

  it("closes a begun frame and bookkeeping before disposal during preparation", () => {
    const fixture = session(), composed = composeEarthRuntime(fixture.options);
    fixture.world.prepareFrame.mockImplementation(() => { fixture.order.push("prepare"); composed.destroy(); });
    fixture.paint(714);
    expect(fixture.world.afterFrame).toHaveBeenCalledExactlyOnceWith(714, false);
    expect(fixture.order).toEqual([
      "begin", "prepare", "end", "after", "world", "detachSky", "sky", "presentation", "detachProfile", "profile", "scheduler", "host",
    ]);
    expect(fixture.onFrameError).not.toHaveBeenCalled();
    composed.destroy(); expect(fixture.disposeHost).toHaveBeenCalledTimes(1);
    fixture.paint(715); fixture.work(715);
    expect(fixture.world.prepareFrame).toHaveBeenCalledTimes(1); expect(fixture.prepareResource).not.toHaveBeenCalled();
  });

  it("stops retry authority after frame failure and reports causal bookkeeping errors", () => {
    const fixture = session(), composed = composeEarthRuntime(fixture.options);
    const renderFailure = new Error("prepare failed"), closureFailure = new Error("bookkeeping failed");
    fixture.world.prepareFrame.mockImplementation(() => { throw renderFailure; });
    fixture.world.afterFrame.mockImplementation(() => { throw closureFailure; });
    fixture.onFrameError.mockImplementation(() => { fixture.order.push("reported"); });
    fixture.paint(716);
    expect(fixture.order).toEqual(["begin", "end", "scheduler", "reported"]);
    const error = fixture.onFrameError.mock.calls[0][0];
    expect(error).toBeInstanceOf(AggregateError); expect(error.errors).toEqual([renderFailure, closureFailure]);
    expect(fixture.world.afterFrame).toHaveBeenCalledExactlyOnceWith(716, false);
    composed.destroy();
  });

  it("attempts all cleanup and keeps failures in owner release order", () => {
    const fixture = session(), composed = composeEarthRuntime(fixture.options);
    const worldFailure = new Error("world cleanup"), skyFailure = new Error("sky cleanup");
    fixture.world.destroy.mockImplementation(() => { fixture.order.push("world"); throw worldFailure; });
    fixture.sky.dispose.mockImplementation(() => { fixture.order.push("sky"); throw skyFailure; });
    let error: unknown;
    try { composed.destroy(); } catch (cause) { error = cause; }
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([worldFailure, skyFailure]);
    expect(fixture.order).toEqual(["world", "detachSky", "sky", "presentation", "detachProfile", "profile", "scheduler", "host"]);
    composed.destroy(); expect(fixture.disposeHost).toHaveBeenCalledTimes(1);
  });

  it("releases constructed owners if world construction fails after Sky attachment", () => {
    const fixture = session(), failure = new Error("world setup");
    owner.globe.mockImplementation((_canvas, ports: GlobeRuntimeOptions) => {
      ports.sky.attach({} as Parameters<GlobeRuntimeOptions["sky"]["attach"]>[0]); throw failure;
    });
    expect(() => composeEarthRuntime(fixture.options)).toThrow(failure);
    expect(fixture.order).toEqual(["detachSky", "sky", "presentation", "detachProfile", "profile", "scheduler", "host"]);
  });

  it("registers a failed world's actual parser drain before host cleanup starts", async () => {
    const fixture = session();
    let complete!: () => void;
    const parser = new Promise<void>(resolve => { complete = resolve; });
    let registered: Promise<void> | undefined, finished = false;
    fixture.options.onWorldStartupRetirement = drain => { registered = drain; fixture.order.push("registered"); };
    fixture.disposeHost.mockImplementation(() => { expect(registered).toBe(parser); fixture.order.push("host"); });
    owner.globe.mockImplementation(() => { throw new NativeMapStartupError([new Error("partial world")], "partial world", () => parser); });
    expect(() => composeEarthRuntime(fixture.options)).toThrow("partial world");
    const proof = registered!.then(() => { finished = true; });
    await Promise.resolve(); expect(finished).toBe(false);
    expect(fixture.order[0]).toBe("registered"); expect(fixture.order.at(-1)).toBe("host");
    complete(); await proof; expect(finished).toBe(true);
  });

  it("rejects a second renderer before acquiring any owner resources", () => {
    const fixture = session();
    fixture.options.scene.getEngine = () => ({}) as ReturnType<typeof fixture.options.scene.getEngine>;
    expect(() => composeEarthRuntime(fixture.options)).toThrow("supplied scene's renderer");
    expect(owner.scheduler).not.toHaveBeenCalled(); expect(owner.globe).not.toHaveBeenCalled();
    expect(fixture.disposeHost).not.toHaveBeenCalled();
  });
});
