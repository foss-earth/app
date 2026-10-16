import { cross, dot, length, normalize, sub } from "@foss-earth/engine";
import { describe, expect, it } from "vitest";
import {
  axisShift, axisSpin, axisTravel, gizmoArmMeters, gizmoPolylines, headingDragDeg, insideGizmoAnchor, pitchDragDeg, projectPoint, ringScreenDragDeg, rotateHeading, screenTurnDeg, shiftCapture, signedAngleDeg, viewRay,
} from "./poseMath";

const eye = [0, -10, 0] as const;
const frame = {
  eye: [0, 0, 0] as [number, number, number],
  view: { forward: [0, 1, 0] as [number, number, number], right: [1, 0, 0] as [number, number, number], up: [0, 0, 1] as [number, number, number], verticalFovRad: Math.PI / 2, aspect: 1 },
};

describe("placement gizmo math", () => {
  it("follows an axis the pointer ray crosses and ignores a ray that runs along it", () => {
    const through = viewRay({ ...frame, eye: [...eye] }, 0.55, 0.5);
    expect(axisTravel([...eye], through, [0, 0, 0], [1, 0, 0])).toBeCloseTo(1, 5);
    expect(axisTravel([...eye], [1, 0, 0], [0, 0, 0], [1, 0, 0])).toBeNull();
  });

  it("turns heading clockwise from above and pitch upward from north", () => {
    const up = [0, 0, 1] as const;
    const east = [1, 0, 0] as const;
    const north = [0, 1, 0] as const;
    expect(signedAngleDeg([...up], [...north], [...east])).toBeCloseTo(-90, 5);
    expect(headingDragDeg([...up], [...north], [...east])).toBeCloseTo(90, 5);
    expect(pitchDragDeg([...east], [...north], [...up])).toBeCloseTo(90, 5);
  });

  it("shifts longitude east and latitude north by about a degree per 111 km", () => {
    expect(shiftCapture(0, 0, 111319.5, 0).longitudeDeg).toBeCloseTo(1, 2);
    expect(shiftCapture(0, 0, 0, 110574).latitudeDeg).toBeCloseTo(1, 2);
  });

  it("parks the inside gizmo straight ahead, in the center of the view", () => {
    const eye = [1, 2, 3] as [number, number, number];
    expect(insideGizmoAnchor(eye, [0, 1, 0])).toEqual([1, 5.5, 3]);
    const point = projectPoint(
      { eye, view: { forward: [0, 1, 0], right: [1, 0, 0], up: [0, 0, 1], verticalFovRad: Math.PI / 2, aspect: 1 } },
      insideGizmoAnchor(eye, [0, 1, 0]),
      { left: 0, top: 0, width: 200, height: 100 },
    );
    expect(point).toMatchObject({ x: 100, y: 50 });
  });

  it("turns a ring on screen the same way the rotation axis does", () => {
    const eye = [0, -10, 8] as [number, number, number];
    const forward = normalize([0, 10, -8]);
    const right = normalize(cross(forward, [0, 0, 1]));
    const up = normalize(cross(right, forward));
    const look = { eye, view: { forward, right, up, verticalFovRad: Math.PI / 3, aspect: 1 } };
    const rect = { left: 0, top: 0, width: 400, height: 400 };
    const from = [0, 1, 0] as [number, number, number];
    const to = [0.4, Math.sqrt(1 - 0.16), 0] as [number, number, number];
    const hub = projectPoint(look, [0, 0, 0], rect);
    const a = projectPoint(look, from, rect);
    const b = projectPoint(look, to, rect);
    expect(hub && a && b).toBeTruthy();
    const turn = screenTurnDeg(hub!.x, hub!.y, a!.x, a!.y, b!.x, b!.y);
    const three = headingDragDeg([0, 0, 1], from, to);
    const screen = ringScreenDragDeg("heading", dot([0, 0, 1], eye), turn!);
    expect(turn).not.toBeNull();
    expect(Math.sign(screen)).toBe(Math.sign(three));
    expect(screen).toBeGreaterThan(0);

    const pitchFrom = [0, 1, 0] as [number, number, number];
    const pitchTo = [0, Math.sqrt(1 - 0.16), 0.4] as [number, number, number];
    const pitchEye = [8, -6, 2] as [number, number, number];
    const pitchForward = normalize([-8, 6, -2]);
    const pitchRight = normalize(cross(pitchForward, [0, 0, 1]));
    const pitchUp = normalize(cross(pitchRight, pitchForward));
    const pitchLook = { eye: pitchEye, view: { forward: pitchForward, right: pitchRight, up: pitchUp, verticalFovRad: Math.PI / 3, aspect: 1 } };
    const pitchHub = projectPoint(pitchLook, [0, 0, 0], rect)!;
    const pitchA = projectPoint(pitchLook, pitchFrom, rect)!;
    const pitchB = projectPoint(pitchLook, pitchTo, rect)!;
    const pitchTurn = screenTurnDeg(pitchHub.x, pitchHub.y, pitchA.x, pitchA.y, pitchB.x, pitchB.y)!;
    const pitchThree = pitchDragDeg([1, 0, 0], pitchFrom, pitchTo);
    const pitchScreen = ringScreenDragDeg("pitch", dot([1, 0, 0], pitchEye), pitchTurn);
    expect(Math.sign(pitchScreen)).toBe(Math.sign(pitchThree));
  });

  it("projects a point straight ahead to the middle of the canvas", () => {
    const point = projectPoint(frame, [0, 10, 0], { left: 0, top: 0, width: 200, height: 100 });
    expect(point).toMatchObject({ x: 100, y: 50 });
  });

  it("turns the red and blue arrows clockwise, and moves along the turned arrows", () => {
    const east = [1, 0, 0] as [number, number, number];
    const north = [0, 1, 0] as [number, number, number];
    const turned = rotateHeading(east, north, 90);
    expect(turned.east[0]).toBeCloseTo(0, 5);
    expect(turned.east[1]).toBeCloseTo(-1, 5);
    expect(turned.north[0]).toBeCloseTo(1, 5);
    expect(turned.north[1]).toBeCloseTo(0, 5);
    expect(axisShift(0, "east", 10).eastMeters).toBeCloseTo(10, 5);
    expect(axisShift(0, "east", 10).northMeters).toBeCloseTo(0, 5);
    expect(axisShift(90, "east", 10).northMeters).toBeCloseTo(-10, 5);
    expect(axisShift(90, "north", 10).eastMeters).toBeCloseTo(10, 5);
    const spin = axisSpin([0, 0, 0], east, [0, 0, 1], 2);
    const mid = spin.points[4]!;
    const end = spin.points[0]!;
    expect(spin.closed).toBe(false);
    expect(mid[0]).toBeCloseTo(2, 5);
    expect(mid[1]).toBeCloseTo(0, 5);
    expect(Math.hypot(end[0], end[1])).toBeCloseTo(2, 5);
    expect(Math.abs(Math.atan2(end[1], end[0]) * 180 / Math.PI)).toBeCloseTo(22.5, 1);
    expect(spin.headB).not.toBeNull();
  });

  it("keeps a distant arm a chosen number of pixels tall", () => {
    const arm = gizmoArmMeters(1000, Math.PI / 3, 1000, 72);
    const metersPerPx = (2 * 1000 * Math.tan(Math.PI / 6)) / 1000;
    expect(arm).toBeCloseTo(72 * metersPerPx, 5);
  });

  it("keeps every ring, shaft and arrowhead outside map orbs of different displayed sizes", () => {
    const origin = [100, 200, 300] as [number, number, number];
    for (const radius of [0.1, 3, 50, 200]) {
      const arm = gizmoArmMeters(1000, Math.PI / 3, 1000, 72, radius);
      const lines = gizmoPolylines(origin, [1, 0, 0], [0, 1, 0], [0, 0, 1], arm, [1000, 1000, 1000], 37, radius);
      lines.push(axisSpin(origin, [1, 0, 0], [0, 0, 1], arm));
      for (const line of lines) {
        for (const point of [...line.points, ...(line.head ?? []), ...(line.headB ?? []), line.label]) {
          expect(length(sub(point, origin)), `${line.handle} at radius ${radius}`).toBeGreaterThan(radius);
        }
      }
    }
  });
});
