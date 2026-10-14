// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { worldViewportRect } from "@foss-earth/engine/browser";
import { attachShellWorldViewport, shellWorldViewport } from "./worldViewport";

function shellCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  Object.defineProperty(canvas, "clientWidth", { value: 400 });
  Object.defineProperty(canvas, "clientHeight", { value: 800 });
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, right: 400, bottom: 800, width: 400, height: 800, x: 0, y: 0, toJSON() {} }) as DOMRect;
  document.body.append(canvas);
  return canvas;
}

const root = document.documentElement;

afterEach(() => {
  document.body.replaceChildren();
  delete root.dataset.worldPresentation;
  root.style.removeProperty("--foss-world-top");
  root.style.removeProperty("--foss-canvas-top");
});

describe("shellWorldViewport", () => {
  it("gives the world the whole canvas outside the split presentation", () => {
    root.style.setProperty("--foss-world-top", "300px");
    expect(shellWorldViewport(shellCanvas(), root)).toBeNull();
  });

  it("puts the world under the split band", () => {
    root.dataset.worldPresentation = "split";
    root.style.setProperty("--foss-world-top", "300px");
    expect(shellWorldViewport(shellCanvas(), root)).toEqual({ x: 0, y: 300, width: 400, height: 500 });
  });

  it("keeps the released size while World size waits out a resize", () => {
    root.dataset.worldPresentation = "split";
    root.style.setProperty("--foss-world-top", "360px");
    root.style.setProperty("--foss-canvas-top", "300px");
    expect(shellWorldViewport(shellCanvas(), root)?.y).toBe(300);
  });
});

describe("attachShellWorldViewport", () => {
  it("gives the engine the shell's world, draws again when the band moves, and lets go when detached", async () => {
    const canvas = shellCanvas();
    const requestRender = vi.fn();
    const detach = attachShellWorldViewport(canvas, root, requestRender);
    root.dataset.worldPresentation = "split";
    root.style.setProperty("--foss-world-top", "200px");
    expect(worldViewportRect(canvas)).toEqual({ x: 0, y: 200, width: 400, height: 600 });
    await Promise.resolve();
    expect(requestRender).toHaveBeenCalled();
    detach();
    expect(worldViewportRect(canvas)).toEqual({ x: 0, y: 0, width: 400, height: 800 });
  });
});
