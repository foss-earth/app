/**
 * Where the headset's page panels float and what a controller points at on
 * them: the pure parts of the headset UI (headsetUi.ts). Everything is in the
 * headset space's own metres, its x to the right, y up and −z ahead, as the
 * session's reference space; yaw is degrees to the right of ahead.
 */
import { add, cross, dot, length, scale, sub, type Vec3 } from "@foss-earth/engine";

const DEG = Math.PI / 180;

export interface PageRect { x: number; y: number; width: number; height: number }

/** A flat panel: its centre, its unit right and up, and its size, metres. Its front faces along right × up. */
export interface PanelPose { center: Vec3; right: Vec3; up: Vec3; width: number; height: number }

/** A ray on a panel: u across from its left, v down from its top, both 0 to 1 on it, and how far along the ray. */
export interface PanelHit { u: number; v: number; distance: number; point: Vec3 }

const unit = (a: Vec3): Vec3 => { const size = length(a); return size > 0 ? scale(a, 1 / size) : a; };

/**
 * Where a ray meets a panel's plane from its front, or null from behind or
 * along it. `bounded` keeps only a point on the panel; a held press follows
 * the ray off its edge, as a captured mouse does.
 */
export function rayPanel(origin: Vec3, direction: Vec3, panel: PanelPose, bounded = true): PanelHit | null {
  const along = unit(direction);
  const normal = cross(panel.right, panel.up);
  const facing = dot(along, normal);
  if (!(facing < -1e-6)) return null;
  const distance = dot(sub(panel.center, origin), normal) / facing;
  if (!(distance > 0)) return null;
  const point = add(origin, scale(along, distance));
  const offset = sub(point, panel.center);
  const u = dot(offset, panel.right) / panel.width + 0.5;
  const v = 0.5 - dot(offset, panel.up) / panel.height;
  if (bounded && !(u >= 0 && u <= 1 && v >= 0 && v <= 1)) return null;
  return { u, v, distance, point };
}

/** The point of a panel at (u, v). */
export const panelPoint = (panel: PanelPose, u: number, v: number): Vec3 =>
  add(panel.center, add(scale(panel.right, (u - 0.5) * panel.width), scale(panel.up, (0.5 - v) * panel.height)));

/** The page point at (u, v) of a panel showing `source`. */
export const pagePoint = (source: PageRect, u: number, v: number): { x: number; y: number } =>
  ({ x: source.x + u * source.width, y: source.y + v * source.height });

/** The (u, v) of a page point on a panel showing `source`. */
export const sourceUv = (source: PageRect, x: number, y: number): { u: number; v: number } =>
  ({ u: (x - source.x) / source.width, v: (y - source.y) / source.height });

/** The direction `yawDeg` to the right of ahead and `pitchDeg` up. */
export function lookDirection(yawDeg: number, pitchDeg = 0): Vec3 {
  const h = yawDeg * DEG, p = pitchDeg * DEG;
  return [Math.sin(h) * Math.cos(p), Math.sin(p), -Math.cos(h) * Math.cos(p)];
}

/** The yaw of a look direction, degrees to the right of ahead; 0 looking straight up or down. */
export const yawOf = (forward: Vec3): number => (forward[0] === 0 && forward[2] === 0 ? 0 : Math.atan2(forward[0], -forward[2]) / DEG);

/** The signed angle from `from` to `to`, −180° to 180°. */
export const yawDelta = (from: number, to: number): number => ((((to - from) % 360) + 540) % 360) - 180;

/** A panel at `center` facing `eye`, upright: tipped back or forward to face it squarely. */
export function facingEye(center: Vec3, eye: Vec3, width: number, height: number): PanelPose {
  const toEye = unit(sub(eye, center));
  let right = cross([0, 1, 0], toEye);
  right = length(right) > 1e-6 ? unit(right) : [1, 0, 0];
  return { center, right, up: cross(toEye, right), width, height };
}

/** A panel at `center` standing upright, facing back along `yawDeg`. */
export function standing(center: Vec3, yawDeg: number, width: number, height: number): PanelPose {
  return { center, right: lookDirection(yawDeg + 90), up: [0, 1, 0], width, height };
}

/**
 * The size of a CSS pixel `distance` metres away when `pxPerDeg` of them
 * span a degree. A headset's own pixels are about 25 a degree; 16 CSS px a
 * degree draws a page's text as large as a laptop's at arm's length.
 */
export const metresPerPx = (distance: number, pxPerDeg: number): number => (distance * Math.tan(DEG)) / pxPerDeg;

export interface DockLayout {
  /** Metres from the eye. */
  distance: number;
  /** Between the middle of the view and each window's inner edge. */
  gapDeg: number;
  /** The windows' tops above the eye. */
  topDeg: number;
  metresPerPx: number;
}

