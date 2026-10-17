/**
 * An immersive WebXR session: the globe or the open photograph drawn for both
 * eyes of a headset. The headset space stands where the presented view, or
 * the globe camera, stands, upright on the Earth, and follows it there; the
 * head turns it and the thumbstick turns it in steps.
 */
import { Matrix, Quaternion, TransformNode, Vector3, WebXRCamera, WebXRSessionManager, type Camera, type Observer, type Scene } from "@babylonjs/core";
import { enuFrame, pointGeodetic, type Vec3 } from "@foss-earth/engine";
import type { FrameCallback, FrameSource, ImmersiveFrames } from "./frames";
import type { HeadsetRay, HeadsetTour } from "./headsetTour";
import { createSnapTurn, headingAt, headsetDepthRange, headsetSpaceRotation, reverseProjectionDepth } from "./xrMath";

export type HeadsetState = "checking" | "unavailable" | "ready" | "starting" | "presenting";

export interface HeadsetPlace { position: Vec3; forward: Vec3 }

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
  createTour(): HeadsetTour;
  report(message: string, error?: unknown): void;
}

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
  let active: { end(): Promise<void> } | null = null;
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
    const turns = new Map<XRInputSource, (axis: number) => number>();
    const rotation = new Matrix();
    const pose = new Matrix();
    const world = new Matrix();
    const local = new Vector3();
    let tour: HeadsetTour | null = null;

    const placeSpace = (): Vec3 | null => {
      const place = options.place();
      if (!place) return null;
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
    const rayOf = (xrPose: XRPose | undefined | null): HeadsetRay | null => {
      if (!xrPose) return null;
      Matrix.FromArrayToRef(xrPose.transform.matrix, 0, pose);
      pose.multiplyToRef(anchor.getWorldMatrix(), world);
      const origin = Vector3.TransformCoordinates(Vector3.ZeroReadOnly, world);
      const direction = Vector3.TransformNormal(local.set(0, 0, -1), world).normalize();
      return { origin: [origin.x, origin.y, origin.z], direction: [direction.x, direction.y, direction.z] };
    };

    const onFrame: Observer<XRFrame> = manager.onXRFrameObservable.add(() => {
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
        heading = (heading + turn(axes.length > 2 ? axes[2]! : axes[0] ?? 0) + 360) % 360;
      }
      scene.activeCamera = camera;
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
      if (!up || !tour || !frame) return;
      const rays: HeadsetRay[] = [];
      for (const input of session.inputSources) {
        if (input.targetRayMode === "gaze") continue;
        const ray = rayOf(frame.getPose(input.targetRaySpace, manager.referenceSpace));
        if (ray) rays.push(ray);
      }
      tour.frame(toWorld(camera.position, false), up, rays);
    });
    const onSelect = (event: XRInputSourceEvent): void => {
      const ray = rayOf(event.frame.getPose(event.inputSource.targetRaySpace, manager.referenceSpace));
      if (ray) tour?.select(ray);
      options.requestRender();
    };
    const onSqueeze = (): void => { tour?.back(); options.requestRender(); };
    session.addEventListener("select", onSelect);
    session.addEventListener("squeeze", onSqueeze);

    engine.runRenderLoop(loop);
    manager.runXRRenderLoop();
    frames.present(source);
    const release = options.holdRendering();
    scene.activeCamera = camera;
    try { tour = options.createTour(); } catch (error) { options.report("[vr] The headset's markers could not be made.", error); }

    let finished = false;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      active = null;
      engine.stopRenderLoop(loop);
      manager.onXRFrameObservable.remove(onFrame);
      scene.onBeforeRenderObservable.remove(onRender);
      session.removeEventListener("select", onSelect);
      session.removeEventListener("squeeze", onSqueeze);
      // The session's render targets are gone: nothing may draw into them again.
      camera.outputRenderTarget = null;
      for (const rig of camera.rigCameras) rig.outputRenderTarget = null;
      if (scene.activeCamera === camera) scene.activeCamera = options.globeCamera() ?? previousCamera;
      frames.present(null);
      release();
      tour?.dispose();
      tour = null;
      deviceHeight = null;
      // The manager is still notifying the end; its owners go after.
      void Promise.resolve().then(() => { camera.dispose(); anchor.dispose(); manager.dispose(); });
      if (!disposed) { setState("ready"); check(); }
      options.requestRender();
    };
    manager.onXRSessionEnded.addOnce(finish);
    active = { async end() { await manager.exitXRAsync(); finish(); } };
    setState("presenting");
  }

  return {
    get state() { return state; },
    get reason() { return reason; },
    get presenting() { return state === "presenting"; },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    enter,
    async exit() { await active?.end(); },
    viewport: () => (state === "presenting" && deviceHeight ? { cssHeight: deviceHeight / HEADSET_DEVICE_PIXELS_PER_CSS, deviceHeight } : null),
    dispose() {
      if (disposed) return;
      disposed = true;
      xr?.removeEventListener("devicechange", check);
      listeners.clear();
      void active?.end();
    },
  };
}
