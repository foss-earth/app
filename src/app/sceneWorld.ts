/** Earth owns authored placement/settings; public Engine/360 own the reusable bindings. */
import { captureRelativeMarker, groundQueryPoint, groundRelativeMarker, enuFrame, ecefToEnuMatrix,
  length, sub, createGlobeOverviewBinding, type NavigationLease } from "@foss-earth/engine";
import type { WheelGestureWatch } from "@foss-earth/engine/browser";
import type { BabylonRuntime } from "@foss-earth/engine/babylon";
import { imagePoseMatrix, transpose3, mulMat3Mat3 } from "@foss-earth/images";
import type { ResolvedPanorama } from "@foss-earth/scenes";
import type { SceneWorldPorts, ScenePlacement } from "@foss-earth/scenes/browser";
import type { SettingsRegistry } from "@foss-earth/ui/settings";
import type { PublishedImageViewer } from "@foss-earth/360";
import { globeViewerMath, globeViewerPoses, createGlobeViewerNavigation } from "@foss-earth/360/globe";
import { createGlobeViewerInput } from "@foss-earth/360/globe-browser";
import type { ViewerNavigationLease } from "@foss-earth/360/viewer";
import { controlTakesKey } from "@felipegalind0/gamepad-tools/browser";
import { attemptEarthCleanup } from "./nativeResources";

export const earthViewerMath = globeViewerMath;
export const earthViewerPoses = globeViewerPoses;
export function createEarthViewerNavigation(runtime: BabylonRuntime) {
  return createGlobeViewerNavigation(runtime, {
    isAbortSignal: (signal): signal is AbortSignal => signal instanceof AbortSignal,
    returnFocus(focus) { if (focus instanceof HTMLElement && focus.isConnected) focus.focus(); },
  });
}
export function createEarthViewerInput(runtime: BabylonRuntime, canvas: HTMLCanvasElement,
  engineLeaseFor: (lease: ViewerNavigationLease) => NavigationLease, nowMs: () => number,
) {
  return createGlobeViewerInput(runtime, canvas, engineLeaseFor, {
    nowMs, controlTakesKey, abortReason: () => new DOMException("Cancelled by input.", "AbortError"),
  });
}

interface EarthSceneFrames {
  subscribe(listener: () => void): () => void;
  wheels: WheelGestureWatch;
  minimumOverviewPreparationRadiusMeters(): number;
}
export function createEarthSceneWorld(
  runtime: BabylonRuntime, settings: SettingsRegistry, frames: EarthSceneFrames,
  canvas: HTMLCanvasElement, viewer: Pick<PublishedImageViewer, "status" | "isPlacementFrozen">,
): SceneWorldPorts & { dispose(): void; whenSettled(): Promise<void> } {
  const hostWindow = canvas.ownerDocument.defaultView;
  if (!hostWindow) throw new Error("Scene host needs the canvas Window.");
  let disposed = false;
  const overview = createGlobeOverviewBinding({ runtime,
    isOverview: () => viewer.status().phase === "overview",
    minimumPreparationRadiusMeters: () => frames.minimumOverviewPreparationRadiusMeters(),
    configuredFovDegrees: () => { const value = settings.get("camera.fieldOfView"); return typeof value === "number" ? value : null; },
    createAbortController: () => new AbortController(), combineSignals: signals => AbortSignal.any([...signals]),
    abortReason: () => new DOMException("Cancelled by input or camera change.", "AbortError"),
  });
  type Cached = { result: ScenePlacement; revision: number | null };
  const cache = new WeakMap<ResolvedPanorama, Cached>();
  const watches = new Set<{ entity: ResolvedPanorama; radiusMeters: number; changed(next: ScenePlacement): void }>();
  function update(entity: ResolvedPanorama, radiusMeters: number): { item: Cached; changed: boolean } {
    let item = cache.get(entity);
    if (!item) {
      item = { revision: null, result: { state: "pending", placement: {
        marker: null, radiusMeters,
        content: mulMat3Mat3(transpose3(imagePoseMatrix(entity.imagePose)), ecefToEnuMatrix(enuFrame(entity.capture.longitudeDeg, entity.capture.latitudeDeg))),
        ...entity.markerStyle,
      } } };
      cache.set(entity, item);
    }
    const old = item.result;
    if (entity.marker.mode === "capture-relative") {
      if (old.state === "placed") return { item, changed: false };
      if (!entity.capture.height) throw new Error("Capture-relative placement requires its known height.");
      item.result = { ...old, state: "placed", placement: { ...old.placement, marker: captureRelativeMarker(entity.capture, entity.capture.height.meters, entity.marker.eastM, entity.marker.northM, entity.marker.offsetM) } };
      return { item, changed: true };
    }
    if (viewer.isPlacementFrozen(entity.id)) return { item, changed: false };
    const revision = runtime.surface.revision?.() ?? null;
    if (old.state === "placed" && revision !== null && item.revision === revision) return { item, changed: false };
    const query = groundQueryPoint(entity.capture, entity.marker.eastM, entity.marker.northM);
    const hit = runtime.surface.sample(query.latitudeDeg, query.longitudeDeg);
    if (!hit) return { item, changed: false };
    const marker = groundRelativeMarker(query, hit.heightMeters, entity.marker.offsetM);
    const moved = !old.placement.marker || length(sub(marker, old.placement.marker)) > 1e-3;
    item.revision = revision ?? hit.revision;
    item.result = { ...old, state: "placed", placement: { ...old.placement, marker } };
    return { item, changed: moved };
  }
  const offFrame = frames.subscribe(() => {
    if (disposed) return;
    overview.observeFrame();
    let moved = false;
    for (const watch of [...watches]) {
      const next = update(watch.entity, watch.radiusMeters);
      if (next.changed) { watch.changed(next.item.result); moved = true; }
    }
    if (moved) runtime.requestRender();
  });
  const onOverviewInput = (event: Event) => {
    if (!overview.isPending()) return;
    if (event.type === "keydown") {
      const key = event as KeyboardEvent;
      if (key.repeat || (canvas.ownerDocument.activeElement !== canvas && event.target !== canvas)) return;
    } else {
      const target = event.target as Node | null;
      if (target !== canvas && !(target && canvas.contains(target))) return;
      if (event.type === "wheel" && !frames.wheels.begins()) return;
    }
    overview.cancel();
  };
  const inputTypes = ["pointerdown", "wheel", "keydown", "gesturestart"];
  try {
    for (const type of inputTypes) hostWindow.addEventListener(type, onOverviewInput, { capture: true, passive: true });
  } catch (error) {
    disposed = true;
    try { attemptEarthCleanup([() => overview.dispose(), offFrame, ...inputTypes.map(type => () => hostWindow.removeEventListener(type, onOverviewInput, { capture: true }))], "Scene world setup cleanup failed."); }
    catch (release) { throw new AggregateError([error, release], "Scene world setup failed."); }
    throw error;
  }
  return {
    resolvePlacement(entity, { radiusMeters }) { return update(entity, radiusMeters).item.result; },
    watchPlacement(entity, { radiusMeters }, changed) { const watch = { entity, radiusMeters, changed }; watches.add(watch); return () => { watches.delete(watch); }; },
    showOverview: (value, options) => overview.showOverview(value, options),
    whenSettled: () => overview.whenSettled(),
    dispose() {
      if (disposed) return;
      disposed = true;
      attemptEarthCleanup([
        () => overview.dispose(),
        offFrame, () => watches.clear(),
        ...inputTypes.map(type => () => hostWindow.removeEventListener(type, onOverviewInput, { capture: true })),
      ], "Scene world cleanup failed.");
    },
  };
}
