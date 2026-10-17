import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markBoot, markBootOnFrame, markBootSettled, SETTLED_QUIET_MS } from "./bootMarks";

function frameSource() {
  let listener: (() => void) | null = null;
  return {
    onFrame(next: () => void) { listener = next; return () => { listener = null; }; },
    draw() { listener?.(); },
    get watched() { return listener !== null; },
  };
}
function activity(rendering: boolean) {
  let listener: ((active: boolean) => void) | null = null;
  return {
    isRendering: () => rendering,
    onActiveRenderChange: vi.fn((next: (active: boolean) => void) => { listener = next; return () => { listener = null; }; }),
    set(active: boolean) { rendering = active; listener?.(active); },
    get watched() { return listener !== null; },
  };
}
// Date stands in for performance.now(): faking performance would take its marks away too.
const clock = { now: () => Date.now(), setTimeout: (callback: () => void, ms: number) => Number(globalThis.setTimeout(callback, ms)), clearTimeout: (handle: number) => globalThis.clearTimeout(handle) };
const marks = (name: string) => performance.getEntriesByName(name, "mark");

beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }); performance.clearMarks(); });
afterEach(() => { vi.useRealTimers(); performance.clearMarks(); });

describe("startup marks", () => {
  it("keeps the first mark of each step", () => {
    markBoot("boot:renderer", { detail: "webgpu" });
    markBoot("boot:renderer", { detail: "webgl2" });
    expect(marks("boot:renderer").map(mark => (mark as PerformanceMark).detail)).toEqual(["webgpu"]);
  });

  it("marks a step after the first frame that draws it, then stops watching", () => {
    const frames = frameSource();
    let tiles = 0;
    markBootOnFrame("boot:globe", frames, () => tiles > 0);
    frames.draw();
    expect(marks("boot:globe")).toHaveLength(0);
    tiles = 1;
    frames.draw();
    expect(marks("boot:globe")).toHaveLength(1);
    expect(frames.watched).toBe(false);
  });

  it("marks no drawn step once its watch is stopped", () => {
    const frames = frameSource();
    markBootOnFrame("boot:content", frames, () => true)();
    frames.draw();
    expect(marks("boot:content")).toHaveLength(0);
    expect(frames.watched).toBe(false);
  });

  it("marks settled where frames stopped, once they stay stopped for a second after the first frame", () => {
    const frames = activity(true);
    const stop = markBootSettled(frames, clock);
    markBoot("boot:first-frame");
    vi.advanceTimersByTime(300);
    frames.set(false);
    const stoppedAt = Date.now();
    vi.advanceTimersByTime(SETTLED_QUIET_MS - 100);
    frames.set(true);
    vi.advanceTimersByTime(500);
    expect(marks("boot:settled")).toHaveLength(0);
    frames.set(false);
    const settledAt = Date.now();
    vi.advanceTimersByTime(SETTLED_QUIET_MS);
    expect(marks("boot:settled")).toHaveLength(1);
    expect(marks("boot:settled")[0]!.startTime).toBe(settledAt);
    expect(settledAt).toBeGreaterThan(stoppedAt);
    expect(frames.watched).toBe(false);
    stop();
  });

  it("does not take quiet before the first frame for settled", () => {
    const frames = activity(false);
    markBootSettled(frames, clock);
    vi.advanceTimersByTime(SETTLED_QUIET_MS * 3);
    expect(marks("boot:settled")).toHaveLength(0);
    markBoot("boot:first-frame");
    vi.advanceTimersByTime(SETTLED_QUIET_MS);
    expect(marks("boot:settled")).toHaveLength(1);
  });

  it("stops watching when the app is destroyed first", () => {
    const frames = activity(false);
    const stop = markBootSettled(frames, clock);
    stop();
    markBoot("boot:first-frame");
    vi.advanceTimersByTime(SETTLED_QUIET_MS * 2);
    expect(marks("boot:settled")).toHaveLength(0);
    expect(frames.watched).toBe(false);
  });
});
