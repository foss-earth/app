/** Placement-gizmo math: geographic nudges, and the drag that follows an axis or a ring. */
import {
  add, cross, dot, enuFrame, geodeticPoint, length, normalize, pointGeodetic, scale, sub, type Vec3,
} from "@foss-earth/engine";

export type PoseHandle = "east" | "north" | "up" | "heading" | "pitch" | "spin";
export const POSE_HANDLES: readonly PoseHandle[] = ["heading", "pitch", "east", "north", "up", "spin"];
/** Where the gizmo sits in front of the eye while the view is inside a photograph. */
export const INSIDE_GIZMO_METERS = 3.5;

/** Straight ahead, so the gizmo stays in the center of the photograph. */
export function insideGizmoAnchor(eye: Vec3, forward: Vec3): Vec3 {
  return add(eye, scale(forward, INSIDE_GIZMO_METERS));
}

export interface ViewFrame {
  eye: Vec3;
  view: { forward: Vec3; right: Vec3; up: Vec3; verticalFovRad: number; aspect: number };
}

export function wrapHeading(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

export function clampPitch(deg: number): number {
  return Math.min(90, Math.max(-90, deg));
}

/** Longitude in [-180, 180), which a scene file accepts. */
export function wrapLongitude(deg: number): number {
  const wrapped = ((deg + 180) % 360 + 360) % 360 - 180;
  return wrapped === 180 ? -180 : wrapped;
}

export function clampLatitude(deg: number): number {
  return Math.min(90, Math.max(-90, deg));
}

/**
 * Turns the east/north pair clockwise from above.
 * Zero leaves red pointing east and blue pointing north.
 */
export function rotateHeading(east: Vec3, north: Vec3, headingDeg: number): { east: Vec3; north: Vec3 } {
  const rad = wrapHeading(headingDeg) * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    east: add(scale(east, cos), scale(north, -sin)),
    north: add(scale(east, sin), scale(north, cos)),
  };
}

/** Geographic east/north metres for a move along a rotated red or blue arrow. */
export function axisShift(headingDeg: number, handle: "east" | "north", deltaMeters: number): { eastMeters: number; northMeters: number } {
  const rad = wrapHeading(headingDeg) * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return handle === "east"
    ? { eastMeters: deltaMeters * cos, northMeters: deltaMeters * -sin }
    : { eastMeters: deltaMeters * sin, northMeters: deltaMeters * cos };
}

/** Moves a geographic point east and north on the ellipsoid, keeping its height out of the shift. */
export function shiftCapture(longitudeDeg: number, latitudeDeg: number, eastMeters: number, northMeters: number): { longitudeDeg: number; latitudeDeg: number } {
  const frame = enuFrame(longitudeDeg, latitudeDeg);
  const origin = geodeticPoint(longitudeDeg, latitudeDeg, 0);
  const moved = add(origin, add(scale(frame.east, eastMeters), scale(frame.north, northMeters)));
  const geo = pointGeodetic(moved);
  return { longitudeDeg: wrapLongitude(geo.longitudeDeg), latitudeDeg: clampLatitude(geo.latitudeDeg) };
}

/** Metres along `axis` where the view ray passes nearest that axis. Null when the ray runs along it. */
export function axisTravel(eye: Vec3, ray: Vec3, origin: Vec3, axis: Vec3): number | null {
  const lineDir = normalize(axis);
  const rayDir = normalize(ray);
  const across = sub(origin, eye);
  const b = dot(lineDir, rayDir);
  const denom = 1 - b * b;
  if (denom < 1e-8) return null;
  const d = dot(lineDir, across);
  const e = dot(rayDir, across);
  return (b * e - d) / denom;
}

/** The ray's hit on the plane through `origin`, as a vector out from the origin in that plane. */
export function ringPoint(eye: Vec3, ray: Vec3, origin: Vec3, axis: Vec3): Vec3 | null {
  const normal = normalize(axis);
  const rayDir = normalize(ray);
  const denom = dot(rayDir, normal);
  if (Math.abs(denom) < 1e-6) return null;
  const t = dot(sub(origin, eye), normal) / denom;
  if (t <= 1e-4) return null;
  const hit = add(eye, scale(rayDir, t));
  const radial = sub(sub(hit, origin), scale(normal, dot(sub(hit, origin), normal)));
  return length(radial) < 1e-6 ? null : radial;
}

