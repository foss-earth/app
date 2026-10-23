/**
 * An emulated VR headset in place of the browser's WebXR, installed before the
 * app starts. The dev server adds it to a page opened with
 * `?headsetEmulator=quest2` (or `quest3`, `questPro`, `visionpro`;
 * vite/headsetEmulator.ts); no build holds it. An unknown name is refused.
 * Quest profiles have controllers. Vision Pro has none: `pinch` is its press.
 *
 * Meta's Immersive Web Emulation Runtime answers `navigator.xr`: Enter VR
 * starts a session drawn side by side, an eye each, over the page.
 * `window.__fossEarthHeadsetEmulator` is the device itself.
 *
 * `window.__fossEarthHeadset` uses it as a person would, for a test, an agent
 * or the console: enter VR, look about, aim a controller at what the headset
 * shows (a page element on a panel or a surface, by its selector), press,
 * scroll and hold, and read what is shown and pointed at. Each step waits for
 * the frames that show it. For example:
 *
 *   await __fossEarthHeadset.enter()
 *   await __fossEarthHeadset.tap(".foss-earth-tab-add")
 *   __fossEarthHeadset.state()
 *
 * docs/agent-testing.md in the FOSS Earth docs has the rest.
 */
import { XRDevice } from "iwer";
import type { HeadsetBranch, HeadsetInspection, HeadsetSession } from "../app/immersive/headsetSession";
import type { HeadsetUiInspection } from "../app/immersive/headsetUi";
import { headsetProfile } from "./headsetProfiles";
import { installVisionProPinch, type TransientPinch } from "./transientPinch";

type Hand = "left" | "right";
type Point = readonly [number, number, number];
/** What to aim at: a page element's selector, on a panel or a surface; a panel ("plus", "window-left", …) at (u, v); or a point of the headset space. */
type AimTarget = string | { panel: string; u?: number; v?: number } | Point;
type Pointed = HeadsetUiInspection["hands"][string] | null;

export interface HeadsetHarness {
  readonly device: XRDevice;
  /** The page's headset session, once it made one. */
  session(): HeadsetSession | null;
  /** The session, what the headset shows of the page and what each controller points at. */
  state(): HeadsetHarnessState;
  /** Starts VR, as Enter VR does, once the page can: the state when it presents. */
  enter(): Promise<HeadsetHarnessState>;
  exit(): Promise<HeadsetHarnessState>;
  /** Waits for `count` frames drawn: the headset's while it presents. */
  frames(count?: number): Promise<number>;
  /** Turns the head `rightDeg` to the right of ahead and `upDeg` up, level. */
  look(rightDeg: number, upDeg?: number): Promise<void>;
  /** Points a controller at a target and waits until it does: what it points at then. */
  aim(hand: Hand, target: AimTarget): Promise<Pointed>;
  press(hand: Hand, button?: string): Promise<void>;
  release(hand: Hand, button?: string): Promise<void>;
  /** A press and release: the trigger by default. */
  click(hand: Hand, button?: string): Promise<void>;
  /** Aims and clicks with the right controller, or `hand`: what it pointed at. */
  tap(target: AimTarget, hand?: Hand): Promise<Pointed>;
  /** Leans the thumbstick, −1 to 1; y < 0 is forward. */
  stick(hand: Hand, x: number, y: number): Promise<void>;
  /** Leans the thumbstick for `frames` frames, then lets it go back. */
  scroll(hand: Hand, y: number, frames?: number): Promise<void>;
  /** Takes a window with the grip and lets it go where the controller then points, `rightDeg` and `upDeg` from ahead. */
  move(panel: string, rightDeg: number, upDeg: number, hand?: Hand): Promise<HeadsetHarnessState>;
  /** Controllerless: aims and pinches a target. The pointer exists only for that gesture. A controller headset throws. The state is from the middle of the pinch, while the pointer is connected. */
  pinch(target: AimTarget): Promise<HeadsetHarnessState>;
  /** A point of the scene in the headset space, and back. */
  toLocal(point: Point): Point | null;
  toWorld(point: Point): Point | null;
}

