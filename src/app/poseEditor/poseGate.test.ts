import { describe, expect, it } from "vitest";
import { poseEditEnabled } from "./poseGate";

describe("pose edit gate", () => {
  it("opens for exactly one dev=1, including a published build", () => {
    expect(poseEditEnabled("?dev=1")).toBe(true);
    expect(poseEditEnabled("?scene=umn-single&dev=1")).toBe(true);
    expect(poseEditEnabled("?dev=1&dev=1")).toBe(false);
    expect(poseEditEnabled("?dev=true")).toBe(false);
    expect(poseEditEnabled("?dev=")).toBe(false);
    expect(poseEditEnabled("")).toBe(false);
  });
});
