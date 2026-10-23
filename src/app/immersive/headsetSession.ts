/**
 * An immersive WebXR session: the globe or the open photograph drawn for both
 * eyes of a headset. The headset space stands where the presented view, or
 * the globe camera, stands, upright on the Earth, and follows it there; the
 * head turns it and the thumbstick turns it in steps. The controllers point
 * at the page's interface on panels around the head (headsetUi.ts) and, past
 * it, at what the tour shows.
 *
 * Each session made is announced as a `foss-earth:headset-session` event on
 * the window, for a test to drive it (src/dev/headsetEmulator.ts).
 */
import { Matrix, Quaternion, TransformNode, Vector3, WebXRCamera, WebXRSessionManager, type Camera, type Observer, type Scene } from "@babylonjs/core";
import { enuFrame, pointGeodetic, type Vec3 } from "@foss-earth/engine";
import type { FrameCallback, FrameSource, ImmersiveFrames } from "./frames";
import { createHeadsetPointers, HEADSET_OVERLAY_GROUP } from "./headsetPointers";
import type { HeadsetRay, HeadsetTour } from "./headsetTour";
import { createHeadsetUi, forwardOf, type HandRay, type HeadsetUi, type HeadsetUiOptions } from "./headsetUi";
import { createSnapTurn, flatDepthProjection, headingAt, headsetDepthRange, headsetSpaceRotation, reverseProjectionDepth, seatRotation } from "./xrMath";

export type HeadsetState = "checking" | "unavailable" | "ready" | "starting" | "presenting";

export interface HeadsetPlace {
  position: Vec3;
  forward: Vec3;
  /**
   * A vehicle's up, for a seat in it: the headset space turns with the
   * vehicle, its −z along `forward`, and the thumbstick does not turn it.
   * Without one, the space stands upright on the Earth, facing `forward`'s
   * heading when the session starts.
   */
  up?: Vec3;
}

export interface HeadsetSessionOptions {
  scene: Scene;
  frames: ImmersiveFrames;
  navigator: Navigator;
  /** Keeps the scheduler drawing every frame until the returned release. */
  holdRendering(): () => void;
  requestRender(): void;
  /** Where the eye stands and looks: the presented view, else the globe camera. */
  place(): HeadsetPlace | null;
  /** The camera the globe draws with: its clip planes and layers are the headset's. */
  globeCamera(): Camera | null;
  createTour?(): HeadsetTour;
  /** The page's interface on panels around the head; none without. */
  ui?: Omit<HeadsetUiOptions, "scene" | "space" | "layerMask" | "requestRender">;
  /** Layers the session's own meshes draw on: the rays and panels, seen by every camera. */
  layerMask?: number;
  report(message: string, error?: unknown): void;
}

/** What a test reads of a presenting session. */
export interface HeadsetInspection {
  scene: Scene;
  /** The headset space: the reference space's origin and axes in the scene. */
  space: TransformNode;
  camera: WebXRCamera;
  ui: HeadsetUi | null;
  /** Frames presented so far. */
  frames: number;
  /** The controllers' rays last frame, in the headset space. */
  rays: readonly HandRay[];
}

export const HEADSET_SESSION_EVENT = "foss-earth:headset-session";

export interface HeadsetSession {
  readonly state: HeadsetState;
  /** Why a headset cannot be used, or why the last one failed to start. */
  readonly reason: string | null;
  readonly presenting: boolean;
  subscribe(listener: () => void): () => void;
  enter(): Promise<void>;
  exit(): Promise<void>;
  /**
   * While presenting, the eye images' height in device pixels and the CSS
   * pixels sizes are measured in: sizes meant for a page keep their angle.
   */
  viewport(): { cssHeight: number; deviceHeight: number } | null;
  /** While presenting, its parts, for a test. */
  inspect(): HeadsetInspection | null;
  dispose(): void;
}

/** Device pixels for each CSS pixel in a headset: page sizes, such as orb markers, at a readable angle. */
export const HEADSET_DEVICE_PIXELS_PER_CSS = 2;

type XrSystem = {
  isSessionSupported(mode: string): Promise<boolean>;
  addEventListener(type: "devicechange", listener: () => void): void;
  removeEventListener(type: "devicechange", listener: () => void): void;
};