/** Degrees of right-handed rotation about `axis` that takes `from` to `to`. */
export function signedAngleDeg(axis: Vec3, from: Vec3, to: Vec3): number {
  const normal = normalize(axis);
  const flat = (value: Vec3): Vec3 | null => {
    const radial = sub(value, scale(normal, dot(value, normal)));
    const size = length(radial);
    return size < 1e-8 ? null : scale(radial, 1 / size);
  };
  const start = flat(from);
  const end = flat(to);
  if (!start || !end) return 0;
  return Math.atan2(dot(cross(start, end), normal), dot(start, end)) * (180 / Math.PI);
}

/** Heading increases clockwise seen from above, so it is the opposite of a right-handed turn about up. */
export function headingDragDeg(up: Vec3, from: Vec3, to: Vec3): number {
  return -signedAngleDeg(up, from, to);
}

/** Positive pitch turns the northward direction up, a right-handed turn about east. */
export function pitchDragDeg(east: Vec3, from: Vec3, to: Vec3): number {
  return signedAngleDeg(east, from, to);
}

/** Clockwise degrees on a y-down screen, from one pointer position to the next, around the gizmo. */
export function screenTurnDeg(hubX: number, hubY: number, fromX: number, fromY: number, toX: number, toY: number): number | null {
  const ax = fromX - hubX;
  const ay = fromY - hubY;
  const bx = toX - hubX;
  const by = toY - hubY;
  if (ax * ax + ay * ay < 36 || bx * bx + by * by < 36) return null;
  let delta = (Math.atan2(by, bx) - Math.atan2(ay, ax)) * 180 / Math.PI;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
}

/**
 * Heading and pitch from a clockwise screen turn.
 * `axisTowardEye` is the rotation axis dotted with the direction from the gizmo to the eye.
 * Clockwise from above increases heading. A right-handed turn about east increases pitch.
 */
export function ringScreenDragDeg(handle: "heading" | "pitch", axisTowardEye: number, turnDeg: number): number {
  const facing = axisTowardEye >= 0 ? 1 : -1;
  return handle === "heading" ? facing * turnDeg : -facing * turnDeg;
}

export function viewRay(frame: ViewFrame, x: number, y: number): Vec3 {
  const tanHalf = Math.tan(frame.view.verticalFovRad / 2);
  return normalize(add(frame.view.forward, add(
    scale(frame.view.right, (2 * x - 1) * tanHalf * frame.view.aspect),
    scale(frame.view.up, (1 - 2 * y) * tanHalf),
  )));
}

export function projectPoint(
  frame: ViewFrame, point: Vec3, rect: { left: number; top: number; width: number; height: number },
): { x: number; y: number; depth: number } | null {
  const rel = sub(point, frame.eye);
  const depth = dot(rel, frame.view.forward);
  if (depth <= 1e-4) return null;
  const tanHalf = Math.tan(frame.view.verticalFovRad / 2);
  const nx = dot(rel, frame.view.right) / (depth * tanHalf * Math.max(1e-6, frame.view.aspect));
  const ny = dot(rel, frame.view.up) / (depth * tanHalf);
  return { x: rect.left + ((nx + 1) / 2) * rect.width, y: rect.top + ((1 - ny) / 2) * rect.height, depth };
}

/** Arm length that stays about `pixels` tall on screen, and at least a hand's width up close. */
export function gizmoArmMeters(distanceMeters: number, verticalFovRad: number, viewportHeightPx: number, pixels = 72): number {
  const metersPerPx = (2 * Math.max(distanceMeters, 0.25) * Math.tan(verticalFovRad / 2)) / Math.max(1, viewportHeightPx);
  return Math.max(0.4, pixels * metersPerPx);
}

export interface GizmoPolyline {
  handle: PoseHandle;
  points: Vec3[];
  closed: boolean;
  head: readonly [Vec3, Vec3, Vec3] | null;
  /** A second arrow head. The axis-heading arc has one at each end. */
  headB: readonly [Vec3, Vec3, Vec3] | null;
  label: Vec3;
}

function ring(origin: Vec3, u: Vec3, v: Vec3, radius: number, steps: number): Vec3[] {
  const points: Vec3[] = [];
  for (let i = 0; i < steps; i += 1) {
    const angle = (i / steps) * Math.PI * 2;
    points.push(add(origin, add(scale(u, Math.cos(angle) * radius), scale(v, Math.sin(angle) * radius))));
  }
  return points;
}

