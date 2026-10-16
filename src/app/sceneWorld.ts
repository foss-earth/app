/** Earth owns authored placement/settings; public Engine/360 own the reusable bindings. */
import { captureRelativeMarker, groundQueryPoint, groundRelativeMarker, enuFrame, ecefToEnuMatrix,
  length, sub, createGlobeOverviewBinding, type NavigationLease } from "@foss-earth/engine";
import { worldViewportClientRect, type WheelGestureWatch } from "@foss-earth/engine/browser";
import type { BabylonRuntime } from "@foss-earth/engine/babylon";
import { imagePoseMatrix, transpose3, mulMat3Mat3 } from "@foss-earth/images";
import type { ResolvedSphere } from "@foss-earth/scenes";
import type { SceneWorldPorts, ScenePlacement } from "@foss-earth/scenes/browser";
import type { SettingsRegistry } from "@foss-earth/ui/settings";
import type { PublishedImageViewer } from "@foss-earth/sphere-image";
import { globeViewerMath, globeViewerPoses, createGlobeViewerNavigation } from "@foss-earth/sphere-image/globe";
import { createGlobeViewerInput } from "@foss-earth/sphere-image/globe-browser";
import type { ViewerNavigationLease } from "@foss-earth/sphere-image/viewer";
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
    surfaceRect: () => {
      const rect = worldViewportClientRect(canvas);
      return rect.width > 0 && rect.height > 0 ? rect : null;
    },
  });
}

/** A live placement edit. Null height keeps the photograph's authored capture height. */
export interface SpherePoseEdit {
  longitudeDeg: number;
  latitudeDeg: number;
  heightMeters: number | null;
  headingDeg: number;
  pitchDeg: number;
  offsetM: number;
}

