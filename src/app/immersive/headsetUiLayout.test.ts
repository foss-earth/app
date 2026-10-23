import { describe, expect, it } from "vitest";
import { dot, sub, type Vec3 } from "@foss-earth/engine";
import {
  apartDeg, createLazyYaw, DOCK, dockedPose, facingEye, heldPose, HUD, hudRow, instrumentRow, lookDirection, pagePoint, panelPoint, popupPose,
  rayPanel, rectGap, rowParts, sourceUv, standing, topDeg, yawDelta, yawOf, type PanelPose,
} from "./headsetUiLayout";

const close = (a: Vec3, b: Vec3, digits = 9): void => a.forEach((value, i) => expect(value).toBeCloseTo(b[i]!, digits));
const eye: Vec3 = [0, 1.6, 0];
const ahead = (distance: number): PanelPose => standing([0, 1.6, -distance], 0, 0.4, 0.3);

describe("a ray on a panel", () => {
  it("is at the panel's (u, v) from its top left, and how far along the ray", () => {
    const panel = ahead(2);
    const hit = rayPanel(eye, [0, 0, -1], panel)!;
    expect(hit.u).toBeCloseTo(0.5, 12);
    expect(hit.v).toBeCloseTo(0.5, 12);
    expect(hit.distance).toBeCloseTo(2, 12);
    const corner = rayPanel(eye, [-0.2 + 1e-9, 0.15 - 1e-9, -2], panel)!;
    expect(corner.u).toBeCloseTo(0, 6);
    expect(corner.v).toBeCloseTo(0, 6);
    close(panelPoint(panel, corner.u, corner.v), corner.point, 6);
  });

  it("misses beside the panel, from behind it and away from it", () => {
    const panel = ahead(2);
    expect(rayPanel(eye, [0.3, 0, -2], panel)).toBeNull();
    expect(rayPanel([0, 1.6, -3], [0, 0, 1], panel)).toBeNull();
    expect(rayPanel(eye, [0, 0, 1], panel)).toBeNull();
    expect(rayPanel(eye, [1, 0, 0], panel)).toBeNull();
  });

  it("follows a held press off the panel's edge", () => {
    const hit = rayPanel(eye, [0.3, 0, -2], ahead(2), false)!;
    expect(hit.u).toBeCloseTo(0.5 + 0.3 / 0.4, 9);
  });
});

describe("a panel's page", () => {
  it("is its source at the same (u, v), and back", () => {
    const source = { x: 960, y: 0, width: 320, height: 512 };
    expect(pagePoint(source, 0.5, 0.25)).toEqual({ x: 1120, y: 128 });
    expect(sourceUv(source, 1120, 128)).toEqual({ u: 0.5, v: 0.25 });
  });
});

describe("directions in the headset space", () => {
  it("turn right with yaw and up with pitch", () => {
    close(lookDirection(0), [0, 0, -1]);
    close(lookDirection(90), [1, 0, 0]);
    close(lookDirection(0, 90), [0, 1, 0]);
    expect(yawOf(lookDirection(-40, 20))).toBeCloseTo(-40, 9);
    expect(yawOf([0, 1, 0])).toBe(0);
    expect(yawDelta(350, 10)).toBeCloseTo(20, 9);
    expect(yawDelta(10, 350)).toBeCloseTo(-20, 9);
  });

  it("face a panel squarely toward the eye, upright", () => {
    const pose = facingEye([0, 1.0, -1], eye, 1, 1);
    const normal: Vec3 = [pose.right[1] * pose.up[2] - pose.right[2] * pose.up[1], pose.right[2] * pose.up[0] - pose.right[0] * pose.up[2], pose.right[0] * pose.up[1] - pose.right[1] * pose.up[0]];
    const toEye = [0, 0.6, 1].map(v => v / Math.hypot(0.6, 1)) as unknown as Vec3;
    close(normal, toEye);
    close(pose.right, [1, 0, 0]);
    expect(pose.up[1]).toBeGreaterThan(0.8);
  });
});