/** Windows beside the middle of the view, their tops a little above the eye: the page's corners, around the head. */
export const DOCK: DockLayout = { distance: 1.2, gapDeg: 12, topDeg: 18, metresPerPx: metresPerPx(1.2, 16) };

/**
 * A docked window's pose: on its side of the view `homeYawDeg` looks along,
 * upright and facing the eye. A tall window rises until its bottom is
 * `bottomDeg` above the eye, clear of what stands below it.
 */
export function dockedPose(side: "left" | "right", eye: Vec3, homeYawDeg: number, sizePx: { width: number; height: number }, layout: DockLayout = DOCK,
  bottomDeg = -90): PanelPose {
  const width = sizePx.width * layout.metresPerPx, height = sizePx.height * layout.metresPerPx;
  const halfDeg = Math.atan(width / 2 / layout.distance) / DEG;
  const yaw = homeYawDeg + (side === "left" ? -1 : 1) * (layout.gapDeg + halfDeg);
  const ahead = lookDirection(yaw);
  const top = eye[1] + Math.max(layout.distance * Math.tan(layout.topDeg * DEG), layout.distance * Math.tan(Math.max(-89, bottomDeg) * DEG) + height);
  return standing([eye[0] + ahead[0] * layout.distance, top - height / 2, eye[2] + ahead[2] * layout.distance], yaw, width, height);
}

/** How far above the eye, in degrees, the highest of `poses`' top edges is seen: what a docked window clears. */
export function topDeg(eye: Vec3, poses: readonly PanelPose[]): number {
  let highest = -90;
  for (const pose of poses) {
    for (const u of [0, 0.5, 1]) {
      const [x, y, z] = sub(panelPoint(pose, u, 0), eye);
      highest = Math.max(highest, Math.atan2(y, Math.hypot(x, z)) / DEG);
    }
  }
  return highest;
}

export interface HudLayout {
  distance: number;
  /** Below the horizon: looked at with a glance down, as a dashboard. */
  pitchDeg: number;
  metresPerPx: number;
  /** Between the toolbar's parts. */
  gapPx: number;
}

export const HUD: HudLayout = { distance: 0.8, pitchDeg: -26, metresPerPx: metresPerPx(0.8, 18), gapPx: 12 };

/**
 * The toolbar's parts in a row, `yawDeg` ahead and below the horizon, the row
 * facing the eye: each part's pose, left to right, for widths in CSS px of
 * `heightPx` high.
 */
export function hudRow(eye: Vec3, yawDeg: number, widthsPx: readonly number[], heightPx: number, layout: HudLayout = HUD): PanelPose[] {
  const s = layout.metresPerPx;
  const total = widthsPx.reduce((sum, width) => sum + width, 0) + layout.gapPx * Math.max(0, widthsPx.length - 1);
  const middle = add(eye, scale(lookDirection(yawDeg, layout.pitchDeg), layout.distance));
  const row = facingEye(middle, eye, total * s, heightPx * s);
  let left = -total / 2;
  return widthsPx.map(width => {
    const center = add(middle, scale(row.right, (left + width / 2) * s));
    left += width + layout.gapPx;
    return { ...row, center, width: width * s };
  });
}

/**
 * What stays in view above the toolbar, such as a vehicle's instruments: its
 * parts stand on the toolbar's row, `toolbarHeightPx` high, and in its plane,
 * their bottoms `HUD.gapPx` above it. Those in the page's left half go left of
 * the middle and those in its right half to the right, `middlePx` apart, as
 * the page has them in its corners, so the view ahead stays clear.
 */
export function instrumentRow(eye: Vec3, yawDeg: number, parts: readonly PageRect[], pageWidth: number, toolbarHeightPx: number,
  middlePx = 240, layout: HudLayout = HUD): PanelPose[] {
  const s = layout.metresPerPx;
  const middle = add(eye, scale(lookDirection(yawDeg, layout.pitchDeg), layout.distance));
  const row = facingEye(middle, eye, 1, 1);
  const bottom = toolbarHeightPx / 2 + layout.gapPx;
  const across = new Map<PageRect, number>();
  const left = parts.filter(part => part.x + part.width / 2 < pageWidth / 2).sort((a, b) => b.x - a.x);
  const right = parts.filter(part => !left.includes(part)).sort((a, b) => a.x - b.x);
  let edge = -middlePx / 2;
  for (const part of left) { across.set(part, edge - part.width / 2); edge -= part.width + layout.gapPx; }
  edge = middlePx / 2;
  for (const part of right) { across.set(part, edge + part.width / 2); edge += part.width + layout.gapPx; }
  return parts.map(part => ({
    ...row,
    center: add(middle, add(scale(row.right, across.get(part)! * s), scale(row.up, (bottom + part.height / 2) * s))),
    width: part.width * s, height: part.height * s,
  }));
}

