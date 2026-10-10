/** Earth app supplies geography and its live camera/input authority to Scenes/360. */
import {
  captureRelativeMarker, groundQueryPoint, groundRelativeMarker, enuFrame, ecefToEnuMatrix,
  createOrbitViewSnapshot, length, sub, ecef, levelUp, orbitAngles, orbitLook, pointGeodetic,
  glideSettling, presentationFromView, viewFromPresentation,
  createWheelGestureClassifier, type NavigationLease, type NavigationSnapshot,
} from "@foss-earth/engine";
import { isSafariGestureSupported, watchWheelGestures, type WheelGestureWatch } from "@foss-earth/engine/browser";
import type { BabylonRuntime } from "@foss-earth/engine/babylon";
import { imagePoseMatrix, transpose3, mulMat3Mat3 } from "@foss-earth/images";
import type { ResolvedPanorama } from "@foss-earth/scenes";
import type { SceneWorldPorts, ScenePlacement } from "@foss-earth/scenes/browser";
import type { SettingsRegistry } from "@foss-earth/ui/settings";
import type { PublishedImageViewer, ViewerPosePorts, ViewerWorldMath } from "@foss-earth/360";
import { attachLookInput } from "@foss-earth/360/input";
import type { ViewerHeldPress, ViewerInputPorts, ViewerNavigationLease, ViewerNavigationPorts } from "@foss-earth/360/viewer";
import { controlTakesKey } from "@felipegalind0/gamepad-tools/browser";
import { attemptEarthCleanup } from "./nativeResources";

export const earthViewerMath: ViewerWorldMath = { levelUp, orbitAngles, orbitLook, pointGeodetic, glideSettling };
export const earthViewerPoses: ViewerPosePorts = {
  viewFromPresentation(input, pose) {
    const capture = input.details?.capture;
    if (!capture) throw new Error("A geographic viewer input requires capture coordinates.");
    return viewFromPresentation(enuFrame(capture.longitudeDeg, capture.latitudeDeg), pose);
  },
  presentationFromView(input, view) {
    const capture = input.details?.capture;
    if (!capture) throw new Error("A geographic viewer input requires capture coordinates.");
    return presentationFromView(enuFrame(capture.longitudeDeg, capture.latitudeDeg), input.placement.marker ?? [0, 0, 0], view);
  },
};

export function createEarthViewerNavigation(runtime: BabylonRuntime) {
  const leases = new WeakMap<ViewerNavigationLease, NavigationLease>();
  const engineLeaseFor = (lease: ViewerNavigationLease): NavigationLease => {
    const real = leases.get(lease);
    if (!real) throw new Error("The viewer navigation lease belongs to another host.");
    return real;
  };
  const navigation: ViewerNavigationPorts = {
    acquire() {
      const acquired = runtime.acquireNavigation({ owner: "foss-earth.scenes", inputContext: "panorama", terrain: "paused" });
      if (!acquired.ok) return { ok: false, message: acquired.message };
      const real = acquired.lease;
      if (!(real.signal instanceof AbortSignal)) {
        real.release("cancelled");
        throw new Error("Earth browser navigation requires its native abort signal.");
      }
      const lease: ViewerNavigationLease = {
        overview: real.overview, signal: real.signal,
        get released() { return real.released; },
        setPresentationView: pose => real.setPresentationView(pose),
        holdRendering: () => real.holdRendering(),
        release: reason => real.release(reason),
      };
      leases.set(lease, real);
      return { ok: true, lease };
    },
    place(lease, pose) { runtime.placeNavigationCamera(engineLeaseFor(lease), pose); },
    restore(snapshot, lease) { runtime.restoreNavigationSnapshot(snapshot, lease ? engineLeaseFor(lease) : undefined); },
    glide(lease, pose, marker, motion) {
      runtime.glideNavigationCamera(engineLeaseFor(lease), pose, ecef(marker), {
        ...motion, velocity: ecef(motion.velocity), turn: ecef(motion.turn),
      });
    },
    inertiaDecay: () => runtime.getCameraHandling().glideKeepPerFrame,
    returnFocus(lease) {
      const focus = engineLeaseFor(lease).focusReturn;
      if (focus instanceof HTMLElement && focus.isConnected) focus.focus();
    },
  };
  return { navigation, engineLeaseFor };
}

