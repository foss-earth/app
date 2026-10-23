/**
 * A Vision Pro stand-in on IWER 2.5.0. That runtime can name a
 * `transient-pointer` and never builds one, and its device list is Meta's.
 * This profile has no controllers. A pinch connects one pointer for the
 * gesture and then removes it. The pointer has no gamepad, so a thumbstick
 * and a grip do not exist here.
 *
 * The ray is aimed with the same local-to-global transform as controller
 * `look_at` (`RemoteControlInterface.transformXROriginToGlobal`).
 */
import {
  XRInputSource,
  XRInputSourceEvent,
  XRSpace,
  type XRDevice,
  type XRDeviceConfig,
  type XRFrame,
} from "iwer";
import { P_DEVICE } from "iwer/lib/private.js";
import { XRHandedness, XRTargetRayMode } from "iwer/lib/input/XRInputSource.js";
import { XRTrackedInput } from "iwer/lib/device/XRTrackedInput.js";
import { directionTo, lookRotation } from "iwer/lib/utils/control-math.js";

export const appleVisionPro = {
  name: "Apple Vision Pro",
  controllerConfig: undefined,
  supportedSessionModes: ["inline", "immersive-vr"],
  supportedFeatures: ["viewer", "local", "local-floor"],
  supportedFrameRates: [90],
  isSystemKeyboardSupported: false,
  internalNominalFrameRate: 90,
  environmentBlendModes: { "immersive-vr": "opaque" },
  interactionMode: "world-space",
  // Chrome-shaped, like the Quest profiles, so the page boots the same renderer.
  // The device name is what a test checks.
  userAgent: "Mozilla/5.0 (X11; Linux x86_64; Vision Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.122 Safari/537.36",
} as XRDeviceConfig;

type Point = readonly [number, number, number];
type Phase = "idle" | "begin" | "hold" | "end";

export interface TransientPinch {
  aim(point: Point): void;
  /** The next frames connect the pointer and fire `selectstart`. */
  begin(): void;
  /** A later frame fires `select`, then `selectend`, and disconnects. */
  finish(): void;
}

interface OriginTransform {
  transformXROriginToGlobal(position: { x: number; y: number; z: number }): { x: number; y: number; z: number };
}

/** Installs the pinch as the device's only input. The list is empty until `begin`. */
export function installVisionProPinch(device: XRDevice): TransientPinch {
  const targetRaySpace = new XRSpace(device[P_DEVICE].globalSpace);
  const gripSpace = new XRSpace(targetRaySpace);
  const inputSource = new XRInputSource(
    XRHandedness.None,
    XRTargetRayMode.TransientPointer,
    [],
    targetRaySpace,
    undefined,
    gripSpace,
  );
  const tracked = new XRTrackedInput(inputSource);
  tracked.connected = false;
  let phase: Phase = "idle";
  let goal: Point | null = null;

  const place = (): void => {
    if (!goal) return;
    const target = (device.remote as unknown as OriginTransform).transformXROriginToGlobal({
      x: goal[0], y: goal[1], z: goal[2],
    });
    const head = device.position;
    const direction = directionTo({ x: head.x, y: head.y, z: head.z }, target);
    const look = lookRotation(direction);
    tracked.position.set(head.x, head.y, head.z);
    tracked.quaternion.set(look.x, look.y, look.z, look.w);
  };

  const advance = tracked.onFrameStart.bind(tracked);
  tracked.onFrameStart = (frame: XRFrame): void => {
    place();
    advance(frame);
    if (phase === "begin") {
      frame.session.dispatchEvent(new XRInputSourceEvent("selectstart", { frame, inputSource }));
      phase = "hold";
    } else if (phase === "end") {
      frame.session.dispatchEvent(new XRInputSourceEvent("select", { frame, inputSource }));
      frame.session.dispatchEvent(new XRInputSourceEvent("selectend", { frame, inputSource }));
      tracked.connected = false;
      phase = "idle";
    }
  };

  Object.defineProperty(device, "activeInputs", {
    configurable: true,
    get() { return tracked.connected ? [tracked] : []; },
  });

  return {
    aim(point) { goal = point; },
    begin() {
      if (!goal) throw new Error("Aim the pinch before it begins.");
      phase = "begin";
      tracked.connected = true;
    },
    finish() {
      if (phase !== "hold" && phase !== "begin") throw new Error("A pinch ends only after it has begun.");
      phase = "end";
    },
  };
}
