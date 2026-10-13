import { describe, expect, it } from "vitest";
import { poseEditEnabled } from "./poseGate";

describe("pose edit gate", () => {
  it("opens only for local dev with exactly one dev=1", () => {
    expect(poseEditEnabled(true, "?dev=1")).toBe(true);
    expect(poseEditEnabled(true, "?scene=umn-single&dev=1")).toBe(true);
    expect(poseEditEnabled(true, "?dev=1&dev=1")).toBe(false);
    expect(poseEditEnabled(true, "?dev=true")).toBe(false);
    expect(poseEditEnabled(true, "")).toBe(false);
    expect(poseEditEnabled(false, "?dev=1")).toBe(false);
  });
});
