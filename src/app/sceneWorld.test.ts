// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BabylonRuntime } from "@foss-earth/engine/babylon";
import type { SettingsRegistry } from "@foss-earth/ui/settings";
import { imagePoseMatrix, transpose3 } from "@foss-earth/images";
import { pointGeodetic } from "@foss-earth/engine";
import type { ResolvedSphere } from "@foss-earth/scenes";
import { createEarthSceneWorld, createEarthViewerInput } from "./sceneWorld";

vi.mock("@foss-earth/engine/browser", async original => ({
  ...await original<typeof import("@foss-earth/engine/browser")>(),
  watchWheelGestures: () => ({ lastEventMs: () => null, begins: () => true, dispose: vi.fn() }),
}));
afterEach(() => vi.restoreAllMocks());
function fixture() {
  const offFrame = vi.fn();
  let frameListener = () => {};
  const runtime = {
    surface: { sample: () => ({ heightMeters: 0 }) },
    captureNavigationSnapshot: () => ({ camera: { fov: 1 }, view: {} }),
    restoreNavigationSnapshot: vi.fn(() => true), requestRender: vi.fn(),
  };
  const canvas = document.createElement("canvas");
  const make = () => createEarthSceneWorld(runtime as unknown as BabylonRuntime,
    { get: () => 60 } as unknown as SettingsRegistry,
    { subscribe: (listener: () => void) => { frameListener = listener; return offFrame; }, wheels: { begins: () => true } as never, minimumOverviewPreparationRadiusMeters: () => 1 },
    canvas, { status: () => ({ phase: "overview" }) as never, isPlacementFrozen: () => false });
  return { make, runtime, offFrame, frame: () => frameListener() };
}
describe("Earth geographic scene lifecycle", () => {
  it("removes every input hook, restores overview FOV and requests its frame after a subscription release fails", async () => {
    const { make, runtime, offFrame } = fixture(), world = make();
    await world.showOverview({ target: { longitudeDeg: 0, latitudeDeg: 0 }, distanceMeters: 100, headingDeg: 0, pitchDeg: 45, verticalFovDeg: 45 } as never, {});
    runtime.restoreNavigationSnapshot.mockClear();
    const remove = vi.spyOn(window, "removeEventListener");
    const failure = new Error("frame release"); offFrame.mockImplementation(() => { throw failure; });
    expect(() => world.dispose()).toThrow(AggregateError);
    expect(remove.mock.calls.map(([type]) => type)).toEqual(["pointerdown", "wheel", "keydown", "gesturestart"]);
    expect(runtime.restoreNavigationSnapshot.mock.calls[0][0]).toMatchObject({ camera: { fov: Math.PI / 3 } });
    expect(runtime.requestRender).toHaveBeenCalledTimes(1);
    world.dispose(); expect(offFrame).toHaveBeenCalledTimes(1);
  });
  it("rolls back registered browser hooks and its frame subscription on partial construction", () => {
    const { make, offFrame } = fixture(), failure = new Error("registration");
    const add = window.addEventListener.bind(window);
    vi.spyOn(window, "addEventListener").mockImplementation((...args) => { if (args[0] === "wheel") throw failure; add(...args); });
    const remove = vi.spyOn(window, "removeEventListener");
    expect(make).toThrow(failure);
    expect(offFrame).toHaveBeenCalledTimes(1);
    expect(remove.mock.calls.map(([type]) => type)).toEqual(["pointerdown", "wheel", "keydown", "gesturestart"]);
  });
  it("preserves the input registration failure when look detachment also fails", () => {
    const primary = new Error("intent registration"), release = new Error("look detach");
    const canvas = document.createElement("canvas");
    const host = createEarthViewerInput({ setNavigationIntentHandler() { throw primary; } } as unknown as BabylonRuntime, canvas, () => ({}) as never, () => 0);
    let caught: unknown;
    try { host.input.attach({ model: { setRates() {}, cancelInertia() { throw release; } }, lease: {}, requestFrame() {}, userInput() {}, exit() {} } as never); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors).toEqual([primary, release]);
    host.dispose();
  });
  it("keeps legacy ground-relative orbs visible when their authored capture height is null", () => {
    const { make, runtime } = fixture();
    runtime.surface.sample = () => ({ heightMeters: 250, revision: 3 });
    const world = make();
    const entity: ResolvedSphere = {
      id: "legacy-orb", type: "panorama", assetId: "asset", title: "Legacy orb", links: [],
      capture: { longitudeDeg: -93.235, latitudeDeg: 44.975, height: null },
      imagePose: { headingDeg: 0, pitchDeg: 0, rollDeg: 0 },
      marker: { mode: "ground-relative", eastM: 0, northM: 0, offsetM: 25 },
      markerStyle: { outline: null, hoverScale: 1 },
    };
    try {
      const placed = world.resolvePlacement(entity, { radiusMeters: 3 });
      expect(placed.state).toBe("placed");
      expect(placed.placement.marker).not.toBeNull();
      expect(pointGeodetic(placed.placement.marker!).heightMeters).toBeCloseTo(275, 0);
      expect(placed.previewContent).toEqual(transpose3(imagePoseMatrix(entity.imagePose)));
    } finally { world.dispose(); }
  });

  it("never moves a placed photograph when coarser or finer map detail arrives, and never samples for a prepared height", () => {
    const { make, runtime, frame } = fixture();
    let surface = { heightMeters: 280, revision: 1 };
    const sample = vi.fn((latitudeDeg: number) => latitudeDeg > 44.97 ? surface : null);
    Object.assign(runtime.surface, { sample, revision: () => surface.revision });
    const prepared: ResolvedSphere = {
      id: "prepared", type: "panorama", assetId: "asset", title: "Prepared", links: [],
      capture: { longitudeDeg: -93.234, latitudeDeg: 44.976, height: { meters: 236.303, datum: "WGS84-ellipsoid" } },
      imagePose: { headingDeg: 0, pitchDeg: 0, rollDeg: 0 },
      marker: { mode: "capture-relative", eastM: 0, northM: 0, offsetM: 25 },
      markerStyle: { outline: null, hoverScale: 1 },
    };
    const legacy: ResolvedSphere = { ...prepared, id: "legacy", capture: { ...prepared.capture, height: null }, marker: { ...prepared.marker, mode: "ground-relative" } };
    const heightOf = (world: ReturnType<typeof make>, id: string) => pointGeodetic(world.posePlacement(id)!.placement.marker!).heightMeters;
    const world = make();
    const changed = vi.fn();
    world.watchPlacement(prepared, { radiusMeters: 3 }, changed);
    world.watchPlacement(legacy, { radiusMeters: 3 }, changed);
    frame();
    expect(heightOf(world, "prepared")).toBeCloseTo(261.303, 2);
    expect(heightOf(world, "legacy")).toBeCloseTo(305, 2);
    expect(changed).toHaveBeenCalledTimes(2);
    expect(sample).toHaveBeenCalledTimes(1);
    for (const heightMeters of [240, 300, 236]) { surface = { heightMeters, revision: surface.revision + 1 }; frame(); }
    expect(changed).toHaveBeenCalledTimes(2);
    expect(sample).toHaveBeenCalledTimes(1);
    expect(heightOf(world, "prepared")).toBeCloseTo(261.303, 2);
    expect(heightOf(world, "legacy")).toBeCloseTo(305, 2);
    // A pose edit that leaves the height alone keeps the prepared height; only the edit moves the orb.
    world.setPoseEdit("prepared", { longitudeDeg: -93.234, latitudeDeg: 44.976, heightMeters: null, headingDeg: 45, pitchDeg: 0, rollDeg: 0, offsetM: 25 });
    expect(heightOf(world, "prepared")).toBeCloseTo(261.303, 2);
    expect(sample).toHaveBeenCalledTimes(1);
    world.dispose();
    // A reload or scene change places the prepared photograph at the same height before any map detail.
    surface = { heightMeters: 999, revision: 50 };
    const reloaded = make();
    reloaded.watchPlacement(prepared, { radiusMeters: 3 }, () => {});
    expect(pointGeodetic(reloaded.resolvePlacement(prepared, { radiusMeters: 3 }).placement.marker!).heightMeters).toBeCloseTo(261.303, 2);
    expect(sample).toHaveBeenCalledTimes(1);
    reloaded.dispose();
  });

  it("moves a watched photograph when its pose edit changes, and keeps doing so after it was placed", () => {
    const { make, runtime } = fixture();
    runtime.surface.sample = () => ({ heightMeters: 250, revision: 3 });
    const world = make();
    const entity: ResolvedSphere = {
      id: "orb", type: "panorama", assetId: "asset", title: "Orb", links: [],
      capture: { longitudeDeg: 0, latitudeDeg: 0, height: { meters: 30, datum: "WGS84-ellipsoid" } },
      imagePose: { headingDeg: 0, pitchDeg: 0, rollDeg: 0 },
      marker: { mode: "capture-relative", eastM: 0, northM: 0, offsetM: 0 },
      markerStyle: { outline: null, hoverScale: 1 },
    };
    world.watchPlacement(entity, { radiusMeters: 8 }, () => {});
    const before = world.resolvePlacement(entity, { radiusMeters: 8 });
    world.setPoseEdit(entity.id, { longitudeDeg: 0, latitudeDeg: 0, heightMeters: 30, headingDeg: 90, pitchDeg: 0, rollDeg: 0, offsetM: 0 });
    const turned = world.resolvePlacement(entity, { radiusMeters: 8 });
    expect(turned.placement.content).not.toEqual(before.placement.content);
    world.setPoseEdit(entity.id, { longitudeDeg: 0, latitudeDeg: 1, heightMeters: 30, headingDeg: 0, pitchDeg: 0, rollDeg: 0, offsetM: 0 });
    const moved = world.posePlacement(entity.id);
    expect(pointGeodetic(moved!.placement.marker!).latitudeDeg).toBeGreaterThan(0.9);
    const ground: ResolvedSphere = { ...entity, id: "ground", capture: { longitudeDeg: 0, latitudeDeg: 0, height: null }, marker: { mode: "ground-relative", eastM: 0, northM: 0, offsetM: 10 } };
    world.watchPlacement(ground, { radiusMeters: 8 }, () => {});
    world.setPoseEdit(ground.id, { longitudeDeg: 0, latitudeDeg: 0, heightMeters: null, headingDeg: 0, pitchDeg: 0, rollDeg: 0, offsetM: 40 });
    expect(pointGeodetic(world.posePlacement(ground.id)!.placement.marker!).heightMeters).toBeCloseTo(290, 0);
    world.dispose();
  });
});

