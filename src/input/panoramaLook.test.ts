// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { getAppSettings } from "../settings/appSettings";
import { attachPanoramaLook, readPanoramaLookSettings } from "./panoramaLook";

const FRAME_MS = 1000 / 60;

function pointer(type: string, x: number, y: number, time: number): PointerEvent {
  const event = new PointerEvent(type, {
    pointerId: 1, pointerType: "mouse", button: type === "pointermove" ? -1 : 0, buttons: type === "pointerup" ? 0 : 1,
    clientX: x, clientY: y, bubbles: true, cancelable: true,
  });
  Object.defineProperty(event, "timeStamp", { value: time });
  return event;
}

function canvas(): HTMLCanvasElement {
  const element = document.createElement("canvas");
  element.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON() {} });
  element.setPointerCapture = vi.fn();
  element.releasePointerCapture = vi.fn();
  document.body.append(element);
  return element;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("a photograph's look on another camera", () => {
  it("reads the Photograph → Looking settings", () => {
    const settings = getAppSettings();
    expect(readPanoramaLookSettings(settings, false)).toMatchObject({
      dragMode: "scroll", lookRate: 90, pinchGain: 1, inertiaHalfLifeMs: 100,
      fovRangeDeg: { min: 20, max: 140 }, pitchRangeDeg: { min: -85, max: 85 }, reducedMotion: false,
    });
    settings.set("scene.panorama.dragMode", "grab");
    settings.set("scene.panorama.lookRate", 45);
    expect(readPanoramaLookSettings(settings, true)).toMatchObject({ dragMode: "grab", lookRate: 45, reducedMotion: true });
  });

  it("turns with a Scroll drag and glides after it, as a photograph does, and leaves the arrow keys to the host", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    const surface = canvas();
    const onChange = vi.fn(), requestFrame = vi.fn();
    const initial = { headingDeg: 90, pitchDeg: 0, verticalFovDeg: 60 };
    const look = attachPanoramaLook({ canvas: surface, initial, onChange, requestFrame, inputMode: () => "mouse" });

    surface.dispatchEvent(pointer("pointerdown", 400, 300, 100));
    surface.dispatchEvent(pointer("pointermove", 430, 320, 116));
    const held = look.get();
    // The view follows the finger: dragging right and down turns left and looks up.
    expect(held.headingDeg).toBeLessThan(initial.headingDeg);
    expect(held.pitchDeg).toBeGreaterThan(0);
    expect(onChange).toHaveBeenLastCalledWith(held);
    expect(requestFrame).toHaveBeenCalled();

    surface.dispatchEvent(pointer("pointerup", 430, 320, 120));
    expect(look.moving()).toBe(true);
    for (let i = 0; i < 600 && look.step(FRAME_MS); i++);
    expect(look.moving()).toBe(false);
    expect(look.get().headingDeg).toBeLessThan(held.headingDeg);

    const settled = look.get();
    const arrow = new KeyboardEvent("keydown", { key: "ArrowLeft", cancelable: true });
    window.dispatchEvent(arrow);
    expect(arrow.defaultPrevented).toBe(false);
    expect(look.moving()).toBe(false);
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowLeft" }));

    look.setRates({ lookX: 1, lookY: 0, zoom: 0 });
    expect(look.moving()).toBe(true);
    look.step(100);
    expect(look.get().headingDeg).toBeGreaterThan(settled.headingDeg);
    look.setRates({ lookX: 0, lookY: 0, zoom: 0 });

    look.set(initial);
    look.detach();
    onChange.mockClear();
    surface.dispatchEvent(pointer("pointerdown", 400, 300, 200));
    surface.dispatchEvent(pointer("pointermove", 430, 320, 216));
    expect(onChange).not.toHaveBeenCalled();
    expect(look.get()).toEqual(initial);
  });
});