export function createHeadsetSession(options: HeadsetSessionOptions): HeadsetSession {
  const { scene, frames } = options;
  const engine = scene.getEngine();
  const xr = (options.navigator as Navigator & { xr?: XrSystem }).xr ?? null;
  const listeners = new Set<() => void>();
  let state: HeadsetState = "checking";
  let reason: string | null = null;
  let disposed = false;
  let deviceHeight: number | null = null;
  let active: { end(): Promise<void>; inspect(): HeadsetInspection } | null = null;
  const setState = (next: HeadsetState, why: string | null = null): void => {
    state = next;
    reason = why;
    for (const listener of [...listeners]) listener();
  };

  const check = (): void => {
    if (disposed || state === "starting" || state === "presenting") return;
    if (!xr) { setState("unavailable", "This browser has no WebXR. Open the page in a headset's browser."); return; }
    if (engine.isWebGPU) { setState("unavailable", "VR draws with WebGL, and this page started with WebGPU. Choose WebGL 2 in the Renderer tab, then reload."); return; }
    xr.isSessionSupported("immersive-vr").then(
      supported => { if (!disposed && state !== "starting" && state !== "presenting") setState(supported ? "ready" : "unavailable", supported ? null : "No VR headset is available to this browser."); },
      () => { if (!disposed && state !== "starting" && state !== "presenting") setState("unavailable", "This browser does not allow VR on this page."); },
    );
  };
  xr?.addEventListener("devicechange", check);
  check();

  async function enter(): Promise<void> {
    if (disposed || state !== "ready") return;
    setState("starting");
    const manager = new WebXRSessionManager(scene);
    const anchor = new TransformNode("headset-space", scene);
    anchor.rotationQuaternion = new Quaternion();
    const before = scene.activeCamera;
    const camera = new WebXRCamera("headset-camera", scene, manager);
    // The camera claims a scene without one; the session makes it active.
    scene.activeCamera = before;
    camera.compensateOnFirstFrame = false;
    camera.parent = anchor;
    const discard = (): void => { camera.dispose(); anchor.dispose(); manager.dispose(); };
    try {
      await manager.initializeAsync();
      await manager.initializeSessionAsync("immersive-vr", {});
      await manager.setReferenceSpaceTypeAsync("local");
      const range = headsetDepthRange(options.globeCamera()?.minZ ?? 1, options.globeCamera()?.maxZ ?? 0);
      camera.minZ = range.near;
      camera.maxZ = range.far;
      const baseLayer = await manager.getWebXRRenderTarget().initializeXRLayerAsync(manager.session);
      manager.updateRenderState({ baseLayer, depthNear: range.near, depthFar: range.far });
    } catch (error) {
      try { await manager.exitXRAsync(); } catch { /* Already ended. */ }
      discard();
      if (!disposed) setState("ready", `VR could not start: ${error instanceof Error ? error.message : String(error)}`);
      options.report("[vr] The headset session could not start.", error);
      return;
    }
    if (disposed) { await manager.exitXRAsync(); discard(); return; }
    present(manager, camera, anchor);
  }

  function present(manager: WebXRSessionManager, camera: WebXRCamera, anchor: TransformNode): void {
    const session = manager.session;
    // The scheduler's frames, delivered inside the session's: a window frame never arrives while it presents.
    const waiting = new Map<number, FrameCallback>();
    let nextFrame = 1;
    const source: FrameSource = {
      requestFrame(callback) { const id = nextFrame++; waiting.set(id, callback); return id; },
      cancelFrame(id) { waiting.delete(id); },
    };
    const loop = (): void => {
      if (!manager.inXRFrameLoop) return;
      const due = [...waiting.values()];
      waiting.clear();
      for (const callback of due) {
        try { callback(manager.currentTimestamp); } catch (error) { options.report("[vr] A headset frame failed.", error); }
      }
    };
    const previousCamera = scene.activeCamera;
    let heading = 0;
    let placed = false;
    /** In a vehicle's seat: the space turns with it, not with the thumbstick. */
    let seated = false;
    const turns = new Map<XRInputSource, (axis: number) => number>();
    const rotation = new Matrix();
    const pose = new Matrix();
    const world = new Matrix();
    const local = new Vector3();
    let tour: HeadsetTour | null = null;
    let ui: HeadsetUi | null = null;
    const layerMask = options.layerMask ?? 0x0fffffff;
    const pointers = createHeadsetPointers(scene, anchor, layerMask);
    let frameCount = 0;
    let lastRays: readonly HandRay[] = [];
    let lastTime: number | null = null;
    let dtS = 0;
    const hands = new Map<XRInputSource, string>();
    /** A controller's name: its hand, or its place among the inputs without one. */
    const handOf = (input: XRInputSource): string => {
      let hand = hands.get(input);
      if (!hand) {
        hand = input.handedness === "left" || input.handedness === "right" ? input.handedness : `input-${hands.size}`;
        hands.set(input, hand);
      }
      return hand;
    };
    /** Presses the interface took, and the frame each ended in: their select and squeeze are not the tour's. */
    const uiSelects = new Map<XRInputSource, number>();
    const uiSqueezes = new Map<XRInputSource, number>();
    const tookThisFrame = (taken: Map<XRInputSource, number>, input: XRInputSource): boolean => {
      const value = taken.get(input);
      return value !== undefined && (value === -1 || value === frameCount);
    };

    const placeSpace = (): Vec3 | null => {
      const place = options.place();
      if (!place) return null;
      const seat = place.up ? seatRotation(place.forward, place.up) : null;
      seated = seat !== null;
      if (seat) {
        anchor.position.set(place.position[0], place.position[1], place.position[2]);
        Matrix.FromArrayToRef(seat, 0, rotation);
        Quaternion.FromRotationMatrixToRef(rotation, anchor.rotationQuaternion!);
        anchor.computeWorldMatrix(true);
        return [seat[4]!, seat[5]!, seat[6]!];
      }
      const where = pointGeodetic(place.position);
      const frame = enuFrame(where.longitudeDeg, where.latitudeDeg);
      if (!placed) { heading = headingAt(frame, place.forward); placed = true; }
      anchor.position.set(place.position[0], place.position[1], place.position[2]);
      Matrix.FromArrayToRef(headsetSpaceRotation(frame, heading), 0, rotation);
      Quaternion.FromRotationMatrixToRef(rotation, anchor.rotationQuaternion!);
      anchor.computeWorldMatrix(true);
      return frame.up;
    };
    const toWorld = (point: Vector3, direction: boolean): Vec3 => {
      const result = direction ? Vector3.TransformNormal(point, anchor.getWorldMatrix()) : Vector3.TransformCoordinates(point, anchor.getWorldMatrix());
      return [result.x, result.y, result.z];
    };
    /** A controller's ray in the headset space: the reference space's own. */
    const localRayOf = (xrPose: XRPose | undefined | null): { origin: Vec3; direction: Vec3 } | null => {
      if (!xrPose) return null;
      const m = xrPose.transform.matrix;
      const size = Math.hypot(m[8]!, m[9]!, m[10]!) || 1;
      return { origin: [m[12]!, m[13]!, m[14]!], direction: [-m[8]! / size, -m[9]! / size, -m[10]! / size] };
    };
    const rayOf = (xrPose: XRPose | undefined | null): HeadsetRay | null => {
      if (!xrPose) return null;
      Matrix.FromArrayToRef(xrPose.transform.matrix, 0, pose);
      pose.multiplyToRef(anchor.getWorldMatrix(), world);
      const origin = Vector3.TransformCoordinates(Vector3.ZeroReadOnly, world);
      const direction = Vector3.TransformNormal(local.set(0, 0, -1), world).normalize();
      return { origin: [origin.x, origin.y, origin.z], direction: [direction.x, direction.y, direction.z] };
    };

    const onFrame: Observer<XRFrame> = manager.onXRFrameObservable.add(() => {
      frameCount++;
      const time = manager.currentTimestamp;
      dtS = lastTime === null ? 0 : Math.min(0.1, Math.max(0, (time - lastTime) / 1000));
      lastTime = time;
      // The camera has taken this frame's views: their projections become reversed depth, as every other camera draws.
      for (const view of [camera, ...camera.rigCameras]) {
        const values = view._projectionMatrix.toArray() as number[];
        if (reverseProjectionDepth(values)) Matrix.FromArrayToRef(values, 0, view._projectionMatrix);
      }
      deviceHeight = engine.getRenderHeight(true);
      for (const input of session.inputSources) {
        const axes = input.gamepad?.axes;
        if (!axes || input.targetRayMode !== "tracked-pointer") continue;
        let turn = turns.get(input);
        if (!turn) { turn = createSnapTurn(); turns.set(input, turn); }
        // xr-standard: the thumbstick is axes 2 and 3; a touchpad alone is 0 and 1.
        const x = axes.length > 2 ? axes[2]! : axes[0] ?? 0, y = axes.length > 2 ? axes[3] ?? 0 : axes[1] ?? 0;
        // On a panel the stick scrolls it, and does not turn.
        const onUi = ui?.stick(handOf(input), x, y, dtS) ?? false;
        heading = (heading + turn(onUi || seated ? 0 : x) + 360) % 360;
      }
      scene.activeCamera = camera;
    });
    // The panels and rays are at arm's length, nearer than the globe's near
    // plane: the overlay group draws them without a depth test, so with a
    // projection that clips nothing ahead.
    const overlayProjection = new Matrix();
    let drawnWith: { view: Matrix; projection: Matrix } | null = null;
    const eyes = (): readonly Camera[] => [camera, ...camera.rigCameras];
    const beforeGroup = scene.onBeforeRenderingGroupObservable.add(info => {
      if (info.renderingGroupId !== HEADSET_OVERLAY_GROUP || !scene.activeCamera || !eyes().includes(scene.activeCamera)) return;
      drawnWith = { view: scene.getViewMatrix(), projection: scene.getProjectionMatrix() };
      Matrix.FromArrayToRef(flatDepthProjection(drawnWith.projection.toArray() as number[]), 0, overlayProjection);
      scene.setTransformMatrix(drawnWith.view, overlayProjection);
    });
    const afterGroup = scene.onAfterRenderingGroupObservable.add(info => {
      if (info.renderingGroupId !== HEADSET_OVERLAY_GROUP || !drawnWith) return;
      scene.setTransformMatrix(drawnWith.view, drawnWith.projection);
      drawnWith = null;
    });
    const onRender = scene.onBeforeRenderObservable.add(() => {
      const up = placeSpace();
      const globe = options.globeCamera();
      if (globe) {
        const range = headsetDepthRange(globe.minZ, globe.maxZ);
        camera.minZ = range.near;
        camera.maxZ = range.far;
        camera.layerMask = globe.layerMask;
        for (const rig of camera.rigCameras) rig.layerMask = globe.layerMask;
      }
      // Frame preparation may have handed the scene back to the globe camera.
      scene.activeCamera = camera;
      const frame = manager.currentFrame;
      if (!frame) return;
      const local: HandRay[] = [];
      const world: HeadsetRay[] = [];
      for (const input of session.inputSources) {
        if (input.targetRayMode === "gaze") continue;
        const pose = frame.getPose(input.targetRaySpace, manager.referenceSpace);
        const ray = localRayOf(pose);
        const worldRay = rayOf(pose);
        if (!ray || !worldRay) continue;
        local.push({ hand: handOf(input), ...ray });
        world.push(worldRay);
      }
      lastRays = local;
      let onUi = new Map<string, number>();
      try {
        onUi = ui?.frame({ position: [camera.position.x, camera.position.y, camera.position.z], forward: forwardOf(camera.rotationQuaternion) }, local, dtS) ?? onUi;
      } catch (error) { options.report("[vr] The headset's interface failed.", error); }
      pointers.frame(local.map(ray => ({ origin: ray.origin, direction: ray.direction, length: onUi.get(ray.hand) })));
      // What the interface is in front of, the tour does not see.
      if (up && tour) tour.frame(toWorld(camera.position, false), up, world.filter((_, index) => !onUi.has(local[index]!.hand)));
    });
    // A press on the interface is the interface's from start to end; the
    // select or squeeze it ends with, in the same frame, is not the tour's.
    const onSelectStart = (event: XRInputSourceEvent): void => {
      if (ui?.press(handOf(event.inputSource))) uiSelects.set(event.inputSource, -1);
      options.requestRender();
    };
    const onSelectEnd = (event: XRInputSourceEvent): void => {
      if (!uiSelects.has(event.inputSource)) return;
      ui?.release(handOf(event.inputSource));
      uiSelects.set(event.inputSource, frameCount);
      options.requestRender();
    };
    const onSelect = (event: XRInputSourceEvent): void => {
      if (tookThisFrame(uiSelects, event.inputSource)) return;
      const ray = rayOf(event.frame.getPose(event.inputSource.targetRaySpace, manager.referenceSpace));
      if (ray) tour?.select(ray);
      options.requestRender();
    };
    const onSqueezeStart = (event: XRInputSourceEvent): void => {
      if (ui?.grab(handOf(event.inputSource))) uiSqueezes.set(event.inputSource, -1);
    };
    const onSqueezeEnd = (event: XRInputSourceEvent): void => {
      if (!uiSqueezes.has(event.inputSource)) return;
      ui?.drop(handOf(event.inputSource));
      uiSqueezes.set(event.inputSource, frameCount);
    };
    const onSqueeze = (event: XRInputSourceEvent): void => {
      if (tookThisFrame(uiSqueezes, event.inputSource)) return;
      tour?.back();
      options.requestRender();
    };
    const events = [
      ["selectstart", onSelectStart], ["selectend", onSelectEnd], ["select", onSelect],
      ["squeezestart", onSqueezeStart], ["squeezeend", onSqueezeEnd], ["squeeze", onSqueeze],
    ] as const;
    for (const [type, listener] of events) session.addEventListener(type, listener);

    engine.runRenderLoop(loop);
    manager.runXRRenderLoop();
    frames.present(source);
    const release = options.holdRendering();
    scene.activeCamera = camera;
    try { tour = options.createTour?.() ?? null; } catch (error) { options.report("[vr] The headset's markers could not be made.", error); }
    try {
      ui = options.ui ? createHeadsetUi({ ...options.ui, scene, space: anchor, layerMask, requestRender: options.requestRender }) : null;
    } catch (error) { options.report("[vr] The headset's interface could not be made.", error); }

    let finished = false;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      active = null;
      engine.stopRenderLoop(loop);
      manager.onXRFrameObservable.remove(onFrame);
      scene.onBeforeRenderObservable.remove(onRender);
      scene.onBeforeRenderingGroupObservable.remove(beforeGroup);
      scene.onAfterRenderingGroupObservable.remove(afterGroup);
      for (const [type, listener] of events) session.removeEventListener(type, listener);
      // The session's render targets are gone: nothing may draw into them again.
      camera.outputRenderTarget = null;
      for (const rig of camera.rigCameras) rig.outputRenderTarget = null;
      if (scene.activeCamera === camera) scene.activeCamera = options.globeCamera() ?? previousCamera;
      frames.present(null);
      release();
      tour?.dispose();
      tour = null;
      ui?.dispose();
      ui = null;
      pointers.dispose();
      deviceHeight = null;
      // The manager is still notifying the end; its owners go after.
      void Promise.resolve().then(() => { camera.dispose(); anchor.dispose(); manager.dispose(); });
      if (!disposed) { setState("ready"); check(); }
      options.requestRender();
    };
    manager.onXRSessionEnded.addOnce(finish);
    active = {
      async end() { await manager.exitXRAsync(); finish(); },
      inspect: () => ({ scene, space: anchor, camera, ui, frames: frameCount, rays: lastRays }),
    };
    setState("presenting");
  }

  const handle: HeadsetSession = {
    get state() { return state; },
    get reason() { return reason; },
    get presenting() { return state === "presenting"; },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    enter,
    async exit() { await active?.end(); },
    viewport: () => (state === "presenting" && deviceHeight ? { cssHeight: deviceHeight / HEADSET_DEVICE_PIXELS_PER_CSS, deviceHeight } : null),
    inspect: () => (state === "presenting" ? active?.inspect() ?? null : null),
    dispose() {
      if (disposed) return;
      disposed = true;
      xr?.removeEventListener("devicechange", check);
      listeners.clear();
      void active?.end();
    },
  };
  const target = globalThis as typeof globalThis & { dispatchEvent?: (event: Event) => boolean };
  if (typeof target.dispatchEvent === "function" && typeof CustomEvent === "function") target.dispatchEvent(new CustomEvent(HEADSET_SESSION_EVENT, { detail: handle }));
  return handle;
}
