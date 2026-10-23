import { describe, expect, it } from "vitest";
import { enuFrame, type Vec3 } from "@foss-earth/engine";
import {
  createSnapTurn, flatDepthProjection, headingAt, headsetDepthRange, headsetSpaceRotation, pointedAt, reverseProjectionDepth, seatRotation,
} from "./xrMath";

const row = (m: number[], index: number): Vec3 => [m[index * 4]!, m[index * 4 + 1]!, m[index * 4 + 2]!];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const close = (a: Vec3, b: Vec3): void => a.forEach((value, i) => expect(value).toBeCloseTo(b[i]!, 9));

describe("seatRotation", () => {
  it("looks along the seat's forward with its up, squared, as a right-handed rotation", () => {
    // A seat pitched 10° up and rolled: its up is not quite square to its forward.
    const forward: Vec3 = [0, Math.sin(0.17), -Math.cos(0.17)];
    const m = seatRotation(forward, [0.2, 1, 0.3])!;
    const [x, y, z] = [row(m, 0), row(m, 1), row(m, 2)];
    close(z, forward.map(v => -v) as Vec3);
    for (const axis of [x, y, z]) expect(dot(axis, axis)).toBeCloseTo(1, 12);
    expect(dot(x, y)).toBeCloseTo(0, 12);
    expect(dot(y, z)).toBeCloseTo(0, 12);
    close([x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]], z);
    expect(y[1]).toBeGreaterThan(0.9);
    expect(seatRotation([0, 1, 0], [0, 2, 0])).toBeNull();
    expect(seatRotation([0, 0, 0], [0, 1, 0])).toBeNull();
  });
});

describe("headsetSpaceRotation", () => {
  const frame = enuFrame(-93.265, 44.978);

  it("looks north at heading 0 and east at 90, upright", () => {
    const north = headsetSpaceRotation(frame, 0);
    close(row(north, 0), frame.east);
    close(row(north, 1), frame.up);
    close(row(north, 2), frame.north.map(v => -v) as Vec3);
    const east = headsetSpaceRotation(frame, 90);
    close(row(east, 2), frame.east.map(v => -v) as Vec3);
    close(row(east, 0), frame.north.map(v => -v) as Vec3);
  });

  it("is an orthonormal right-handed rotation at any heading", () => {
    for (const heading of [0, 37, 180, 271]) {
      const m = headsetSpaceRotation(frame, heading);
      const [x, y, z] = [row(m, 0), row(m, 1), row(m, 2)];
      for (const axis of [x, y, z]) expect(dot(axis, axis)).toBeCloseTo(1, 12);
      expect(dot(x, y)).toBeCloseTo(0, 12);
      expect(dot(y, z)).toBeCloseTo(0, 12);
      expect(dot(z, x)).toBeCloseTo(0, 12);
      // x × y = z
      close([x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]], z);
    }
  });

  it("round-trips the heading its forward looks along", () => {
    for (const heading of [0, 45, 135, 300]) {
      const back = row(headsetSpaceRotation(frame, heading), 2);
      expect(headingAt(frame, back.map(v => -v) as Vec3)).toBeCloseTo(heading, 9);
    }
  });

  it("keeps the fallback heading looking straight down", () => {
    expect(headingAt(frame, frame.up.map(v => -v) as Vec3, 123)).toBe(123);
  });
});

describe("reverseProjectionDepth", () => {
  // Babylon's right-handed perspective, near 0.1, far 100, row-vector layout.
  const conventional = (): number[] => {
    const near = 0.1, far = 100;
    const values = Array<number>(16).fill(0);
    values[0] = 1; values[5] = 1;
    values[10] = -(far + near) / (far - near);
    values[11] = -1;
    values[14] = -2 * far * near / (far - near);
    return values;
  };

  it("negates clip z, once", () => {
    const values = conventional();
    expect(reverseProjectionDepth(values)).toBe(true);
    const reversed = conventional();
    for (const index of [2, 6, 10, 14]) reversed[index] = -reversed[index]!;
    expect(values).toEqual(reversed);
    expect(reverseProjectionDepth(values)).toBe(false);
    expect(values).toEqual(reversed);
  });
});

describe("headsetDepthRange", () => {
  it("rounds outward to quarter powers of two", () => {
    const range = headsetDepthRange(0.3, 5000);
    expect(range.near).toBeLessThanOrEqual(0.3);
    expect(range.near).toBeGreaterThan(0.3 / 2 ** 0.25);
    expect(range.far).toBeGreaterThanOrEqual(5000);
    expect(range.far).toBeLessThan(5000 * 2 ** 0.25);
  });

  it("keeps small changes on the same step", () => {
    expect(headsetDepthRange(0.3, 5000)).toEqual(headsetDepthRange(0.301, 5010));
  });

  it("replaces planes that are not usable", () => {
    expect(headsetDepthRange(Number.NaN, 0)).toEqual(headsetDepthRange(0.1, 1e6));
  });
});

describe("createSnapTurn", () => {
  it("turns once per lean, re-arming near the centre", () => {
    const turn = createSnapTurn();
    expect(turn(0.5)).toBe(0);
    expect(turn(0.8)).toBe(30);
    expect(turn(1)).toBe(0);
    expect(turn(0.5)).toBe(0);
    expect(turn(0.9)).toBe(0);
    expect(turn(0.1)).toBe(0);
    expect(turn(-0.9)).toBe(-30);
    expect(turn(Number.NaN)).toBe(0);
  });
});

describe("pointedAt", () => {
  const items = [
    { id: "north", direction: [0, 10, 0] as Vec3, reachDeg: 4 },
    { id: "near-north", direction: [0.5, 10, 0] as Vec3, reachDeg: 4 },
    { id: "east", direction: [10, 0, 0] as Vec3, reachDeg: 4 },
  ];

  it("chooses the item nearest the ray within its reach", () => {
    expect(pointedAt(items, [0.01, 1, 0])?.id).toBe("north");
    expect(pointedAt(items, [0.04, 1, 0])?.id).toBe("near-north");
    expect(pointedAt(items, [1, 0.01, 0])?.id).toBe("east");
  });

  it("chooses none outside every reach, or along no ray", () => {
    expect(pointedAt(items, [1, 1, 0])).toBeNull();
    expect(pointedAt(items, [0, 0, 0])).toBeNull();
  });
});

describe("flatDepthProjection", () => {
  it("puts every point ahead halfway in depth, so none nearer than the near plane is clipped, and keeps where it is on screen", () => {
    // A right-handed perspective, near 1 m, far 1000 m, row vectors.
    const near = 1, far = 1000;
    const values = [1.2, 0, 0, 0, 0, 1.6, 0, 0, 0.1, 0, -(far + near) / (far - near), -1, 0, 0, (-2 * far * near) / (far - near), 0];
    const clip = (m: number[], p: Vec3): number[] => [0, 1, 2, 3].map(c => p[0] * m[c]! + p[1] * m[4 + c]! + p[2] * m[8 + c]! + m[12 + c]!);
    const flat = flatDepthProjection([...values]);
    for (const point of [[0.1, -0.3, -0.4], [2, 1, -50]] as Vec3[]) {
      const [x, y, z, w] = clip(flat, point);
      expect(z! / w!).toBeCloseTo(0.5, 12);
      const before = clip(values, point);
      expect(x! / w!).toBeCloseTo(before[0]! / before[3]!, 12);
      expect(y! / w!).toBeCloseTo(before[1]! / before[3]!, 12);
    }
  });
});
