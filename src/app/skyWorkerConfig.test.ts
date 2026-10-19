import { describe, expect, it } from "vitest";
import { skyWorkerConfig, skyWorkerName } from "./skyWorkerConfig";

describe("sky worker startup policy", () => {
  it("runs the TypeScript reference for missing or malformed worker names", () => {
    for (const name of ["", "invalid", "null", "{}", JSON.stringify({ kind: "earth-terrain", kernel: "single" }), JSON.stringify({ kind: "earth-sky", kernel: "fastest" })]) {
      expect(skyWorkerConfig(name)).toEqual({ kernel: "typescript", threads: 1 });
    }
  });
  it("passes the exact kernel through the worker's name", () => {
    for (const kernel of ["typescript", "single", "threaded"] as const) expect(skyWorkerConfig(skyWorkerName(kernel))).toEqual({ kernel, threads: 1 });
  });
  it("passes a threaded kernel's thread count, bounded by its stack slots, and no other kernel's", () => {
    expect(skyWorkerConfig(skyWorkerName("threaded", 4))).toEqual({ kernel: "threaded", threads: 4 });
    expect(skyWorkerConfig(skyWorkerName("threaded", 99))).toEqual({ kernel: "threaded", threads: 8 });
    expect(skyWorkerConfig(JSON.stringify({ kind: "earth-sky", kernel: "threaded", threads: "x" }))).toEqual({ kernel: "threaded", threads: 1 });
    expect(skyWorkerConfig(JSON.stringify({ kind: "earth-sky", kernel: "single", threads: 4 }))).toEqual({ kernel: "single", threads: 1 });
  });
});