export interface HeadsetHarnessState {
  emulator: string;
  headset: string | null;
  /** The presenting session's branch, once it has chosen one. */
  branch: HeadsetBranch | null;
  /** `targetRayMode` of each connected input. Empty between pinches. */
  sources: readonly string[];
  reason: string | null;
  frames: number;
  /** The eye and its look direction in the headset space, while it presents. */
  head: { position: Point; forward: Point } | null;
  revision: number;
  panels: HeadsetUiInspection["panels"];
  hands: HeadsetUiInspection["hands"];
}

declare global {
  interface Window {
    /** Dev server only, with `?headsetEmulator=`: the emulated headset. */
    __fossEarthHeadsetEmulator?: XRDevice;
    /** Dev server only, with `?headsetEmulator=`: the emulated headset, used as a person would. */
    __fossEarthHeadset?: HeadsetHarness;
  }
}

const requested = new URLSearchParams(window.location.search).get("headsetEmulator") ?? "";
const profile = headsetProfile(requested);
// An eye each, as a headset shows it; the emulator starts with one picture.
const device = new XRDevice(profile.device, { stereoEnabled: true });
const pinchInput: TransientPinch | null = profile.kind === "controllerless" ? installVisionProPinch(device) : null;
// Desktop Chrome has a WebXR of its own, with no headset behind it.
device.installRuntime({ forceInstall: true });
window.__fossEarthHeadsetEmulator = device;

// The app announces its session (HEADSET_SESSION_EVENT in headsetSession.ts).
let session: HeadsetSession | null = null;
window.addEventListener("foss-earth:headset-session", event => { session = (event as CustomEvent<HeadsetSession>).detail; });

const DEG = Math.PI / 180;
const WAIT_MS = 30000;
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
const inspection = (): HeadsetInspection | null => session?.inspect() ?? null;
const ui = (): HeadsetUiInspection | null => inspection()?.ui?.inspect() ?? null;

async function until<T>(read: () => T, test: (value: T) => boolean, what: string, timeoutMs = WAIT_MS): Promise<T> {
  const end = performance.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (test(value)) return value;
    if (performance.now() > end) throw new Error(`Timed out waiting for ${what}: ${JSON.stringify(value)}`);
    await sleep(50);
  }
}