describe("docked windows", () => {
  it("stand beside the middle of the view, their inner edges the gap from it, their tops above the eye", () => {
    const size = { width: 320, height: 512 };
    for (const side of ["left", "right"] as const) {
      const pose = dockedPose(side, eye, 0, size);
      const inner = panelPoint(pose, side === "left" ? 1 : 0, 0.5);
      expect(Math.abs(yawOf([inner[0], 0, inner[2]]))).toBeCloseTo(DOCK.gapDeg, 6);
      expect(Math.sign(pose.center[0])).toBe(side === "left" ? -1 : 1);
      const top = panelPoint(pose, 0.5, 0);
      const pitch = Math.atan2(top[1] - eye[1], Math.hypot(top[0], top[2])) * 180 / Math.PI;
      expect(pitch).toBeCloseTo(DOCK.topDeg, 6);
      expect(pose.width / size.width).toBeCloseTo(DOCK.metresPerPx, 12);
    }
  });

  it("are as large as a page read at arm's length: 16 CSS px a degree", () => {
    const pose = dockedPose("right", eye, 0, { width: 320, height: 512 });
    const widthDeg = 2 * Math.atan(pose.width / 2 / DOCK.distance) * 180 / Math.PI;
    expect(widthDeg).toBeCloseTo(20, 0);
  });

  it("rise clear of the instruments below them, and no further", () => {
    const [toolbar] = hudRow(eye, 0, [600], 28);
    const instruments = instrumentRow(eye, 0, [{ x: 0, y: 462, width: 340, height: 302 }], 1280, 28, 240);
    const clear = topDeg(eye, instruments);
    expect(clear).toBeGreaterThan(topDeg(eye, [toolbar!]));
    const size = { width: 320, height: 512 };
    const pose = dockedPose("left", eye, 0, size, DOCK, clear + 2);
    const bottom = panelPoint(pose, 0.5, 1);
    expect(Math.atan2(bottom[1] - eye[1], DOCK.distance) * 180 / Math.PI).toBeCloseTo(clear + 2, 6);
    expect(dockedPose("left", eye, 0, size, DOCK, -60)).toEqual(dockedPose("left", eye, 0, size));
  });

  it("turn with the view they were placed for", () => {
    const left = dockedPose("left", eye, 90, { width: 320, height: 512 });
    expect(yawOf(left.center.map((v, i) => v - eye[i]!) as unknown as Vec3)).toBeLessThan(90);
    expect(left.center[0]).toBeGreaterThan(0);
  });
});

describe("the toolbar's row", () => {
  it("lies below the horizon ahead, its parts left to right with a gap between", () => {
    const [plus, first, last] = hudRow(eye, 0, [40, 600, 240], 28);
    expect(plus!.center[0]).toBeLessThan(first!.center[0]);
    expect(first!.center[0]).toBeLessThan(last!.center[0]);
    const gap = (panelPoint(last!, 0, 0.5)[0] - panelPoint(first!, 1, 0.5)[0]) / HUD.metresPerPx;
    expect(gap).toBeCloseTo(HUD.gapPx, 6);
    const middle = (panelPoint(plus!, 0, 0.5)[0] + panelPoint(last!, 1, 0.5)[0]) / 2;
    expect(middle).toBeCloseTo(0, 9);
    expect(plus!.center[1]).toBeLessThan(eye[1]);
    expect(first!.height / 28).toBeCloseTo(HUD.metresPerPx, 12);
  });

  it("is the toolbar's two ends without its empty middle", () => {
    const boxes = [
      { x: 0, y: 772, width: 30, height: 28 }, { x: 30, y: 772, width: 30, height: 28 }, { x: 60, y: 772, width: 60, height: 28 }, { x: 213, y: 772, width: 320, height: 28 },
      { x: 120, y: 772, width: 93, height: 28 }, { x: 1045, y: 772, width: 235, height: 28 }, { x: 600, y: 0, width: 0, height: 0 },
    ];
    expect(rowParts(boxes, 24)).toEqual([{ x: 0, y: 772, width: 533, height: 28 }, { x: 1045, y: 772, width: 235, height: 28 }]);
    expect(rowParts([{ x: 0, y: 772, width: 30, height: 28 }, { x: 70, y: 772, width: 30, height: 28 }], 24)).toHaveLength(2);
  });
});

