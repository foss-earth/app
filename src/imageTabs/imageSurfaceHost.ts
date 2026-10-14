/**
 * The image tabs' one surface (docs/proposals/shared-image-viewer-implementation.md
 * §6–§11): which documents the windows show, their shared camera and wipe,
 * their pixels, the input of the body that shows them and the commands its
 * toolbar offers. One surface state serves a single image tab and two joined
 * ones alike; only the body that shows it changes.
 */
import { controlTakesKey } from "@felipegalind0/gamepad-tools/browser";
import { createWheelGestureClassifier } from "@foss-earth/engine";
import { createImageSourceCache, rgba8Bytes, type ImageSourceHold } from "@foss-earth/images";
import {
  createRectangleCameraTarget, fitRectangleSurface, rectangleNativeStatus, rectanglePresentedDocuments, rectangleScaleLimits, rectangleSurfacePresentation,
  initialRectangleSurfaceState, nativeRectangleCamera, presentRectangleSurface, resizeRectangleSurface, setRectangleWipe, withRectangleCamera,
  type RectangleScaleLimits, type RectangleSide, type RectangleSlotDocument, type RectangleSurfaceState,
} from "@foss-earth/image-viewer";
import type { RectangleSampling, RectangleSurfaceDraw, RectangleSurfaceHandle, RectangleSurfaceTexture } from "@foss-earth/image-viewer/babylon";
import { attachLookInput, createWheelGestureRouter, type LookInputBinding } from "@foss-earth/image-viewer/input";
import type { SurfaceGeometry, SurfaceGeometryPort } from "@foss-earth/ui/browser";
import type { WindowSlotId, WorkspaceSnapshotSource } from "@foss-earth/ui/windowing";
import { discoverFileImage, discoverUrlImage, type ImageDiscovery, type ImageDiscoveryPorts } from "./imageDiscovery";
import { createImageDocumentRegistry, OPEN_IMAGE_TAB, type ImageDocument, type ImageDocumentRegistry } from "./imageDocuments";
import { imageParticipation, openImageTabs, type ImageParticipation } from "./imageParticipation";
import type { RectangleImageSource, RectangleImageSourceLoader } from "./imageSources";

/** The keys an image surface takes from the globe while it has the focus. */
export const IMAGE_SURFACE_KEYS = "ArrowLeft ArrowRight ArrowUp ArrowDown + = - _ Escape";
/** Shown where no image is: the theme's dark panel tone, so a loading side reads as empty. */
const BACKGROUND: readonly [number, number, number] = [0.07, 0.08, 0.09];
/** Framebuffer pixels match the display's when they agree this closely. */
const DISPLAY_PIXEL_TOLERANCE = 1e-3;

export type ImageSideStatus = "loading" | "ready" | "failed" | "waiting" | "unshown";

export interface ImageSideView {
  readonly side: RectangleSide;
  readonly tabId: string;
  readonly documentId: string;
  readonly title: string;
  readonly width: number;
  readonly height: number;
  /** `waiting` while the graphics device is lost; `unshown` beside an image of another aspect. */
  readonly status: ImageSideStatus;
  readonly error: string | null;
}

export interface ImageSurfaceView {
  readonly presentation: "none" | "single" | "pair" | "incompatible";
  readonly incompatibleReason: string | null;
  /** Left first. */
  readonly sides: readonly ImageSideView[];
  /** The source native-pixel inspection names. */
  readonly focused: ImageSideView | null;
  readonly wipe: number;
  readonly sampling: RectangleSampling;
  /** Framebuffer pixels per texel of the focused source across; 1 is native. */
  readonly pixelsPerTexel: number | null;
  /** Whether the camera shows the focused source at one texel per framebuffer pixel, centred on pixels. */
  readonly native: { readonly scale: boolean; readonly aligned: boolean } | null;
  /** Why the last 1:1 command could not be met. */
  readonly nativeProblem: string | null;
  /** What a framebuffer pixel is here: the display's own, or a scaled one. */
  readonly resolution: { readonly pixelsPerCss: number; readonly devicePixelRatio: number; readonly displayPixels: boolean } | null;
  /** Why images cannot be drawn on this device, or null. */
  readonly unavailable: string | null;
  readonly opening: { readonly busy: boolean; readonly error: string | null };
}

/** The window overlay as the image tabs use it. */
export interface ImageWorkspacePort {
  readonly workspace: WorkspaceSnapshotSource<string>;
  openTabInSlot(tabId: string, slotId: WindowSlotId): void;
}