export function createEarthViewerInput(
  runtime: BabylonRuntime, canvas: HTMLCanvasElement,
  engineLeaseFor: (lease: ViewerNavigationLease) => NavigationLease, nowMs: () => number,
) {
  const hostWindow = canvas.ownerDocument.defaultView;
  if (!hostWindow) throw new Error("Scene input needs the canvas Window.");
  const wheels = watchWheelGestures(canvas, { window: hostWindow, nowMs });
  const input: ViewerInputPorts = {
    attach({ model, lease, requestFrame, userInput, exit }) {
      const look = attachLookInput({
        window: hostWindow, canvas, model, controlTakesKey,
        createWheelGestureClassifier: options => createWheelGestureClassifier({ ...options, nowMs }),
        onExit: exit, onUserInput: userInput, requestFrame,
        inputMode: () => { const mode = runtime.getInputMode(); return mode === "touch" ? "auto" : mode; },
        safariGestures: isSafariGestureSupported({ userAgent: hostWindow.navigator.userAgent, hasGestureEvent: "GestureEvent" in hostWindow }),
        precedingWheelMs: wheels.lastEventMs(),
      });
      let off: () => void;
      try { off = runtime.setNavigationIntentHandler(engineLeaseFor(lease), frame => look.applyIntents(frame)); }
      catch (error) {
        try { look.detach(); }
        catch (release) { throw new AggregateError([error, release], "Scene input attachment failed."); }
        throw error;
      }
      let detached = false;
      return { detach() {
        if (detached) return;
        detached = true;
        const errors: unknown[] = [];
        try { off(); } catch (error) { errors.push(error); }
        try { look.detach(); } catch (error) { errors.push(error); }
        if (errors.length) throw new AggregateError(errors, "Scene look input cleanup failed.");
      } };
    },
    cancelOnInput(controller) {
      let held: ViewerHeldPress | null = null;
      const cancel = () => controller.abort(new DOMException("Cancelled by input.", "AbortError"));
      const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); cancel(); } };
      const onPress = (event: PointerEvent) => {
        if (event.pointerType === "mouse") held = { pointerId: event.pointerId, button: event.button, clientX: event.clientX, clientY: event.clientY };
        cancel();
      };
      const onWheel = () => { if (wheels.begins()) cancel(); };
      hostWindow.addEventListener("keydown", onKey);
      canvas.addEventListener("pointerdown", onPress);
      canvas.addEventListener("wheel", onWheel, { passive: true });
      let stopped = false;
      return { press: () => held, stop() {
        if (stopped) return;
        stopped = true;
        attemptEarthCleanup([
          () => hostWindow.removeEventListener("keydown", onKey),
          () => canvas.removeEventListener("pointerdown", onPress),
          () => canvas.removeEventListener("wheel", onWheel),
        ], "Scene input cancellation cleanup failed.");
      } };
    },
  };
  return { input, wheels, dispose: () => wheels.dispose() };
}