describe("the instruments' row", () => {
  it("stands on the toolbar's, the page's left corner to the left of the middle and its right to the right", () => {
    const [toolbar] = hudRow(eye, 0, [600], 28);
    const parts = [{ x: 0, y: 462, width: 340, height: 302 }, { x: 1008, y: 572, width: 248, height: 190 }];
    const [left, right] = instrumentRow(eye, 0, parts, 1280, 28, 240);
    const s = HUD.metresPerPx;
    expect(panelPoint(left!, 1, 0.5)[0]).toBeCloseTo(-120 * s, 9);
    expect(panelPoint(right!, 0, 0.5)[0]).toBeCloseTo(120 * s, 9);
    expect(left!.width).toBeCloseTo(340 * s, 12);
    for (const part of [left!, right!]) {
      const gap = dot(sub(panelPoint(part, 0.5, 1), panelPoint(toolbar!, 0.5, 0)), toolbar!.up) / s;
      expect(gap).toBeCloseTo(HUD.gapPx, 6);
    }
  });
});

describe("a popup", () => {
  const window = { pose: dockedPose("right", eye, 0, { width: 320, height: 512 }), source: { x: 960, y: 0, width: 320, height: 512 } };

  it("floats over the window it opened in, where the page has it, nearer the eye", () => {
    const menu = { x: 1000, y: 30, width: 200, height: 100 };
    const pose = popupPose(menu, window, window.pose);
    const s = window.pose.width / 320;
    expect(pose.width).toBeCloseTo(200 * s, 12);
    const corner = panelPoint(pose, 0, 0);
    const onWindow = panelPoint(window.pose, 40 / 320, 30 / 512);
    expect(Math.hypot(...corner.map((v, i) => v - onWindow[i]!))).toBeCloseTo(0.02, 6);
    expect(Math.hypot(...corner.map((v, i) => v - eye[i]!))).toBeLessThan(Math.hypot(...onWindow.map((v, i) => v - eye[i]!)));
  });

  it("stands on the button it opened from when no window holds it", () => {
    const [plus] = hudRow(eye, 0, [40], 28);
    const pose = popupPose({ x: 0, y: 30, width: 200, height: 100 }, null, plus!);
    expect(pose.center[1]).toBeGreaterThan(plus!.center[1]);
    expect(pose.width).toBeCloseTo(200 * HUD.metresPerPx, 12);
    expect(panelPoint(pose, 0, 1)[0]).toBeCloseTo(panelPoint(plus!, 0, 0)[0], 6);
  });

  it("belongs to the nearest panel: the gap between page boxes", () => {
    expect(rectGap({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 })).toBe(0);
    expect(rectGap({ x: 0, y: 0, width: 10, height: 10 }, { x: 13, y: 14, width: 10, height: 10 })).toBe(5);
  });
});

describe("a held window", () => {
  it("keeps the point held on the ray, facing the eye", () => {
    const pose = heldPose([0.2, 1.2, -0.2], [0, 0, -1], 1, { right: 0.1, up: -0.05 }, eye, 0.4, 0.6);
    const held: Vec3 = [0.2, 1.2, -1.2];
    close(pose.center.map((v, i) => v + pose.right[i]! * 0.1 + pose.up[i]! * -0.05) as unknown as Vec3, held, 9);
    expect(apartDeg(eye, [0, 1.6, -1], [0, 1.6, -2])).toBeCloseTo(0, 9);
    expect(apartDeg(eye, [0, 1.6, -1], [1, 1.6, 0])).toBeCloseTo(90, 9);
  });
});

describe("the toolbar following the head", () => {
  it("stays while the head looks about, then turns after it and stops nearly ahead", () => {
    const follow = createLazyYaw({ startDeg: 25, stopDeg: 3, rate: 5 });
    expect(follow(0, 0)).toBe(0);
    expect(follow(20, 0.1)).toBe(0);
    let yaw = follow(60, 0.1);
    expect(yaw).toBeGreaterThan(0);
    for (let i = 0; i < 60; i++) yaw = follow(60, 1 / 60);
    expect(Math.abs(60 - yaw)).toBeLessThan(3);
    const settled = yaw;
    expect(follow(70, 0.1)).toBe(settled);
  });

  it("turns the short way across north", () => {
    const follow = createLazyYaw({ startDeg: 25, stopDeg: 3, rate: 5 });
    follow(350, 0);
    expect(yawDelta(350, follow(40, 0.2))).toBeGreaterThan(0);
  });
});