function frames(count = 1): Promise<number> {
  const inspected = inspection();
  if (!inspected) {
    return new Promise(resolve => {
      let left = count;
      const step = (): void => { if (--left <= 0) resolve(0); else requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
  }
  const until = inspected.frames + count;
  return new Promise(resolve => {
    const observer = inspected.scene.onAfterRenderObservable.add(() => {
      const now = inspection()?.frames ?? until;
      if (now >= until) { inspected.scene.onAfterRenderObservable.remove(observer); resolve(now); }
    });
  });
}

function head(): HeadsetHarnessState["head"] {
  const camera = inspection()?.camera;
  if (!camera) return null;
  const { x, y, z, w } = camera.rotationQuaternion ?? { x: 0, y: 0, z: 0, w: 1 };
  // −z turned by the rotation.
  return { position: [camera.position.x, camera.position.y, camera.position.z], forward: [-2 * (x * z + w * y), -2 * (y * z - w * x), -(1 - 2 * (x * x + y * y))] };
}

function state(): HeadsetHarnessState {
  const shown = ui();
  return {
    emulator: device.name,
    headset: session?.state ?? null,
    branch: session?.branch ?? null,
    sources: device.inputSources.map(source => source.targetRayMode),
    reason: session?.reason ?? null,
    frames: inspection()?.frames ?? 0,
    head: head(),
    revision: shown?.revision ?? 0,
    panels: shown?.panels ?? [],
    hands: shown?.hands ?? {},
  };
}

const add = (a: Point, b: Point): Point => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Point, s: number): Point => [a[0] * s, a[1] * s, a[2] * s];
type Pose = HeadsetUiInspection["panels"][number]["pose"];
const onPanel = (pose: Pose, u: number, v: number): Point =>
  add(pose.center, add(scale(pose.right, (u - 0.5) * pose.width), scale(pose.up, (0.5 - v) * pose.height)));

/** A target as a point of the headset space, and the panel and (u, v) it is on. */
function resolve(target: AimTarget): { point: Point; panel: string | null; u: number; v: number } {
  if (Array.isArray(target)) return { point: target as Point, panel: null, u: 0, v: 0 };
  const panels = ui()?.panels ?? [];
  if (typeof target === "object" && "panel" in target) {
    const panel = panels.find(shown => shown.id === target.panel);
    if (!panel) throw new Error(`No panel "${target.panel}" is shown; shown: ${panels.map(shown => shown.id).join(", ") || "none"}.`);
    const u = target.u ?? 0.5, v = target.v ?? 0.5;
    return { point: onPanel(panel.pose, u, v), panel: panel.id, u, v };
  }
  const selector = target as string;
  const element = document.querySelector(selector);
  if (!element) throw new Error(`Nothing on the page matches ${selector}.`);
  const rect = element.getBoundingClientRect();
  const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
  // The nearest panel showing that point: a popup stands in front of its window.
  const eye = inspection()?.camera.position;
  const distance = (pose: Pose): number => (eye ? Math.hypot(pose.center[0] - eye.x, pose.center[1] - eye.y, pose.center[2] - eye.z) : 0);
  const holding = panels.filter(panel => panel.source && x >= panel.source.x && x <= panel.source.x + panel.source.width && y >= panel.source.y && y <= panel.source.y + panel.source.height)
    .sort((a, b) => distance(a.pose) - distance(b.pose))[0];
  if (!holding?.source) {
    // Else a surface in the world showing the page, such as a cockpit's screen.
    const located = inspection()?.ui?.locate(x, y);
    if (located) return { point: located.point, panel: located.surface, u: 0.5, v: 0.5 };
    throw new Error(`${selector} is on the page at ${Math.round(x)}, ${Math.round(y)}, on no panel or surface the headset shows; shown: ${panels.map(panel => `${panel.id} ${JSON.stringify(panel.source)}`).join("; ") || "none"}.`);
  }
  const u = (x - holding.source.x) / holding.source.width, v = (y - holding.source.y) / holding.source.height;
  return { point: onPanel(holding.pose, u, v), panel: holding.id, u, v };
}

/** The controller's ray this frame, in the headset space. */
const rayOf = (hand: Hand) => inspection()?.rays.find(ray => ray.hand === hand) ?? null;

async function aim(hand: Hand, target: AimTarget): Promise<Pointed> {
  if (profile.kind === "controllerless") throw new Error("This headset has no controllers.");
  if (!inspection()) throw new Error("The headset is not presenting: enter() first.");
  let { point } = resolve(target);
  const goal = resolve(target).point;
  // The controller's ray is not quite its body's look: aim again by the miss.
  for (let attempt = 0; attempt < 6; attempt++) {
    await device.remote.dispatch("look_at", { device: `controller-${hand}`, target: { x: point[0], y: point[1], z: point[2] } });
    await frames(2);
    const ray = rayOf(hand);
    if (!ray) break;
    const reach = Math.hypot(...sub(goal, ray.origin));
    const size = Math.hypot(...ray.direction) || 1;
    const along = add(ray.origin, scale(ray.direction, reach / size));
    const miss = sub(goal, along);
    if (Math.hypot(...miss) < 0.0015) break;
    point = add(point, miss);
  }
  await frames(2);
  return ui()?.hands[hand] ?? null;
}

const controller = (hand: Hand) => {
  if (profile.kind === "controllerless") throw new Error("This headset has no controllers.");
  const found = device.controllers[hand];
  if (!found) throw new Error(`The emulated headset has no ${hand} controller.`);
  return found;
};

const harness: HeadsetHarness = {
  device,
  session: () => session,
  state,
  async enter() {
    const ready = await until(() => session?.state ?? null, value => value === "ready" || value === "presenting" || value === "unavailable", "the page's headset session");
    if (ready === "unavailable") throw new Error(`VR is unavailable: ${session?.reason ?? "no reason given"}`);
    if (ready !== "presenting") await session!.enter();
    await until(() => session?.state ?? null, value => value === "presenting", "the session to present");
    await frames(3);
    return state();
  },
  async exit() {
    await session?.exit();
    await until(() => session?.state ?? null, value => value !== "presenting", "the session to end");
    return state();
  },
  frames,
  async look(rightDeg, upDeg = 0) {
    const h = -rightDeg * DEG / 2, p = upDeg * DEG / 2;
    const [sy, cy, sp, cp] = [Math.sin(h), Math.cos(h), Math.sin(p), Math.cos(p)];
    await device.remote.dispatch("set_transform", { device: "headset", orientation: { x: cy * sp, y: sy * cp, z: -sy * sp, w: cy * cp } });
    await frames(3);
  },
  aim,
  async press(hand, button = "trigger") { controller(hand).updateButtonValue(button, 1); await frames(2); },
  async release(hand, button = "trigger") { controller(hand).updateButtonValue(button, 0); await frames(2); },
  async click(hand, button = "trigger") {
    await harness.press(hand, button);
    await frames(1);
    await harness.release(hand, button);
  },
  async tap(target, hand = "right") {
    const pointed = await aim(hand, target);
    await harness.click(hand);
    await frames(3);
    return pointed;
  },
  async stick(hand, x, y) { controller(hand).updateAxes("thumbstick", x, y); await frames(1); },
  async scroll(hand, y, count = 10) {
    await harness.stick(hand, 0, y);
    await frames(count);
    await harness.stick(hand, 0, 0);
  },
  async pinch(target) {
    if (!pinchInput) throw new Error("Pinch is for a controllerless headset.");
    if (!inspection()) throw new Error("The headset is not presenting: enter() first.");
    const { point } = resolve(target);
    pinchInput.aim(point);
    pinchInput.begin();
    await frames(2);
    const during = state();
    pinchInput.finish();
    await frames(2);
    return during;
  },
  async move(panel, rightDeg, upDeg, hand = "right") {
    await aim(hand, { panel });
    await harness.press(hand, "squeeze");
    const eye = inspection()!.camera.position;
    const h = rightDeg * DEG, p = upDeg * DEG;
    const direction: Point = [Math.sin(h) * Math.cos(p), Math.sin(p), -Math.cos(h) * Math.cos(p)];
    await device.remote.dispatch("look_at", { device: `controller-${hand}`, target: { x: eye.x + direction[0] * 1.2, y: eye.y + direction[1] * 1.2, z: eye.z + direction[2] * 1.2 } });
    await frames(3);
    await harness.release(hand, "squeeze");
    await frames(2);
    return state();
  },
  toLocal(point) {
    const space = inspection()?.space;
    if (!space) return null;
    const inverse = space.getWorldMatrix().clone().invert().m;
    const [x, y, z] = point;
    return [
      x * inverse[0]! + y * inverse[4]! + z * inverse[8]! + inverse[12]!,
      x * inverse[1]! + y * inverse[5]! + z * inverse[9]! + inverse[13]!,
      x * inverse[2]! + y * inverse[6]! + z * inverse[10]! + inverse[14]!,
    ];
  },
  toWorld(point) {
    const space = inspection()?.space;
    if (!space) return null;
    const m = space.getWorldMatrix().m;
    const [x, y, z] = point;
    return [
      x * m[0]! + y * m[4]! + z * m[8]! + m[12]!,
      x * m[1]! + y * m[5]! + z * m[9]! + m[13]!,
      x * m[2]! + y * m[6]! + z * m[10]! + m[14]!,
    ];
  },
};
window.__fossEarthHeadset = harness;
console.info(`[vr] Emulated headset: ${device.name}. window.__fossEarthHeadset drives it.`);