export interface ImageSurfaceHostPorts {
  window: Window;
  canvas: HTMLCanvasElement;
  load: RectangleImageSourceLoader;
  /** The rectangle renderer: draws what the surface reads each frame, after the world. */
  renderer: { readonly unavailableReason: string | null; addSurface(read: () => RectangleSurfaceDraw | null): RectangleSurfaceHandle };
  observeGeometry(element: HTMLElement): SurfaceGeometryPort;
  onBeforeRender(callback: () => void): () => void;
  requestRender(): void;
  nowMs(): number;
  inputMode(): "auto" | "mouse" | "trackpad";
  safariGestures: boolean;
  onDeviceLost(listener: () => void): () => void;
  onDeviceRestored(listener: () => void): () => void;
  /** Recently shown images kept for switching back, within the shared kept-GPU setting. */
  keptGpuBytes: number;
  discovery: ImageDiscoveryPorts;
}

export interface ImageSurfaceHost {
  readonly registry: ImageDocumentRegistry;
  getView(): ImageSurfaceView;
  subscribe(listener: () => void): () => void;
  /** The body that shows the surface; the last attached one draws. Returns the detach. */
  attachSurface(element: HTMLElement): () => void;
  /** The workspace whose selected image tabs the surface shows. Returns the unbind. */
  bindWorkspace(overlay: ImageWorkspacePort): () => void;
  /** Opens a tab for the image beside the Open image tab; false with the reason in the view. */
  openUrl(input: string): Promise<boolean>;
  openFile(file: Blob & { readonly name: string }): Promise<boolean>;
  /** The same document in a new tab on the other side. */
  duplicate(tabId: string): void;
  fit(): void;
  /** One texel of the focused source per framebuffer pixel. */
  native(): void;
  setSampling(sampling: RectangleSampling): void;
  setWipe(wipe: number): void;
  dispose(): void;
}

interface Held {
  readonly document: ImageDocument;
  readonly controller: AbortController;
  hold: ImageSourceHold<RectangleImageSource> | null;
  status: "loading" | "ready" | "failed";
  error: string | null;
}

interface Surface {
  readonly element: HTMLElement;
  readonly geometry: SurfaceGeometryPort;
  readonly binding: LookInputBinding;
  readonly off: readonly (() => void)[];
}

const message = (error: unknown): string => error instanceof Error ? error.message : String(error);
const NO_PARTICIPATION: ImageParticipation = { left: null, right: null, focused: null };

