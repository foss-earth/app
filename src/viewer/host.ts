/**
 * The existing rectangle image viewer, with no globe. The same surface host,
 * window overlay and rectangle renderer the Earth image tabs use.
 */
import { Color4, FreeCamera, Vector3, type Engine } from "@babylonjs/core";
import { createImageSessionBroker, MIB } from "@foss-earth/images";
import { createRectangleSurfaceRenderer } from "@foss-earth/sphere-image/babylon";
import { defaultReadinessPolicy } from "@foss-earth/renderer";
import { bootstrapGlobeRenderer, createBrowserRendererHost, createNativeImageResources } from "@foss-earth/renderer/babylon";
import { observeSurfaceGeometry } from "@foss-earth/ui/browser";
import { createImageSurfaceHost, type ImageSurfaceHost } from "../imageTabs/imageSurfaceHost";
import { createRectangleImageSourceLoader } from "../imageTabs/imageSources";
import { textureReadiness } from "../app/textureReadiness";

export async function createViewerHost(canvas: HTMLCanvasElement): Promise<{ host: ImageSurfaceHost; dispose(): void }> {
  const { renderer, scene } = await bootstrapGlobeRenderer(canvas, {
    host: createBrowserRendererHost({ window, document }), antialias: false,
  });
  const camera = new FreeCamera("viewer", new Vector3(0, 0, -1), scene);
  scene.activeCamera = camera;
  scene.clearColor = new Color4(0.04, 0.05, 0.08, 1);
  const engine = renderer.engine as Engine;
  const broker = createImageSessionBroker({
    pools: { sourceGpu: 512 * MIB, decoded: 256 * MIB, encoded: 64 * MIB, uploadOutstanding: 64 * MIB, overlap: 256 * MIB },
    requests: 4, decodes: 2,
  });
  let disposed = false;
  const native = createNativeImageResources({
    broker, scene,
    limits: () => ({ bytesPerFrame: 64 * MIB, outstandingBytes: 64 * MIB }),
    wakeWork() {},
    createCanvas(width, height) {
      const surface = document.createElement("canvas");
      surface.width = width; surface.height = height;
      return surface;
    },
    invalidatePublishedSource() { broker.invalidate(); },
    after(callback, delayMs) { const id = window.setTimeout(callback, delayMs); return () => window.clearTimeout(id); },
    observeDeviceLoss(listener) {
      const observer = engine.onContextLostObservable.add(listener);
      return () => { engine.onContextLostObservable.remove(observer); };
    },
    onRetirementError(error) { console.error(error); },
  });
  const requestRender = (): void => {};
  const rectangle = createRectangleSurfaceRenderer(scene, { requestRender, onError: text => console.error(text) });
  const limits = () => ({ responseBytes: 32 * MIB, timeoutMs: 60_000 });
  const maxTextureSide = () => engine.getCaps().maxTextureSize;
  const timers = {
    setTimeout: (callback: () => void, ms: number) => window.setTimeout(callback, ms),
    clearTimeout: (handle: unknown) => window.clearTimeout(handle as number),
  };
  const host = createImageSurfaceHost({
    window, canvas,
    renderer: { unavailableReason: rectangle.unavailableReason, addSurface: read => rectangle.addSurface(read) },
    load: createRectangleImageSourceLoader({
      window, broker, uploader: native.uploader, limits, maxTextureSide,
      whenReady: textureReadiness(timers, defaultReadinessPolicy),
    }),
    observeGeometry: element => observeSurfaceGeometry(element, canvas),
    onBeforeRender(callback) {
      const observer = scene.onBeforeRenderObservable.add(callback);
      return () => { scene.onBeforeRenderObservable.remove(observer); };
    },
    requestRender, nowMs: () => performance.now(), inputMode: () => "auto", safariGestures: false,
    onDeviceLost: listener => {
      const observer = engine.onContextLostObservable.add(listener);
      return () => { engine.onContextLostObservable.remove(observer); };
    },
    onDeviceRestored: listener => {
      const observer = engine.onContextRestoredObservable.add(listener);
      return () => { engine.onContextRestoredObservable.remove(observer); };
    },
    keptGpuBytes: 256 * MIB,
    discovery: { broker, limits, fetch: window.fetch.bind(window), maxTextureSide, baseUrl: window.location.href },
  });
  engine.runRenderLoop(() => {
    if (disposed) return;
    native.resourceWork.prepare();
    scene.render();
  });
  const onResize = (): void => engine.resize();
  window.addEventListener("resize", onResize);
  engine.resize();
  return {
    host,
    dispose() {
      if (disposed) return;
      disposed = true;
      window.removeEventListener("resize", onResize);
      engine.stopRenderLoop();
      host.dispose();
      rectangle.dispose();
      native.retire();
      scene.dispose();
      engine.dispose();
      broker.dispose();
    },
  };
}
