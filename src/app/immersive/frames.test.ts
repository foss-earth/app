import { describe, expect, it, vi } from "vitest";
import { createImmersiveFrames, type FrameCallback, type FrameSource } from "./frames";

function fakeSource() {
  const pending = new Map<number, FrameCallback>();
  let next = 1;
  const source: FrameSource & { pending: Map<number, FrameCallback>; tick(time: number): void } = {
    pending,
    requestFrame: vi.fn((callback: FrameCallback) => { const id = next++; pending.set(id, callback); return id; }),
    cancelFrame: vi.fn((id: number) => { pending.delete(id); }),
    tick(time) { const due = [...pending.values()]; pending.clear(); for (const callback of due) callback(time); },
  };
  return source;
}

describe("createImmersiveFrames", () => {
  it("asks the window for frames until a headset presents", () => {
    const window = fakeSource();
    const frames = createImmersiveFrames(window);
    const callback = vi.fn();
    frames.port.requestFrame(callback);
    window.tick(16);
    expect(callback).toHaveBeenCalledWith(16);
    expect(frames.presenting).toBe(false);
  });

  it("moves waiting frames to the headset and back", () => {
    const window = fakeSource();
    const headset = fakeSource();
    const frames = createImmersiveFrames(window);
    const first = vi.fn();
    frames.port.requestFrame(first);
    frames.present(headset);
    expect(frames.presenting).toBe(true);
    expect(window.pending.size).toBe(0);
    window.tick(1);
    expect(first).not.toHaveBeenCalled();
    headset.tick(2);
    expect(first).toHaveBeenCalledOnce();
    expect(first).toHaveBeenCalledWith(2);

    const second = vi.fn();
    frames.port.requestFrame(second);
    expect(headset.pending.size).toBe(1);
    frames.present(null);
    headset.tick(3);
    expect(second).not.toHaveBeenCalled();
    window.tick(4);
    expect(second).toHaveBeenCalledWith(4);
  });

  it("cancels a frame on whichever source holds it", () => {
    const window = fakeSource();
    const headset = fakeSource();
    const frames = createImmersiveFrames(window);
    const callback = vi.fn();
    const id = frames.port.requestFrame(callback);
    frames.present(headset);
    frames.port.cancelFrame(id);
    expect(headset.cancelFrame).toHaveBeenCalled();
    headset.tick(1);
    window.tick(1);
    expect(callback).not.toHaveBeenCalled();
  });

  it("drops a callback a source delivers after the frame moved", () => {
    const window: FrameSource = { requestFrame: vi.fn(() => 1), cancelFrame: vi.fn() };
    const headset = fakeSource();
    const frames = createImmersiveFrames(window);
    const callback = vi.fn();
    frames.port.requestFrame(callback);
    const stale = vi.mocked(window.requestFrame).mock.calls[0]![0];
    frames.present(headset);
    stale(5);
    expect(callback).not.toHaveBeenCalled();
    headset.tick(6);
    expect(callback).toHaveBeenCalledOnce();
  });

  it("is hidden only when the page is hidden and nothing presents", () => {
    const frames = createImmersiveFrames(fakeSource());
    expect(frames.isHidden(() => true)).toBe(true);
    expect(frames.isHidden(() => false)).toBe(false);
    frames.present(fakeSource());
    expect(frames.isHidden(() => true)).toBe(false);
  });

  it("tells visibility listeners when a headset starts and stops presenting", () => {
    const frames = createImmersiveFrames(fakeSource());
    const pageOff = vi.fn();
    let pageListener: (() => void) | null = null;
    const listener = vi.fn();
    const off = frames.onVisibilityChange(l => { pageListener = l; return pageOff; }, listener);
    const headset = fakeSource();
    frames.present(headset);
    frames.present(headset);
    expect(listener).toHaveBeenCalledOnce();
    frames.present(null);
    expect(listener).toHaveBeenCalledTimes(2);
    pageListener!();
    expect(listener).toHaveBeenCalledTimes(3);
    off();
    expect(pageOff).toHaveBeenCalled();
    frames.present(headset);
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
