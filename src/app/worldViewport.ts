import { setWorldViewportSource, type WorldViewportRect } from "@foss-earth/engine/browser";

/**
 * The canvas fills the shell. In the split presentation the world is the part
 * under the windows' band: from `--foss-canvas-top`, which waits out a resize
 * when World size is Release, or else `--foss-world-top`, which the overlay
 * publishes. Everywhere else the world is the whole canvas.
 */
export function shellWorldViewport(canvas: HTMLCanvasElement, root: HTMLElement): WorldViewportRect | null {
  if (root.dataset.worldPresentation !== "split") return null;
  const raw = root.style.getPropertyValue("--foss-canvas-top") || root.style.getPropertyValue("--foss-world-top");
  const top = Number.parseFloat(raw);
  if (!Number.isFinite(top)) return null;
  const offset = top - canvas.getBoundingClientRect().top;
  if (offset <= 0) return null;
  return { x: 0, y: offset, width: canvas.clientWidth, height: Math.max(0, canvas.clientHeight - offset) };
}

/** Gives the engine the shell's world viewport, and draws again whenever the overlay moves it. */
export function attachShellWorldViewport(canvas: HTMLCanvasElement, root: HTMLElement, requestRender: () => void): () => void {
  const stop = setWorldViewportSource(canvas, () => shellWorldViewport(canvas, root));
  const View = root.ownerDocument.defaultView;
  const observer = View ? new View.MutationObserver(() => requestRender()) : null;
  observer?.observe(root, { attributes: true, attributeFilter: ["style", "data-world-presentation"] });
  return () => {
    observer?.disconnect();
    stop();
  };
}