/**
 * The page's parts in a row of boxes, left to right: boxes nearer than
 * `gapPx` across are one part, as tall as its boxes together. A toolbar
 * across the page draws its two ends, without the empty middle.
 */
export function rowParts(boxes: readonly PageRect[], gapPx: number): PageRect[] {
  const sorted = boxes.filter(box => box.width > 0 && box.height > 0).sort((a, b) => a.x - b.x);
  const parts: { left: number; right: number; top: number; bottom: number }[] = [];
  for (const box of sorted) {
    const last = parts[parts.length - 1];
    if (last && box.x <= last.right + gapPx) {
      last.right = Math.max(last.right, box.x + box.width);
      last.top = Math.min(last.top, box.y);
      last.bottom = Math.max(last.bottom, box.y + box.height);
    } else parts.push({ left: box.x, right: box.x + box.width, top: box.y, bottom: box.y + box.height });
  }
  return parts.map(part => ({ x: part.left, y: part.top, width: part.right - part.left, height: part.bottom - part.top }));
}

/** The CSS px between two page boxes; 0 where they overlap. */
export function rectGap(a: PageRect, b: PageRect): number {
  const dx = Math.max(0, a.x - (b.x + b.width), b.x - (a.x + a.width));
  const dy = Math.max(0, a.y - (b.y + b.height), b.y - (a.y + a.height));
  return Math.hypot(dx, dy);
}

/**
 * A popup's pose: on the panel it opened from, at its place on the page, a
 * little nearer the eye; with no such panel, standing on `fallback`, as a
 * menu opens above the button that opened it.
 */
export function popupPose(popup: PageRect, holder: { pose: PanelPose; source: PageRect } | null, fallback: PanelPose, liftM = 0.02, fallbackMetresPerPx = HUD.metresPerPx): PanelPose {
  if (holder) {
    const { pose, source } = holder;
    const s = pose.width / source.width;
    const topLeft = panelPoint(pose, 0, 0);
    const across = (popup.x - source.x + popup.width / 2) * s, down = (popup.y - source.y + popup.height / 2) * s;
    const normal = cross(pose.right, pose.up);
    const center = add(add(topLeft, scale(pose.right, across)), add(scale(pose.up, -down), scale(normal, liftM)));
    return { ...pose, center, width: popup.width * s, height: popup.height * s };
  }
  const s = fallbackMetresPerPx, width = popup.width * s, height = popup.height * s;
  const normal = cross(fallback.right, fallback.up);
  const corner = panelPoint(fallback, 0, 0);
  const center = add(add(corner, scale(fallback.right, width / 2)), add(scale(fallback.up, height / 2 + 0.01), scale(normal, liftM)));
  return { ...fallback, center, width, height };
}

/**
 * A held panel's pose: the point held stays on the ray at `distance`, `grip`
 * metres right and up of the panel's centre, the panel facing the eye.
 */
export function heldPose(origin: Vec3, direction: Vec3, distance: number, grip: { right: number; up: number }, eye: Vec3, width: number, height: number): PanelPose {
  const point = add(origin, scale(unit(direction), distance));
  const pose = facingEye(point, eye, width, height);
  const center = sub(point, add(scale(pose.right, grip.right), scale(pose.up, grip.up)));
  return { ...pose, center };
}

/** The angle between two points as seen from the eye: how far a dropped window is from its place. */
export function apartDeg(eye: Vec3, a: Vec3, b: Vec3): number {
  const p = unit(sub(a, eye)), q = unit(sub(b, eye));
  return Math.atan2(length(cross(p, q)), dot(p, q)) / DEG;
}

export interface LazyYawOptions {
  /** How far the head turns away before the toolbar follows. */
  startDeg: number;
  /** How near it comes before it stops. */
  stopDeg: number;
  /** The share of the way it closes each second, as a rate: 1 − e^(−rate·t). */
  rate: number;
}

/**
 * A yaw that follows the head lazily: still while the head looks about, it
 * turns after the head once it looks far away, and stops when it is nearly
 * ahead again. A toolbar fixed to the head would swing with every glance.
 */
export function createLazyYaw(options: LazyYawOptions = { startDeg: 25, stopDeg: 3, rate: 5 }): (headYawDeg: number, dtS: number) => number {
  let yaw: number | null = null;
  let moving = false;
  return (head, dt) => {
    if (yaw === null || !Number.isFinite(yaw)) { yaw = head; return yaw; }
    const delta = yawDelta(yaw, head);
    if (Math.abs(delta) > options.startDeg) moving = true;
    if (moving) {
      yaw += delta * (1 - Math.exp(-options.rate * Math.max(0, dt)));
      if (Math.abs(yawDelta(yaw, head)) < options.stopDeg) moving = false;
    }
    return yaw;
  };
}