interface EarthSceneFrames {
  subscribe(listener: () => void): () => void;
  wheels: WheelGestureWatch;
  minimumOverviewPreparationRadiusMeters(): number;
}
export function createEarthSceneWorld(
  runtime: BabylonRuntime, settings: SettingsRegistry, frames: EarthSceneFrames,
  canvas: HTMLCanvasElement, viewer: Pick<PublishedImageViewer, "status" | "isPlacementFrozen">,
): SceneWorldPorts & { dispose(): void } {
  const hostWindow = canvas.ownerDocument.defaultView;
  if (!hostWindow) throw new Error("Scene host needs the canvas Window.");
  let disposed = false, appliedOverviewFov = false;
  type Cached = { result: ScenePlacement; revision: number | null };
  const cache = new WeakMap<ResolvedPanorama, Cached>();
  const watches = new Set<{ entity: ResolvedPanorama; radiusMeters: number; changed(next: ScenePlacement): void }>();
  let pending: { controller: AbortController; baseline: NavigationSnapshot["view"] | null } | null = null;
  const cancelled = () => ({ ok: false as const, reason: "cancelled" as const, message: "Cancelled." });
  const abortPending = () => pending?.controller.abort(new DOMException("Cancelled by input or camera change.", "AbortError"));
  const cameraMoved = () => {
    const baseline = pending?.baseline, view = runtime.captureNavigationSnapshot()?.view;
    return Boolean(baseline && view && (view.latDeg !== baseline.latDeg || view.lonDeg !== baseline.lonDeg || view.headingDeg !== baseline.headingDeg || view.pitchDeg !== baseline.pitchDeg || view.zoomMeters !== baseline.zoomMeters));
  };
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
    if (pending && (cameraMoved() || viewer.status().phase !== "overview")) abortPending();
    let moved = false;
    for (const watch of [...watches]) {
      const next = update(watch.entity, watch.radiusMeters);
      if (next.changed) { watch.changed(next.item.result); moved = true; }
    }
    if (moved) runtime.requestRender();
  });
  const onOverviewInput = (event: Event) => {
    if (!pending) return;
    if (event.type === "keydown") {
      const key = event as KeyboardEvent;
      if (key.repeat || (canvas.ownerDocument.activeElement !== canvas && event.target !== canvas)) return;
    } else {
      const target = event.target as Node | null;
      if (target !== canvas && !(target && canvas.contains(target))) return;
      if (event.type === "wheel" && !frames.wheels.begins()) return;
    }
    abortPending();
  };
  const inputTypes = ["pointerdown", "wheel", "keydown", "gesturestart"];
  try {
    for (const type of inputTypes) hostWindow.addEventListener(type, onOverviewInput, { capture: true, passive: true });
  } catch (error) {
    disposed = true;
    try { attemptEarthCleanup([offFrame, ...inputTypes.map(type => () => hostWindow.removeEventListener(type, onOverviewInput, { capture: true }))], "Scene world setup cleanup failed."); }
    catch (release) { throw new AggregateError([error, release], "Scene world setup failed."); }
    throw error;
  }
  return {
    resolvePlacement(entity, { radiusMeters }) { return update(entity, radiusMeters).item.result; },
    watchPlacement(entity, { radiusMeters }, changed) { const watch = { entity, radiusMeters, changed }; watches.add(watch); return () => { watches.delete(watch); }; },
    async showOverview(overview, { signal: external }) {
      if (disposed) return { ok: false, reason: "disposed", message: "The scene is disposed." };
      if (viewer.status().phase !== "overview") return { ok: false, reason: "busy", message: "Exit the panorama first." };
      abortPending();
      const op = { controller: new AbortController(), baseline: null as NavigationSnapshot["view"] | null };
      pending = op;
      const signal = external ? AbortSignal.any([op.controller.signal, external]) : op.controller.signal;
      try {
        if (signal.aborted) return cancelled();
        let ground = overview.target.height?.meters ?? runtime.surface.sample(overview.target.latitudeDeg, overview.target.longitudeDeg)?.heightMeters ?? null;
        if (ground === null) {
          const preparing = runtime.prepareTerrain({ latDeg: overview.target.latitudeDeg, lonDeg: overview.target.longitudeDeg,
            radiusMeters: Math.max(overview.distanceMeters * 2, frames.minimumOverviewPreparationRadiusMeters()), altitudeAboveGroundMeters: 0, clearanceMeters: 0, signal });
          op.baseline = runtime.captureNavigationSnapshot()?.view ?? null;
          ground = (await preparing).groundHeightMeters;
        }
        if (disposed || pending !== op || signal.aborted) return cancelled();
        if (cameraMoved() || viewer.status().phase !== "overview") { op.controller.abort(); return cancelled(); }
        const snapshot = createOrbitViewSnapshot({ longitudeDeg: overview.target.longitudeDeg, latitudeDeg: overview.target.latitudeDeg,
          heightMeters: ground, distanceMeters: overview.distanceMeters, headingDeg: overview.headingDeg, pitchDeg: overview.pitchDeg, verticalFovDeg: overview.verticalFovDeg });
        if (!runtime.restoreNavigationSnapshot(snapshot)) return { ok: false, reason: "busy", message: "Another owner holds the camera." };
        appliedOverviewFov = true;
        return { ok: true, state: "applied" };
      } catch (error) { if (signal.aborted || disposed || pending !== op) return cancelled(); throw error; }
      finally { if (pending === op) pending = null; }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      attemptEarthCleanup([
        () => { try { abortPending(); } finally { pending = null; } },
        offFrame, () => watches.clear(),
        ...inputTypes.map(type => () => hostWindow.removeEventListener(type, onOverviewInput, { capture: true })),
        () => { if (!appliedOverviewFov) return;
        const snapshot = runtime.captureNavigationSnapshot(), fov = settings.get("camera.fieldOfView");
        if (snapshot && typeof fov === "number") runtime.restoreNavigationSnapshot({ ...snapshot, camera: { ...snapshot.camera, fov: fov * Math.PI / 180 } });
        }, () => runtime.requestRender(),
      ], "Scene world cleanup failed.");
    },
  };
}
