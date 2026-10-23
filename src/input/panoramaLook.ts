/**
 * A 360 photograph's look for any camera that turns about a fixed eye, such as
 * a cockpit's: the same look model, gestures and Photograph → Looking settings
 * (`scene.panorama.*`), so it moves exactly as a photograph does.
 */
import { createWheelGestureClassifier, type HudInputMode } from "@foss-earth/engine";
import { isSafariGestureSupported, worldViewportClientRect } from "@foss-earth/engine/browser";
import { createLookModel, type LookSettings, type LookState } from "@foss-earth/sphere-image";
import { attachLookInput } from "@foss-earth/sphere-image/input";
import { createImageAnchorMarkers } from "@foss-earth/sphere-image/globe-browser";
import { SHOW_IMAGE_ANCHORS_ID } from "@foss-earth/sphere-image/settings";
import type { SettingsRegistry } from "@foss-earth/ui/settings";
import { controlTakesKey } from "@felipegalind0/gamepad-tools/browser";
import { getAppSettings } from "../settings/appSettings";

export type { LookState };

/** How a photograph looks, from its `scene.panorama.*` settings. */
export function readPanoramaLookSettings(settings: Pick<SettingsRegistry, "get">, reducedMotion: boolean): LookSettings {
  const n = (suffix: string): number => settings.get<number>(`scene.panorama.${suffix}`);
  const range = (suffix: string) => settings.get<{ min: number; max: number }>(`scene.panorama.${suffix}`);
  return {
    dragMode: settings.get("scene.panorama.dragMode") === "grab" ? "grab" : "scroll",
    dragSensitivity: n("dragSensitivity"), swipeSensitivity: n("swipeSensitivity"),
    lookRate: n("lookRate"), zoomPerNotch: n("zoomPerNotch"), zoomRate: n("zoomRate"),
    pinchGain: n("pinchGain"), inertiaHalfLifeMs: n("inertiaHalfLife"),
    fovRangeDeg: range("verticalFovRange"), pitchRangeDeg: range("pitchRange"), reducedMotion,
  };
}

export interface PanoramaLookOptions {
  /** The canvas that draws the view and takes its gestures. */
  canvas: HTMLCanvasElement;
  initial: LookState;
  /** Every change of the look, to turn the host's camera to it. */
  onChange(state: LookState): void;
  /** Something moved: draw a frame, and call `step` on every frame while `moving()`. */
  requestFrame(): void;
  /** How wheel events are read: the host's input mode. Touch reads them as either, as a photograph does. */
  inputMode(): HudInputMode | "auto";
  /** Whether the arrow, zoom and Escape keys look. Never, without it: a host that flies with them keeps them. */
  ownsKeys?(): boolean;
  /** The settings it reads; the app's own without them. */
  settings?: Pick<SettingsRegistry, "get" | "watch">;
}

export interface PanoramaLookBinding {
  get(): LookState;
  /** Looks there now and stops any glide. */
  set(state: LookState): void;
  /** Advances held rates and glide by one frame of `dtMs`; true while still moving. */
  step(dtMs: number): boolean;
  moving(): boolean;
  /** Held rates, −1 to 1, as from a stick: look right and up, and zoom in. */
  setRates(rates: { lookX: number; lookY: number; zoom: number }): void;
  detach(): void;
}

/** Binds a photograph's look to a canvas: drag, swipe, wheel, pinch and two-touch gestures with their glide. */
export function attachPanoramaLook(options: PanoramaLookOptions): PanoramaLookBinding {
  const { canvas } = options;
  const window = canvas.ownerDocument.defaultView;
  if (!window) throw new Error("A look needs its canvas Window.");
  const settings = options.settings ?? getAppSettings();
  // One query, made on first use: its `matches` always reports the current system setting.
  let systemReducedMotion: MediaQueryList | undefined;
  const reducedMotion = (): boolean => {
    const value = settings.get("scene.panorama.reducedMotion");
    return value === "reduce" || value === "system" && (systemReducedMotion ??= window.matchMedia("(prefers-reduced-motion: reduce)")).matches;
  };
  const surfaceRect = () => {
    const rect = worldViewportClientRect(canvas);
    return rect.width > 0 && rect.height > 0 ? rect : null;
  };
  const model = createLookModel(options.initial, () => readPanoramaLookSettings(settings, reducedMotion()), options.onChange, surfaceRect);
  const nowMs = () => window.performance.now();
  const input = attachLookInput({
    window, canvas, model, controlTakesKey,
    createWheelGestureClassifier: classifier => createWheelGestureClassifier({ ...classifier, nowMs }),
    inputMode: () => { const mode = options.inputMode(); return mode === "touch" ? "auto" : mode; },
    safariGestures: isSafariGestureSupported({ userAgent: window.navigator.userAgent, hasGestureEvent: "GestureEvent" in window }),
    ownsKeys: options.ownsKeys ?? (() => false),
    localPoint(clientX, clientY) {
      const rect = surfaceRect();
      return rect ? { x: clientX - rect.left, y: clientY - rect.top } : null;
    },
    anchorMarkers: {
      enabled: () => settings.get(SHOW_IMAGE_ANCHORS_ID) === true,
      create: element => createImageAnchorMarkers(element, surfaceRect),
      subscribe: changed => settings.watch(SHOW_IMAGE_ANCHORS_ID, changed),
    },
    onExit() {}, onUserInput() {},
    requestFrame: options.requestFrame,
  });
  return {
    get: () => model.get(),
    set: state => model.set(state),
    step: dtMs => model.step(dtMs),
    moving: () => model.moving(),
    setRates(rates) {
      model.setRates(rates);
      if (model.moving()) options.requestFrame();
    },
    detach: () => input.detach(),
  };
}
