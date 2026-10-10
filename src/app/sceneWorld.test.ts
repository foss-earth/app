// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BabylonRuntime } from "@foss-earth/engine/babylon";
import type { SettingsRegistry } from "@foss-earth/ui/settings";
import { attachLookInput } from "@foss-earth/360/input";
import { createEarthSceneWorld, createEarthViewerInput } from "./sceneWorld";

vi.mock("@foss-earth/360/input", () => ({ attachLookInput: vi.fn() }));
vi.mock("@foss-earth/engine/browser", async original => ({
  ...await original<typeof import("@foss-earth/engine/browser")>(),
  watchWheelGestures: () => ({ lastEventMs: () => null, begins: () => true, dispose: vi.fn() }),
}));
afterEach(() => vi.restoreAllMocks());
function fixture() {
  const offFrame = vi.fn();
  const runtime = {
    surface: { sample: () => ({ heightMeters: 0 }) },
    captureNavigationSnapshot: () => ({ camera: { fov: 1 }, view: {} }),
    restoreNavigationSnapshot: vi.fn(() => true), requestRender: vi.fn(),
  };
  const canvas = document.createElement("canvas");
  const make = () => createEarthSceneWorld(runtime as unknown as BabylonRuntime,
    { get: () => 60 } as unknown as SettingsRegistry,
    { subscribe: () => offFrame, wheels: { begins: () => true } as never, minimumOverviewPreparationRadiusMeters: () => 1 },
    canvas, { status: () => ({ phase: "overview" }) as never, isPlacementFrozen: () => false });
  return { make, runtime, offFrame };
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
    vi.mocked(attachLookInput).mockReturnValue({ applyIntents() {}, detach() { throw release; } } as never);
    const canvas = document.createElement("canvas");
    const host = createEarthViewerInput({ setNavigationIntentHandler() { throw primary; } } as unknown as BabylonRuntime, canvas, () => ({}) as never, () => 0);
    let caught: unknown;
    try { host.input.attach({ model: {}, lease: {}, requestFrame() {}, userInput() {}, exit() {} } as never); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors).toEqual([primary, release]);
    host.dispose();
  });
});
