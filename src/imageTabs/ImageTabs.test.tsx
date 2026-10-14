// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImageSurfaceBody } from "./ImageTabs";
import type { ImageSideView, ImageSurfaceHost, ImageSurfaceView } from "./imageSurfaceHost";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const side = (placement: "left" | "right", title: string): ImageSideView => ({
  side: placement, tabId: `image:${title}`, documentId: `document:${title}`, title, width: 1000, height: 750, status: "ready", error: null,
});
const left = side("left", "A"), right = side("right", "B");
const VIEW: ImageSurfaceView = {
  presentation: "pair", incompatibleReason: null, sides: [left, right], focused: left, wipe: 0.5,
  sampling: "linear", pixelsPerTexel: 1, native: null, nativeProblem: null, resolution: null, unavailable: null,
  opening: { busy: false, error: null },
};

describe("image surface wipe handle", () => {
  let container: HTMLElement, root: Root;
  // The surface's own listeners, as the host attaches them: a press pans and takes focus.
  const surfacePress = vi.fn();
  const host = {
    getView: () => VIEW, subscribe: () => () => {}, setWipe: vi.fn(),
    attachSurface(element: HTMLElement) {
      element.addEventListener("pointerdown", surfacePress);
      return () => element.removeEventListener("pointerdown", surfacePress);
    },
  } as unknown as ImageSurfaceHost & { setWipe: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom has neither pointer capture nor layout.
    HTMLElement.prototype.setPointerCapture = vi.fn();
    container = document.createElement("div"); document.body.append(container);
    root = createRoot(container);
    act(() => root.render(<ImageSurfaceBody host={host} tabId={null} />));
    const surface = container.querySelector<HTMLElement>(".foss-earth-image-surface")!;
    surface.getBoundingClientRect = () => ({ left: 100, top: 0, width: 400, height: 300, right: 500, bottom: 300, x: 100, y: 0, toJSON() {} });
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });

  const pointer = (type: string, clientX: number) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX }) as MouseEvent & { pointerId: number };
    Object.defineProperty(event, "pointerId", { value: 7 });
    return event;
  };

  it("keeps a press on the handle from the surface, and drags the wipe", () => {
    const handle = container.querySelector<HTMLElement>(".foss-earth-image-wipe__handle")!;
    let pressed!: Event;
    act(() => { pressed = pointer("pointerdown", 300); handle.dispatchEvent(pressed); });
    expect(surfacePress).not.toHaveBeenCalled();
    expect(pressed.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(handle);
    expect(handle.setPointerCapture).toHaveBeenCalledWith(7);
    act(() => { handle.dispatchEvent(pointer("pointermove", 400)); });
    expect(host.setWipe).toHaveBeenLastCalledWith(0.75);
    act(() => { handle.dispatchEvent(pointer("pointerup", 200)); });
    expect(host.setWipe).toHaveBeenLastCalledWith(0.25);
    act(() => { handle.dispatchEvent(pointer("pointermove", 450)); });
    expect(host.setWipe).toHaveBeenCalledTimes(2);
  });
});
