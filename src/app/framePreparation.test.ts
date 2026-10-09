import { describe, expect, it, vi } from "vitest";
import type { GlobeFramePreparation } from "@foss-earth/engine/babylon";
import { createEarthFeatureFramePreparation } from "./framePreparation";

const frame = (nowMs: number, deltaSeconds: number) => ({ nowMs, deltaSeconds } as GlobeFramePreparation);

describe("Earth image preparation in the existing world frame", () => {
  it("passes the owner's timestamp and elapsed time once, requesting a paint only for a visible change", () => {
    const onFrame = vi.fn(() => true), requestRender = vi.fn();
    const preparation = createEarthFeatureFramePreparation({ viewer: { onFrame }, isCurrent: () => true, requestRender });
    preparation.prepare(frame(730, 0.025));
    expect(onFrame).toHaveBeenCalledExactlyOnceWith({ now: 730, dtMs: 25 });
    expect(requestRender).toHaveBeenCalledTimes(1);
  });

  it("does not paint for settled viewer bookkeeping", () => {
    const onFrame = vi.fn(() => false), requestRender = vi.fn();
    const preparation = createEarthFeatureFramePreparation({ viewer: { onFrame }, isCurrent: () => true, requestRender });
    preparation.prepare(frame(731, 0));
    expect(onFrame).toHaveBeenCalledExactlyOnceWith({ now: 731, dtMs: 0 });
    expect(requestRender).not.toHaveBeenCalled();
  });

  it("does no viewer work after its host generation is released", () => {
    const onFrame = vi.fn(() => true), requestRender = vi.fn();
    const preparation = createEarthFeatureFramePreparation({ viewer: { onFrame }, isCurrent: () => false, requestRender });
    preparation.prepare(frame(732, 0.016));
    expect(onFrame).not.toHaveBeenCalled(); expect(requestRender).not.toHaveBeenCalled();
  });

  it("does not publish a paint if the viewer releases its host during preparation", () => {
    let current = true;
    const onFrame = vi.fn(() => { current = false; return true; }), requestRender = vi.fn();
    const preparation = createEarthFeatureFramePreparation({ viewer: { onFrame }, isCurrent: () => current, requestRender });
    preparation.prepare(frame(733, 0.016));
    expect(onFrame).toHaveBeenCalledTimes(1); expect(requestRender).not.toHaveBeenCalled();
  });
});