function chevron(origin: Vec3, point: Vec3, tangent: Vec3, size: number): readonly [Vec3, Vec3, Vec3] {
  const forward = normalize(tangent);
  const radial = normalize(sub(point, origin));
  const tip = add(point, scale(forward, size));
  const back = sub(point, scale(forward, size * 0.2));
  const span = size * 0.65;
  return [tip, add(back, scale(radial, span)), add(back, scale(radial, -span))];
}

/** Axes and rings in ECEF. Heading turns about up; pitch turns about east. `axisHeadingDeg` turns only the red and blue arrows. */
export function gizmoPolylines(
  origin: Vec3, east: Vec3, north: Vec3, up: Vec3, arm: number, eye: Vec3, axisHeadingDeg = 0,
  stretch: { east?: number; north?: number; up?: number } = {},
): GizmoPolyline[] {
  const unit = (axis: Vec3) => normalize(axis);
  const eastU = unit(east);
  const northU = unit(north);
  const upU = unit(up);
  const turned = rotateHeading(eastU, northU, axisHeadingDeg);
  const axisLine = (handle: "east" | "north" | "up", direction: Vec3): GizmoPolyline => {
    const reach = arm * (stretch[handle] ?? 1);
    const dir = unit(direction);
    const tip = add(origin, scale(dir, reach));
    const neck = add(origin, scale(dir, reach * 0.78));
    const side = facingSide(dir, tip, eye);
    const wing = reach * 0.09;
    return {
      handle, closed: false, label: add(origin, scale(dir, reach * 1.14)), headB: null,
      points: [origin, neck],
      head: [tip, add(neck, scale(side, wing)), add(neck, scale(side, -wing))],
    };
  };
  const radius = arm * 0.62;
  const steps = 48;
  const headingAt = 0.9;
  const headingPoint = add(origin, add(scale(northU, Math.cos(headingAt) * radius), scale(eastU, Math.sin(headingAt) * radius)));
  const headingTangent = add(scale(northU, -Math.sin(headingAt)), scale(eastU, Math.cos(headingAt)));
  const pitchAt = 0.9;
  const pitchPoint = add(origin, add(scale(northU, Math.cos(pitchAt) * radius), scale(upU, Math.sin(pitchAt) * radius)));
  const pitchTangent = add(scale(northU, -Math.sin(pitchAt)), scale(upU, Math.cos(pitchAt)));
  return [
    {
      handle: "heading", closed: true, headB: null, label: add(origin, add(scale(northU, radius * 0.82), scale(eastU, radius * 0.82))),
      points: ring(origin, northU, eastU, radius, steps),
      head: chevron(origin, headingPoint, headingTangent, arm * 0.14),
    },
    {
      handle: "pitch", closed: true, headB: null, label: add(origin, add(scale(northU, radius * 0.92), scale(upU, radius * 0.35))),
      points: ring(origin, northU, upU, radius, steps),
      head: chevron(origin, pitchPoint, pitchTangent, arm * 0.14),
    },
    axisLine("east", turned.east),
    axisLine("north", turned.north),
    axisLine("up", upU),
  ];
}

/** One eighth of a turn around up, centered on a linear arrow, with an arrowhead leaving each side. */
export function axisSpin(origin: Vec3, direction: Vec3, up: Vec3, arm: number): GizmoPolyline {
  const dir = normalize(direction);
  const side = normalize(cross(up, dir));
  const span = Math.PI / 4;
  const steps = 8;
  const at = (angle: number): Vec3 => add(origin, add(scale(dir, Math.cos(angle) * arm), scale(side, Math.sin(angle) * arm)));
  const points: Vec3[] = [];
  for (let i = 0; i <= steps; i += 1) points.push(at(-span / 2 + (i / steps) * span));
  const arrow = (angle: number, outward: number): readonly [Vec3, Vec3, Vec3] => {
    const point = at(angle);
    const tangent = add(scale(dir, -Math.sin(angle) * outward), scale(side, Math.cos(angle) * outward));
    return chevron(origin, point, tangent, arm * 0.14);
  };
  return {
    handle: "spin", closed: false, label: at(0),
    points,
    head: arrow(span / 2, 1),
    headB: arrow(-span / 2, -1),
  };
}

function facingSide(axis: Vec3, tip: Vec3, eye: Vec3): Vec3 {
  let side = cross(axis, sub(eye, tip));
  if (length(side) < 1e-8) side = cross(axis, Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]);
  return normalize(side);
}