it("gives local previews a level frame at Minnesota latitude, including live pose edits", () => {
  const { make } = fixture(), world = make();
  const entity: ResolvedSphere = {
    id: "preview", type: "panorama", assetId: "asset", title: "Preview", links: [],
    capture: { longitudeDeg: -93.235, latitudeDeg: 44.975, height: { meters: 250, datum: "WGS84-ellipsoid" } },
    imagePose: { headingDeg: 0, pitchDeg: 0, rollDeg: 0 },
    marker: { mode: "capture-relative", eastM: 0, northM: 0, offsetM: 0 },
    markerStyle: { outline: null, hoverScale: 1 },
  };
  world.watchPlacement(entity, { radiusMeters: 8 }, () => {});
  const placed = world.resolvePlacement(entity, { radiusMeters: 8 });
  expect(placed.previewContent).toEqual([[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
  expect(placed.previewContent).not.toEqual(placed.placement.content);
  world.setPoseEdit(entity.id, { longitudeDeg: -93.235, latitudeDeg: 44.975, heightMeters: 250, headingDeg: 30, pitchDeg: 12, rollDeg: 0, offsetM: 0 });
  const edited = world.posePlacement(entity.id)!;
  expect(edited.previewContent).toEqual(transpose3(imagePoseMatrix({ headingDeg: 30, pitchDeg: 12, rollDeg: 0 })));
  world.dispose();
});