interface EarthSceneFrames {
  subscribe(listener: () => void): () => void;
  wheels: WheelGestureWatch;
  minimumOverviewPreparationRadiusMeters(): number;
}
export function createEarthSceneWorld(
  runtime: BabylonRuntime, settings: SettingsRegistry, frames: EarthSceneFrames,
  canvas: HTMLCanvasElement, viewer: Pick<PublishedImageViewer, "status" | "isPlacementFrozen">,
): SceneWorldPorts & {
  dispose(): void; whenSettled(): Promise<void>;
  setPoseEdit(id: string, edit: SpherePoseEdit | null): ScenePlacement | null;
  posePlacement(id: string): ScenePlacement | null;
} {
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
  type Cached = { result: ScenePlacement; stamp: string };
  const cache = new WeakMap<ResolvedSphere, Cached>();
  const edits = new Map<string, SpherePoseEdit>();
  const watches = new Set<{ entity: ResolvedSphere; radiusMeters: number; changed(next: ScenePlacement): void }>();
  function sourceOf(entity: ResolvedSphere): { capture: ResolvedSphere["capture"]; pose: ResolvedSphere["imagePose"]; marker: ResolvedSphere["marker"]; stamp: string } {
    const edit = edits.get(entity.id);
    if (!edit) return { capture: entity.capture, pose: entity.imagePose, marker: entity.marker, stamp: "authored" };
    const height = edit.heightMeters === null ? entity.capture.height ?? null
      : { ...(entity.capture.height ?? { datum: "WGS84-ellipsoid" as const }), meters: edit.heightMeters };
    return {
      capture: { ...entity.capture, longitudeDeg: edit.longitudeDeg, latitudeDeg: edit.latitudeDeg, height },
      pose: { ...entity.imagePose, headingDeg: edit.headingDeg, pitchDeg: edit.pitchDeg },
      marker: { ...entity.marker, offsetM: edit.offsetM },
      stamp: `${edit.longitudeDeg}|${edit.latitudeDeg}|${edit.heightMeters}|${edit.headingDeg}|${edit.pitchDeg}|${edit.offsetM}`,
    };
  }
  function previewContentOf(source: { pose: ResolvedSphere["imagePose"] }) {
    return transpose3(imagePoseMatrix(source.pose));
  }
  function contentOf(source: { capture: ResolvedSphere["capture"]; pose: ResolvedSphere["imagePose"] }) {
    return mulMat3Mat3(previewContentOf(source), ecefToEnuMatrix(enuFrame(source.capture.longitudeDeg, source.capture.latitudeDeg)));
  }
  function update(entity: ResolvedSphere, radiusMeters: number): { item: Cached; changed: boolean } {
    const source = sourceOf(entity);
    let item = cache.get(entity);
    if (!item) {
      item = { stamp: "", result: { state: "pending", previewContent: previewContentOf(source), placement: {
        marker: null, radiusMeters, content: contentOf(source), ...entity.markerStyle,
      } } };
      cache.set(entity, item);
    }
    const old = item.result;
    const oriented = { ...old, previewContent: previewContentOf(source) };
    const stampChanged = item.stamp !== source.stamp;
    const placement = { ...old.placement, radiusMeters, content: contentOf(source), ...entity.markerStyle };
    if (source.marker.mode === "capture-relative") {
      if (old.state === "placed" && !stampChanged) return { item, changed: false };
      if (!source.capture.height) throw new Error("Capture-relative placement requires its known height.");
      item.stamp = source.stamp;
      item.result = { ...oriented, state: "placed", placement: { ...placement, marker: captureRelativeMarker(source.capture, source.capture.height.meters, source.marker.eastM, source.marker.northM, source.marker.offsetM) } };
      return { item, changed: true };
    }
    // Legacy ground-relative: placed once from the first surface answer and then kept, so map detail
    // arriving later never moves a photograph. Only an edit samples again, including while the view is
    // inside. Prepared scenes carry fixed capture-relative heights and never sample the map.
    if (!stampChanged && (old.state === "placed" || viewer.isPlacementFrozen(entity.id))) return { item, changed: false };
    const query = groundQueryPoint(source.capture, source.marker.eastM, source.marker.northM);
    const hit = runtime.surface.sample(query.latitudeDeg, query.longitudeDeg);
    if (!hit) {
      if (!stampChanged || old.state !== "placed") return { item, changed: false };
      // Leave the stamp stale so a later frame can sample the ground again, without asking for a frame once the orientation is current.
      const nextPlacement = { ...placement, marker: old.placement.marker };
      const changed = nextPlacement.content.some((row, index) => row.some((value, column) => value !== old.placement.content[index][column]));
      item.result = { ...oriented, placement: nextPlacement };
      return { item, changed };
    }
    const marker = groundRelativeMarker(query, hit.heightMeters, source.marker.offsetM);
    const moved = !old.placement.marker || length(sub(marker, old.placement.marker)) > 1e-3;
    item.stamp = source.stamp;
    item.result = { ...oriented, state: "placed", placement: { ...placement, marker } };
    return { item, changed: moved || stampChanged };
  }
  function publish(id: string): ScenePlacement | null {
    let result: ScenePlacement | null = null;
    let moved = false;
    for (const watch of [...watches]) {
      if (watch.entity.id !== id) continue;
      const next = update(watch.entity, watch.radiusMeters);
      result = next.item.result;
      if (next.changed) { watch.changed(next.item.result); moved = true; }
    }
    if (moved) runtime.requestRender();
    return result;
  }
  function posePlacement(id: string): ScenePlacement | null {
    for (const watch of watches) if (watch.entity.id === id) return cache.get(watch.entity)?.result ?? null;
    return null;
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
    setPoseEdit(id: string, edit: SpherePoseEdit | null): ScenePlacement | null {
      if (disposed) return null;
      if (edit) edits.set(id, edit); else edits.delete(id);
      return publish(id);
    },
    posePlacement,
    showOverview: (value, options) => overview.showOverview(value, options),
    whenSettled: () => overview.whenSettled(),
    dispose() {
      if (disposed) return;
      disposed = true;
      attemptEarthCleanup([
        () => overview.dispose(),
        offFrame, () => watches.clear(), () => edits.clear(),
        ...inputTypes.map(type => () => hostWindow.removeEventListener(type, onOverviewInput, { capture: true })),
      ], "Scene world cleanup failed.");
    },
  };
}
