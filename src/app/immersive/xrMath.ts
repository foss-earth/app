/** The headset session's pure parts: where its space sits on the Earth, its depth, and turning. */
import { enuHeadingPitch, type EnuFrame, type Vec3 } from "@foss-earth/engine";

const DEG = Math.PI / 180;

/**
 * The headset space's orientation at a place, as Babylon's row-vector
 * rotation: its x is to the right, y is up and −z looks along `headingDeg`,
 * clockwise from north.
 */
export function headsetSpaceRotation(frame: EnuFrame, headingDeg: number): number[] {
  const s = Math.sin(headingDeg * DEG), c = Math.cos(headingDeg * DEG);
  const { east, north } = frame;
  const forward: Vec3 = [east[0] * s + north[0] * c, east[1] * s + north[1] * c, east[2] * s + north[2] * c];
  const right: Vec3 = [east[0] * c - north[0] * s, east[1] * c - north[1] * s, east[2] * c - north[2] * s];
  return [
    right[0], right[1], right[2], 0,
    frame.up[0], frame.up[1], frame.up[2], 0,
    -forward[0], -forward[1], -forward[2], 0,
    0, 0, 0, 1,
  ];
}

/** The heading of an ECEF look direction at a place, keeping `fallbackDeg` when it looks straight up or down. */
export function headingAt(frame: EnuFrame, forward: Vec3, fallbackDeg = 0): number {
  const enu: Vec3 = [
    forward[0] * frame.east[0] + forward[1] * frame.east[1] + forward[2] * frame.east[2],
    forward[0] * frame.north[0] + forward[1] * frame.north[1] + forward[2] * frame.north[2],
    forward[0] * frame.up[0] + forward[1] * frame.up[1] + forward[2] * frame.up[2],
  ];
  return enuHeadingPitch(enu, fallbackDeg).headingDeg;
}

/**
 * A headset's projection, conventional depth, as the renderer's reversed
 * depth: near and far swapped, which negates clip z. `values` is Babylon's
 * row-vector matrix, changed in place. False when it already was reversed,
 * so a matrix the headset did not replace this frame is not flipped back.
 */
export function reverseProjectionDepth(values: number[]): boolean {
  // A right-handed perspective's z scale is negative with conventional depth.
  if (!(values[10]! < 0)) return false;
  for (const index of [2, 6, 10, 14]) values[index] = -values[index]!;
  return true;
}

/**
 * Near and far planes on a coarse scale, so a globe camera adjusting them
 * every frame does not change the session's render state every frame.
 */
export function headsetDepthRange(near: number, far: number): { near: number; far: number } {
  const safeNear = Number.isFinite(near) && near > 0 ? near : 0.1;
  const safeFar = Number.isFinite(far) && far > safeNear ? far : safeNear * 1e7;
  const steps = 4;
  return {
    near: 2 ** (Math.floor(Math.log2(safeNear) * steps) / steps),
    far: 2 ** (Math.ceil(Math.log2(safeFar) * steps) / steps),
  };
}

export interface SnapTurnOptions {
  stepDeg: number;
  /** How far the stick leans before it turns. */
  fire: number;
  /** How near the centre it comes back before it can turn again. */
  rearm: number;
}

/** A thumbstick's turns: one step each time it leans past `fire`, returning to centre between. */
export function createSnapTurn(options: SnapTurnOptions = { stepDeg: 30, fire: 0.7, rearm: 0.3 }): (axis: number) => number {
  let armed = true;
  return axis => {
    if (!Number.isFinite(axis)) return 0;
    if (Math.abs(axis) < options.rearm) { armed = true; return 0; }
    if (!armed || Math.abs(axis) < options.fire) return 0;
    armed = false;
    return Math.sign(axis) * options.stepDeg;
  };
}

/** The pointed-at item: the smallest angle from the ray within each item's own reach, nearest first on ties. */
export function pointedAt<T extends { direction: Vec3; reachDeg: number }>(items: readonly T[], ray: Vec3): T | null {
  let best: T | null = null;
  let bestAngle = Infinity;
  const size = Math.hypot(ray[0], ray[1], ray[2]);
  if (!(size > 0)) return null;
  for (const item of items) {
    const d = item.direction;
    const cos = (d[0] * ray[0] + d[1] * ray[1] + d[2] * ray[2]) / (size * Math.hypot(d[0], d[1], d[2]));
    const angle = Math.acos(Math.max(-1, Math.min(1, cos))) / DEG;
    if (angle <= item.reachDeg && angle < bestAngle) { best = item; bestAngle = angle; }
  }
  return best;
}