export function createImageSurfaceHost(ports: ImageSurfaceHostPorts): ImageSurfaceHost {
  const { window } = ports;
  const document = window.document;
  const registry = createImageDocumentRegistry();
  const cache = createImageSourceCache<RectangleImageSource>({ broker: ports.discovery.broker, keptGpuBytes: ports.keptGpuBytes, gpuBytes: source => source.gpuBytes });
  const router = createWheelGestureRouter({ window, nowMs: ports.nowMs });
  const held = new Map<string, Held>();
  const surfaces: Surface[] = [];
  const listeners = new Set<() => void>();
  let state: RectangleSurfaceState = initialRectangleSurfaceState();
  let participation = NO_PARTICIPATION;
  let workspace: ImageWorkspacePort | null = null;
  let sampling: RectangleSampling = "linear";
  let nativeProblem: string | null = null;
  let deviceLost = false, disposed = false;
  let opening = 0, openingError: string | null = null;
  let view: ImageSurfaceView | null = null, notifying = false, syncQueued = false;
  let presentedKey = "";

  const active = (): Surface | null => surfaces.at(-1) ?? null;
  const geometry = (): SurfaceGeometry | null => {
    const read = active()?.geometry.read();
    return read?.visible ? read : null;
  };
  function changed(): void {
    view = null;
    ports.requestRender();
    if (notifying) return;
    notifying = true;
    queueMicrotask(() => {
      notifying = false;
      if (!disposed) for (const listener of [...listeners]) listener();
    });
  }

  // Pixels: one hold per presented document, through the shared cache so a
  // tab shown again soon after is still there.
  function drop(id: string): void {
    const entry = held.get(id);
    if (!entry) return;
    held.delete(id);
    entry.controller.abort(new DOMException("The image left the surface.", "AbortError"));
    entry.hold?.release();
  }
  function start(document: ImageDocument): void {
    const entry: Held = { document, controller: new AbortController(), hold: null, status: "loading", error: null };
    held.set(document.id, entry);
    const current = () => held.get(document.id) === entry && !entry.controller.signal.aborted;
    cache.acquire(document.assetKey, { signal: entry.controller.signal, priority: 10, overlap: false,
      estimatedGpuBytes: rgba8Bytes(document.width, document.height),
      load: (scope, request) => ports.load(document, scope, request) }).then(hold => {
      if (!current()) { hold.release(); return; }
      entry.hold = hold; entry.status = "ready";
      // Nothing is replaced in place: the texture is visible from the next frame.
      hold.settleReplacement();
      changed();
    }, error => {
      if (!current()) return;
      entry.status = "failed"; entry.error = `${document.title} could not be shown: ${message(error)}`;
      changed();
    });
  }
  function syncResources(): void {
    const wanted = new Set(rectanglePresentedDocuments(state.presentation).map(slot => slot.documentId));
    for (const [id, entry] of [...held]) {
      // The device or the session ended its operation: load it again.
      if (!wanted.has(id) || entry.hold && !entry.hold.resource.isCurrent()) drop(id);
    }
    if (deviceLost) return;
    const documents = registry.getSnapshot().documents;
    for (const id of wanted) {
      const document = documents.get(id);
      if (document && !held.has(id)) start(document);
    }
  }
  const queueSync = (): void => {
    if (syncQueued) return;
    syncQueued = true;
    queueMicrotask(() => { syncQueued = false; if (!disposed) { syncResources(); changed(); } });
  };
  const textureOf = (slot: RectangleSlotDocument): RectangleSurfaceTexture | null => {
    const hold = held.get(slot.documentId)?.hold;
    if (!hold) return null;
    if (hold.resource.isCurrent()) return hold.resource.texture;
    queueSync();
    return null;
  };

  // What the windows show.
  let computing = false, again = false;
  function recompute(): void {
    if (computing) { again = true; return; }
    computing = true;
    try {
      do {
        again = false;
        const snapshot = workspace?.workspace.getSnapshot() ?? null;
        if (snapshot) registry.retainOpen(openImageTabs(snapshot));
        participation = imageParticipation(snapshot, tabId => registry.documentOf(tabId));
        const presentation = rectangleSurfacePresentation(participation.left, participation.right);
        const key = rectanglePresentedDocuments(presentation).map(slot => slot.documentId).sort().join(" ");
        // Another document ends what input was under way; a swap of sides does not.
        if (key !== presentedKey) { presentedKey = key; for (const surface of surfaces) surface.binding.cancel(); nativeProblem = null; }
        state = presentRectangleSurface(state, presentation);
        syncResources();
      } while (again);
    } finally { computing = false; }
    changed();
  }

  /** The presented document native inspection names. */
  function focusedSlot(): { side: RectangleSide; slot: RectangleSlotDocument } | null {
    const presentation = state.presentation;
    if (presentation.kind === "single") return { side: presentation.side, slot: presentation.document };
    if (presentation.kind !== "pair") return null;
    const side = participation.focused ?? "left";
    return { side, slot: side === "left" ? presentation.left : presentation.right };
  }
  function viewportOf(read: SurfaceGeometry): { width: number; height: number } {
    return { width: read.framebufferRect.width / read.pixelsPerCssX, height: read.framebufferRect.height / read.pixelsPerCssY };
  }
  function syncViewport(): void {
    const read = geometry();
    if (!read) return;
    const next = resizeRectangleSurface(state, viewportOf(read));
    if (next !== state) { state = next; changed(); }
  }
  function scaleLimits(): RectangleScaleLimits {
    if (!state.extent) return { min: 1e-9, max: 1e9 };
    const widest = Math.max(state.extent.width, ...rectanglePresentedDocuments(state.presentation).map(slot => slot.size?.width ?? 0));
    return rectangleScaleLimits(state.extent, state.viewport, { width: widest, pixelsPerCss: geometry()?.pixelsPerCssX ?? window.devicePixelRatio });
  }
  const shows = (): boolean => state.presentation.kind === "single" || state.presentation.kind === "pair";
  const target = createRectangleCameraTarget({
    get: () => shows() ? state.camera : null,
    set(camera) { state = withRectangleCamera(state, camera); nativeProblem = null; changed(); },
    viewport: () => state.viewport,
    limits: scaleLimits,
  });

  function draw(): RectangleSurfaceDraw | null {
    const surface = active();
    if (!surface) return null;
    const read = surface.geometry.refresh();
    if (!read.visible) return null;
    syncViewport();
    const base = { framebufferRect: read.framebufferRect, pixelsPerCss: { x: read.pixelsPerCssX, y: read.pixelsPerCssY },
      wipe: state.wipe, sampling, background: BACKGROUND };
    const presentation = state.presentation;
    if ((presentation.kind === "single" || presentation.kind === "pair") && state.extent && state.camera) {
      const side = (slot: RectangleSlotDocument) => ({ source: textureOf(slot) });
      return { ...base, extent: state.extent, camera: state.camera,
        left: presentation.kind === "pair" ? side(presentation.left) : presentation.side === "left" ? side(presentation.document) : null,
        right: presentation.kind === "pair" ? side(presentation.right) : presentation.side === "right" ? side(presentation.document) : null };
    }
    // The body is opaque even with nothing to show: the background alone.
    return { ...base, extent: { width: 1, height: 1 }, camera: { scale: 1, x: 0, y: 0 }, left: { source: null }, right: null };
  }
  const drawing = ports.renderer.addSurface(draw);

  let lastStepMs: number | null = null;
  const offStep = ports.onBeforeRender(() => {
    if (!target.moving()) { lastStepMs = null; return; }
    const now = ports.nowMs();
    const dt = lastStepMs === null ? 1000 / 60 : Math.min(100, Math.max(0, now - lastStepMs));
    lastStepMs = now;
    if (target.step(dt)) ports.requestRender();
  });
  const offLost = ports.onDeviceLost(() => {
    deviceLost = true;
    for (const id of [...held.keys()]) drop(id);
    changed();
  });
  const offRestored = ports.onDeviceRestored(() => {
    deviceLost = false;
    syncResources();
    changed();
  });

  function sideView(side: RectangleSide, slot: RectangleSlotDocument, shown: boolean): ImageSideView {
    const entry = held.get(slot.documentId);
    const status: ImageSideStatus = !shown ? "unshown" : entry ? entry.status : deviceLost ? "waiting" : "loading";
    return { side, tabId: slot.tabId, documentId: slot.documentId, title: slot.title,
      width: slot.size?.width ?? 0, height: slot.size?.height ?? 0, status, error: entry?.error ?? null };
  }
  function computeView(): ImageSurfaceView {
    const presentation = state.presentation;
    const sides: ImageSideView[] = [];
    if (presentation.kind === "single") sides.push(sideView(presentation.side, presentation.document, true));
    if (presentation.kind === "pair" || presentation.kind === "incompatible") {
      const shown = presentation.kind === "pair";
      sides.push(sideView("left", presentation.left, shown), sideView("right", presentation.right, shown));
    }
    const focus = focusedSlot();
    const focused = focus ? sides.find(side => side.side === focus.side) ?? null : null;
    const read = geometry();
    const ratio = read ? { x: read.pixelsPerCssX, y: read.pixelsPerCssY } : null;
    const size = focus?.slot.size ?? null;
    const measurable = ratio && size && state.extent && state.camera && shows();
    return {
      presentation: presentation.kind,
      incompatibleReason: presentation.kind === "incompatible" ? presentation.reason : null,
      sides, focused, wipe: state.wipe, sampling,
      pixelsPerTexel: measurable ? state.camera!.scale * state.extent!.width / size!.width * ratio!.x : null,
      native: measurable ? rectangleNativeStatus(state.camera!, state.extent!, size!, ratio!) : null,
      nativeProblem,
      resolution: ratio ? { pixelsPerCss: ratio.x, devicePixelRatio: window.devicePixelRatio,
        displayPixels: Math.abs(ratio.x - window.devicePixelRatio) <= DISPLAY_PIXEL_TOLERANCE && Math.abs(ratio.y - window.devicePixelRatio) <= DISPLAY_PIXEL_TOLERANCE } : null,
      unavailable: ports.renderer.unavailableReason,
      opening: { busy: opening > 0, error: openingError },
    };
  }

  function openingSlot(): WindowSlotId {
    const snapshot = workspace?.workspace.getSnapshot();
    if (!snapshot) return "primary";
    if (snapshot.secondary.tabs.includes(OPEN_IMAGE_TAB)) return "secondary";
    if (snapshot.primary.tabs.includes(OPEN_IMAGE_TAB)) return "primary";
    return snapshot.focusedSide ?? "primary";
  }
  async function open(discover: () => Promise<ImageDiscovery>): Promise<boolean> {
    opening += 1; openingError = null; changed();
    let result: ImageDiscovery;
    try { result = await discover(); }
    catch (error) { result = { ok: false, reason: message(error) }; }
    finally { opening -= 1; }
    if (disposed) return false;
    if (!result.ok) { openingError = result.reason; changed(); return false; }
    const tab = registry.open(result.description);
    workspace?.openTabInSlot(tab.tabId, openingSlot());
    changed();
    return true;
  }

  const offRegistry = registry.subscribe(() => recompute());

  return {
    registry,
    getView: () => view ??= computeView(),
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    attachSurface(element) {
      const surfaceGeometry = ports.observeGeometry(element);
      const takesKey = (eventTarget: EventTarget | null, key: string): boolean => eventTarget === element ? false : controlTakesKey(eventTarget, key);
      const binding = attachLookInput({
        window, canvas: element, model: target, router, controlTakesKey: takesKey,
        createWheelGestureClassifier: options => createWheelGestureClassifier({ ...options, nowMs: ports.nowMs }),
        localPoint(clientX, clientY) {
          const read = surfaceGeometry.read(), canvas = ports.canvas.getBoundingClientRect();
          return { x: clientX - canvas.left - read.framebufferRect.x / read.pixelsPerCssX, y: clientY - canvas.top - read.framebufferRect.y / read.pixelsPerCssY };
        },
        // The keys follow the focus: a surface the person used owns them until it loses it or Escape.
        ownsKeys: () => element.contains(document.activeElement),
        onExit() {
          const focused = document.activeElement as HTMLElement | null;
          if (focused && element.contains(focused)) focused.blur();
        },
        onUserInput() {},
        requestFrame: ports.requestRender,
        inputMode: ports.inputMode,
        safariGestures: ports.safariGestures,
      });
      const focus = (): void => { if (document.activeElement !== element) element.focus({ preventScroll: true }); };
      element.addEventListener("pointerdown", focus);
      const offGeometry = surfaceGeometry.subscribe(() => { if (active()?.element === element) { syncViewport(); changed(); } });
      const surface: Surface = { element, geometry: surfaceGeometry, binding,
        off: [() => element.removeEventListener("pointerdown", focus), offGeometry, () => binding.detach(), () => surfaceGeometry.dispose()] };
      surfaces.push(surface);
      surfaceGeometry.refresh();
      syncViewport();
      changed();
      return () => {
        const index = surfaces.indexOf(surface);
        if (index < 0) return;
        surfaces.splice(index, 1);
        for (const off of surface.off) off();
        changed();
      };
    },
    bindWorkspace(overlay) {
      workspace = overlay;
      const off = overlay.workspace.subscribe(() => recompute());
      recompute();
      return () => {
        off();
        if (workspace !== overlay) return;
        workspace = null;
        recompute();
      };
    },
    openUrl: input => open(() => discoverUrlImage(input, ports.discovery)),
    openFile: file => open(() => discoverFileImage(file, ports.discovery)),
    duplicate(tabId) {
      const snapshot = workspace?.workspace.getSnapshot();
      const tab = registry.duplicate(tabId);
      if (!tab || !workspace) return;
      workspace.openTabInSlot(tab.tabId, snapshot?.primary.tabs.includes(tabId) ? "secondary" : "primary");
    },
    fit() {
      target.cancelInertia();
      state = fitRectangleSurface(state); nativeProblem = null; changed();
    },
    native() {
      const focus = focusedSlot(), read = geometry();
      if (!focus?.slot.size || !state.extent || !state.camera || !read) {
        nativeProblem = "No image is shown to inspect."; changed(); return;
      }
      target.cancelInertia();
      const result = nativeRectangleCamera(state.camera, state.extent, focus.slot.size, { x: read.pixelsPerCssX, y: read.pixelsPerCssY }, state.viewport);
      if (result.ok) { state = withRectangleCamera(state, result.camera); nativeProblem = null; }
      else nativeProblem = result.reason;
      changed();
    },
    setSampling(next) { if (next !== sampling) { sampling = next; changed(); } },
    setWipe(wipe) {
      const next = setRectangleWipe(state, wipe);
      if (next !== state) { state = next; changed(); }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      offRegistry(); offStep(); offLost(); offRestored();
      for (const surface of surfaces.splice(0)) for (const off of surface.off) off();
      drawing.dispose();
      for (const id of [...held.keys()]) drop(id);
      cache.dispose();
      router.dispose();
      listeners.clear();
    },
  };
}
