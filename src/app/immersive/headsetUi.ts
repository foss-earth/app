/**
 * The page's interface in a headset, where a flat page's corners are out of
 * sight: its toolbar as a row below the view that follows the head lazily,
 * its windows on either side of the view as the page has them, and one "+"
 * at the toolbar's left end that opens a window, or a tab once both sides
 * hold one. The grip takes a window to float it anywhere; let go near its
 * place, it goes back.
 *
 * Each panel draws a copy of a part of the page (`createDomMirror`), and a
 * controller pointing at it plays a mouse on the page there
 * (`createDomPointer`): the trigger presses, the thumbstick scrolls. The page
 * stays the one interface: what changes on it changes in the headset.
 *
 * A vehicle's app may show parts of the page on a surface of its own instead,
 * such as a cockpit's touchscreen: those parts have no panel, a hand pointing
 * at the surface plays the mouse there, and what stays in view, such as its
 * instruments, stands above the toolbar.
 *
 * Two windows at most, as the page's workspace has two sides; more floating
 * windows need more places in the workspace.
 */
import { CreatePlane, DynamicTexture, Matrix, Quaternion, Vector3, type Mesh, type Scene, type StandardMaterial, type TransformNode } from "@babylonjs/core";
import { cross, dot, sub, type Vec3 } from "@foss-earth/engine";
import { createDomMirror, createDomPointer, type DomPointer } from "@foss-earth/ui/browser";
import { HEADSET_ACTIVE, overlayMaterial, overlayMesh } from "./headsetPointers";
import {
  apartDeg, createLazyYaw, DOCK, dockedPose, heldPose, HUD, hudRow, instrumentRow, lookDirection, pagePoint, panelPoint, popupPose, rayPanel, rectGap, rowParts, topDeg, yawOf,
  type PageRect, type PanelHit, type PanelPose,
} from "./headsetUiLayout";

export interface HeadsetUiSelectors {
  /** The toolbar: a row below the view. */
  toolbar: string;
  /** The windows, each with `data-side` "left" or "right". */
  windows: string;
  /** Menus and other popups, each a panel of its own over what opened it. */
  popups: string;
  /** The buttons that open a window on an empty side, in the page's corners: the "+" presses them. */
  launchers: { left: string; right: string };
  /** In a window, the button that adds a tab to it. */
  addTab: string;
  /** What stays in view, such as a vehicle's instruments: a row above the toolbar. Empty for none. */
  instruments: string;
}

/** FOSS Earth's windows and toolbar (@foss-earth/ui). */
export const HEADSET_UI_SELECTORS: HeadsetUiSelectors = {
  toolbar: ".hud-bar",
  windows: ".foss-earth-dock-panel[data-side]",
  // A help's explanation and a slider's track leave their window when open.
  popups: ".foss-earth-window-menu, .foss-earth-parameter__help:not([hidden]), .foss-earth-track-popover.is-open",
  launchers: {
    left: ".foss-earth-workspace-slot-launcher-left .foss-earth-panel-launcher-button",
    right: ".foss-earth-workspace-slot-launcher-right .foss-earth-panel-launcher-button",
  },
  addTab: ".foss-earth-tab-add",
  instruments: "",
};

/** Which parts of the page the headset shows on its panels; the "+" comes with the windows. */
export interface HeadsetUiParts { toolbar: boolean; windows: boolean; instruments: boolean }

const ALL_PARTS: HeadsetUiParts = { toolbar: true, windows: true, instruments: true };

/**
 * A surface in the world that shows the page, such as a cockpit's
 * touchscreen: a hand pointing at it plays the mouse there.
 */
export interface HeadsetSurface {
  id: string;
  /**
   * Where a ray in the world, from `origin` along the unit `direction`, meets
   * the surface: metres along it, and the point of the page there in CSS px,
   * or null off the page's picture. Null where it misses.
   */
  hit(origin: Vec3, direction: Vec3): { distance: number; page: { x: number; y: number } | null } | null;
  /** Where a point of the page shows on the surface, in the world, or null where it does not: for a test to aim at it. */
  locate?(page: { x: number; y: number }): Vec3 | null;
}

export interface HeadsetUiOptions {
  scene: Scene;
  /** The headset space: the panels are placed in it. */
  space: TransformNode;
  document: Document;
  layerMask: number;
  selectors?: Partial<HeadsetUiSelectors>;
  /** Elements never shown nor pointed at in the headset, besides the 3D view. */
  never?: string;
  /** Elements drawn without their own background: those behind the 3D view (`DomMirrorOptions.seeThrough`). */
  seeThrough?: string;
  requestRender(): void;
  /** Which parts show on panels, read each frame: all by default. */
  parts?(): Partial<HeadsetUiParts>;
  /** Surfaces in the world showing the page, read each frame. A popup near no panel is on them. */
  surfaces?(): readonly HeadsetSurface[];
}

/** A controller's ray in the headset space; `hand` names the controller, as its handedness. */
export interface HandRay { hand: string; origin: Vec3; direction: Vec3 }

export interface HeadsetHead { position: Vec3; forward: Vec3 }

export type HeadsetPanelKind = "toolbar" | "plus" | "window" | "popup" | "instruments";

/** What a test reads of the headset's interface. */
export interface HeadsetUiInspection {
  /** The page copies drawn so far. */
  revision: number;
  panels: {
    id: string; kind: HeadsetPanelKind; side: "left" | "right" | null; floating: boolean;
    /** The part of the page it shows, CSS px; none for the "+". */
    source: PageRect | null;
    pose: PanelPose;
  }[];
  /** What each hand points at: a panel's id, or a surface's; (u, v) on a panel, (0.5, 0.5) on a surface. */
  hands: Record<string, {
    panel: string; u: number; v: number; distance: number; point: Vec3;
    page: { x: number; y: number } | null; element: string | null; held: boolean;
  }>;
}

export interface HeadsetUi {
  /**
   * Places the panels for the head and follows each ray: the distance along
   * each hand's ray to the panel it points at, for its laser to end there.
   */
  frame(head: HeadsetHead, rays: readonly HandRay[], dtS: number): Map<string, number>;
  /**
   * Hit-tests this one ray and keeps that hit for the next press. A
   * controllerless pinch calls it on selectstart, the turn the ray appears.
   * A controller press uses the hit from earlier frames and does not call this.
   */
  point(ray: HandRay): void;
  /** The trigger pressed: true when it pressed the interface. */
  press(hand: string): boolean;
  release(hand: string): boolean;
  /** The grip pressed: true when it took a window. */
  grab(hand: string): boolean;
  drop(hand: string): boolean;
  /** The thumbstick this frame: true when it scrolled a panel or moved a held window. */
  stick(hand: string, x: number, y: number, dtS: number): boolean;
  inspect(): HeadsetUiInspection;
  /** Where a point of the page, CSS px, shows on a surface, in the headset space: for a test to aim at it. */
  locate(x: number, y: number): { surface: string; point: Vec3 } | null;
  dispose(): void;
}

/** Device pixels drawn for each CSS px of the page: a headset's pixels are smaller than a panel's. */
const TEXTURE_SCALE = 2;
const MAX_TEXTURE_PX = 2048;
const MAX_PAGE_PX = 4096;
/** Copies of the page taken at most this often, and kept within this share of the main thread. */
const SNAPSHOT_HZ = 30;
const SNAPSHOT_MAIN_THREAD_SHARE = 0.05;
/** The page's own canvases, such as a live chart, drawn again this often. */
const LIVE_CANVAS_HZ = 10;
/** Toolbar boxes nearer than this are one part of it, as are instruments'. */
const TOOLBAR_GAP_PX = 24;
/** The view ahead clear of instruments between the page's two corners, CSS px at the toolbar's scale. */
const INSTRUMENTS_MIDDLE_PX = 240;
/** Docked windows' bottoms stay this far above the instruments' tops, which follow the head below them. */
const INSTRUMENTS_CLEAR_DEG = 2;
/** A box this much of the page each way is a layer over it: what counts is in it. */
const LAYER_SHARE = 0.9;
/** A popup this near a panel's part of the page opened from it. */
const POPUP_REACH_PX = 24;
/** A window let go within this of its place goes back to it. */
const REDOCK_DEG = 10;
const SCROLL_PX_PER_S = 900;
const PUSH_M_PER_S = 1;
const STICK_DEAD_ZONE = 0.15;
const HELD_DISTANCE = { min: 0.3, max: 4 };
const PLUS_TEXTURE_PX = 96;
/** Popups that open this soon after the "+" is pressed are its menu. */
const PLUS_MENU_MS = 1000;

type Side = "left" | "right";

interface Panel {
  id: string;
  kind: HeadsetPanelKind;
  side: Side | null;
  mesh: Mesh;
  material: StandardMaterial;
  texture: DynamicTexture | null;
  source: PageRect | null;
  pose: PanelPose | null;
  /** The page copy drawn on it; −1 before one is. */
  painted: number;
  element: Element | null;
  /** A popup's panel it opened over: the grip on it takes that. */
  holder: Panel | null;
}

interface PageLayout {
  toolbar: PageRect[];
  windows: { side: Side; rect: PageRect; element: Element }[];
  popups: { rect: PageRect; element: Element }[];
  instruments: PageRect[];
  width: number;
}

/** What a hand points at: a panel, where on it, or a surface; and the point of the page there, if any. */
interface Pointing {
  panel: Panel | null;
  surface: HeadsetSurface | null;
  /** A panel's hit; on a surface, (0.5, 0.5) and where along the ray. */
  hit: PanelHit;
  page: { x: number; y: number } | null;
}
/** What a press is on: a panel, or a surface by its id, as the surfaces are read again each frame. */
interface Target { panel: Panel | null; surface: string | null }
const targetOf = (on: Pointing): Target => ({ panel: on.panel, surface: on.surface?.id ?? null });
const sameTarget = (a: Target, b: Target): boolean => (a.panel ? a.panel === b.panel : a.surface === b.surface);

const rectOf = (element: Element): PageRect => {
  const rect = element.getBoundingClientRect();
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
};
const shown = (rect: PageRect): boolean => rect.width > 0 && rect.height > 0;
const describe = (element: Element | null): string | null => {
  if (!element) return null;
  const label = element.getAttribute("aria-label") ?? element.textContent?.trim().slice(0, 40) ?? "";
  return `${element.tagName.toLowerCase()}${element.classList.length ? `.${[...element.classList].join(".")}` : ""}${label ? ` "${label}"` : ""}`;
};

export function createHeadsetUi(options: HeadsetUiOptions): HeadsetUi {
  const { scene, space, document, layerMask } = options;
  const selectors = { ...HEADSET_UI_SELECTORS, ...options.selectors };
  const view = scene.getEngine().getRenderingCanvas();
  // The emulated headset's own picture covers the page, as a headset's does not.
  // The picture's canvases sit inside it, so a press has to land on the page beneath.
  const never = ["[data-webxr_runtime]", options.never].filter(Boolean).join(", ");
  const include = (element: Element): boolean => element !== view && !element.closest(never);
  // The instruments are copied apart: a window over them on the page is on none of their panels.
  const layers = selectors.instruments ? [selectors.instruments] : [];
  const mirror = createDomMirror({ document, include, seeThrough: options.seeThrough, layers, onChange: options.requestRender });
  // The page drawn once at the panels' scale, without its instruments, then its instruments.
  const pageCanvases = [document.createElement("canvas"), ...layers.map(() => document.createElement("canvas"))];
  let pageScale = TEXTURE_SCALE;
  let layout: PageLayout | null = null;
  let paintedRevision = 0;
  /** How many times the page was drawn for the panels: a panel's part is drawn again after each. */
  let pagePainted = 0;
  let nextSnapshotAt = 0;
  let nextLivePaintAt = 0;
  let snapshotting = false;
  let disposed = false;
  const lazyYaw = createLazyYaw();
  let home: { eye: Vec3; yaw: number } | null = null;
  /** The lowest a docked window's bottom may be, above the eye: clear of the instruments. */
  let dockBottomDeg = -90;
  let head: HeadsetHead = { position: [0, 0, 0], forward: [0, 0, -1] };
  /** Windows taken from their place: where each floats. */
  const floating = new Map<Side, PanelPose>();
  const panels = new Map<string, Panel>();
  const pointing = new Map<string, Pointing>();
  const pressed = new Map<string, Target>();
  const held = new Map<string, { side: Side; distance: number; grip: { right: number; up: number } }>();
  const pointers = new Map<string, DomPointer>();
  let lastRays: readonly HandRay[] = [];
  let shows: HeadsetUiParts = ALL_PARTS;
  let surfaces: readonly HeadsetSurface[] = [];
  /**
   * The "+" pressed, and the popups open then: the first to open after it
   * are its menu, which stands on it while open. A popup opened later, such
   * as a slider's track hovered in the window the menu opened, is not.
   */
  let plusPress: { at: number; open: Set<Element> } | null = null;
  const plusMenus = new WeakSet<Element>();

  const pointerFor = (hand: string): DomPointer => {
    let pointer = pointers.get(hand);
    if (!pointer) {
      pointer = createDomPointer({ document, include, pointerType: "mouse", primary: hand !== "left" });
      pointers.set(hand, pointer);
    }
    return pointer;
  };

  const panelFor = (id: string, kind: HeadsetPanelKind, side: Side | null = null): Panel => {
    let panel = panels.get(id);
    if (!panel) {
      const mesh = overlayMesh(CreatePlane(`headset-panel-${id}`, { size: 1 }, scene), space, layerMask);
      const material = overlayMaterial(`headset-panel-${id}`, scene);
      mesh.material = material;
      mesh.setEnabled(false);
      panel = { id, kind, side, mesh, material, texture: null, source: null, pose: null, painted: -1, element: null, holder: null };
      panels.set(id, panel);
    }
    return panel;
  };
  const removePanel = (panel: Panel): void => {
    panel.mesh.dispose();
    panel.material.dispose();
    panel.texture?.dispose();
    panels.delete(panel.id);
  };
  const textureFor = (panel: Panel, width: number, height: number): DynamicTexture => {
    const w = Math.max(1, Math.min(MAX_TEXTURE_PX, Math.round(width))), h = Math.max(1, Math.min(MAX_TEXTURE_PX, Math.round(height)));
    const size = panel.texture?.getSize();
    if (panel.texture && size?.width === w && size.height === h) return panel.texture;
    panel.texture?.dispose();
    const texture = new DynamicTexture(`headset-panel-${panel.id}`, { width: w, height: h }, scene, true);
    texture.hasAlpha = true;
    panel.material.emissiveTexture = texture;
    panel.material.opacityTexture = texture;
    panel.texture = texture;
    panel.painted = -1;
    return texture;
  };
  const place = (panel: Panel, pose: PanelPose): void => {
    panel.pose = pose;
    const normal = cross(pose.right, pose.up);
    Matrix.FromValuesToRef(pose.right[0], pose.right[1], pose.right[2], 0, pose.up[0], pose.up[1], pose.up[2], 0, normal[0], normal[1], normal[2], 0, 0, 0, 0, 1, rotation);
    Quaternion.FromRotationMatrixToRef(rotation, panel.mesh.rotationQuaternion!);
    panel.mesh.position.set(pose.center[0], pose.center[1], pose.center[2]);
    panel.mesh.scaling.set(pose.width, pose.height, 1);
  };
  const rotation = new Matrix();

  // The "+": the interface's own button, drawn here rather than copied.
  const plus = panelFor("plus", "plus");
  let plusLit: boolean | null = null;
  const drawPlus = (lit: boolean): void => {
    if (plusLit === lit) return;
    plusLit = lit;
    const texture = textureFor(plus, PLUS_TEXTURE_PX, PLUS_TEXTURE_PX);
    const context = texture.getContext() as unknown as CanvasRenderingContext2D;
    const size = PLUS_TEXTURE_PX;
    context.clearRect(0, 0, size, size);
    context.fillStyle = lit ? HEADSET_ACTIVE.toHexString() : "rgba(24, 24, 28, 0.9)";
    context.beginPath();
    context.roundRect(4, 4, size - 8, size - 8, 18);
    context.fill();
    context.strokeStyle = "rgba(255, 255, 255, 0.85)";
    context.lineWidth = 5;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(size / 2, size * 0.28);
    context.lineTo(size / 2, size * 0.72);
    context.moveTo(size * 0.28, size / 2);
    context.lineTo(size * 0.72, size / 2);
    context.stroke();
    texture.update(true);
  };
  drawPlus(false);

  /** Where the parts shown are on the page, read when a copy is taken so the two agree. */
  const measure = (): PageLayout => {
    const page = { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight };
    const collect = (element: Element, depth: number, boxes: PageRect[]): void => {
      if (!include(element)) return;
      const rect = rectOf(element);
      // A box of no size, such as `display: contents`, counts by what is in it, as a layer over the page does.
      const layer = rect.width >= page.width * LAYER_SHARE && rect.height >= page.height * LAYER_SHARE;
      if (shown(rect) && !layer) boxes.push(rect);
      else if (depth > 0) for (const child of Array.from(element.children)) collect(child, depth - 1, boxes);
    };
    /** The boxes in what the selector picks: those of its children, and theirs where they have none. */
    const boxesIn = (selector: string): PageRect[] => {
      const boxes: PageRect[] = [];
      if (!selector) return boxes;
      for (const root of Array.from(document.querySelectorAll(selector))) {
        if (include(root)) for (const child of Array.from(root.children)) collect(child, 2, boxes);
      }
      return boxes;
    };
    const windows = Array.from(document.querySelectorAll(selectors.windows)).flatMap(element => {
      const side = element.getAttribute("data-side");
      const rect = rectOf(element);
      return (side === "left" || side === "right") && shown(rect) && include(element) ? [{ side: side as Side, rect, element }] : [];
    });
    const popups = Array.from(document.querySelectorAll(selectors.popups)).flatMap(element => {
      const rect = rectOf(element);
      return shown(rect) ? [{ rect, element }] : [];
    });
    return {
      toolbar: rowParts(boxesIn(selectors.toolbar), TOOLBAR_GAP_PX), windows, popups,
      instruments: rowParts(boxesIn(selectors.instruments), TOOLBAR_GAP_PX), width: page.width,
    };
  };

  const snapshot = (now: number): void => {
    if (snapshotting || !mirror.stale || now < nextSnapshotAt) return;
    snapshotting = true;
    const started = performance.now();
    const measured = measure();
    const taking = mirror.snapshot();
    // The copy's own work is what runs now; decoding it runs beside the page.
    const cost = performance.now() - started;
    nextSnapshotAt = now + Math.max(1000 / SNAPSHOT_HZ, cost / SNAPSHOT_MAIN_THREAD_SHARE);
    void taking.then(ready => {
      if (!ready || disposed) return;
      layout = measured;
      if (plusPress && started >= plusPress.at) {
        const opened = measured.popups.filter(popup => !plusPress!.open.has(popup.element));
        for (const popup of opened) plusMenus.add(popup.element);
        if (opened.length > 0 || started > plusPress.at + PLUS_MENU_MS) plusPress = null;
      }
    }, () => undefined).finally(() => { snapshotting = false; });
  };

  /** The page drawn once at the panels' scale; each panel shows its part, and shows once it has one. */
  const paint = (now: number): void => {
    if (layout && mirror.revision > 0) {
      const live = mirror.canvasCount > 0 && now >= nextLivePaintAt;
      if (mirror.revision !== paintedRevision || live) {
        const { width, height } = mirror.viewport;
        pageScale = Math.min(TEXTURE_SCALE, MAX_PAGE_PX / Math.max(width, height, 1));
        const w = Math.round(width * pageScale), h = Math.round(height * pageScale);
        pageCanvases.forEach((pageCanvas, layer) => {
          const context = pageCanvas.getContext("2d");
          if (!context) return;
          if (pageCanvas.width !== w || pageCanvas.height !== h) { pageCanvas.width = w; pageCanvas.height = h; }
          context.clearRect(0, 0, w, h);
          mirror.draw(context, { x: 0, y: 0, width, height }, { x: 0, y: 0, width: w, height: h }, layer);
        });
        if (mirror.canvasCount > 0) nextLivePaintAt = now + 1000 / LIVE_CANVAS_HZ;
        paintedRevision = mirror.revision;
        pagePainted++;
      }
      for (const panel of panels.values()) {
        if (!panel.source || panel.painted === pagePainted) continue;
        const s = panel.source;
        const texture = textureFor(panel, s.width * pageScale, s.height * pageScale);
        const size = texture.getSize();
        const target = texture.getContext() as unknown as CanvasRenderingContext2D;
        target.clearRect(0, 0, size.width, size.height);
        target.drawImage(pageCanvases[panel.kind === "instruments" ? 1 : 0]!, s.x * pageScale, s.y * pageScale, s.width * pageScale, s.height * pageScale, 0, 0, size.width, size.height);
        texture.update(true);
        panel.painted = pagePainted;
      }
    }
    for (const panel of panels.values()) panel.mesh.setEnabled(panel === plus ? shows.windows : panel.painted >= 0);
  };

  /** Every panel where it belongs this frame, from the page's layout, the parts shown and the head. */
  const arrange = (dtS: number): void => {
    const eye = head.position;
    const headYaw = yawOf(head.forward);
    home ??= { eye, yaw: headYaw };
    const page = layout;
    const used = new Set<string>();
    const hudYaw = lazyYaw(headYaw, dtS);
    const parts = shows.toolbar ? page?.toolbar ?? [] : [];
    const heightPx = Math.max(28, ...parts.map(part => part.height));
    const row = hudRow(eye, hudYaw, [...shows.windows ? [heightPx] : [], ...parts.map(part => part.width)], heightPx);
    if (shows.windows) { used.add(plus.id); place(plus, row.shift()!); }
    const holders: { pose: PanelPose; source: PageRect; panel: Panel }[] = [];
    parts.forEach((part, index) => {
      const panel = panelFor(`toolbar-${index}`, "toolbar");
      used.add(panel.id);
      panel.source = part;
      place(panel, { ...row[index]!, height: part.height * HUD.metresPerPx });
      holders.push({ pose: panel.pose!, source: part, panel });
    });
    const instruments = shows.instruments ? page?.instruments ?? [] : [];
    const standing = instrumentRow(eye, hudYaw, instruments, page?.width ?? 0, heightPx, INSTRUMENTS_MIDDLE_PX);
    instruments.forEach((part, index) => {
      const panel = panelFor(`instruments-${index}`, "instruments");
      used.add(panel.id);
      panel.source = part;
      place(panel, standing[index]!);
      holders.push({ pose: panel.pose!, source: part, panel });
    });
    dockBottomDeg = standing.length > 0 ? topDeg(eye, standing) + INSTRUMENTS_CLEAR_DEG : -90;
    const windows = shows.windows ? page?.windows ?? [] : [];
    for (const window of windows) {
      const panel = panelFor(`window-${window.side}`, "window", window.side);
      used.add(panel.id);
      panel.source = window.rect;
      panel.element = window.element;
      const docked = dockedPose(window.side, home.eye, home.yaw, window.rect, DOCK, dockBottomDeg);
      const float = floating.get(window.side);
      let pose = docked;
      if (float) {
        // A window that grows on the page grows down from its top, where it was put.
        const corner = panelPoint(float, 0, 0);
        const w = docked.width, h = docked.height;
        pose = { ...float, width: w, height: h, center: [corner[0] + float.right[0] * w / 2 - float.up[0] * h / 2, corner[1] + float.right[1] * w / 2 - float.up[1] * h / 2, corner[2] + float.right[2] * w / 2 - float.up[2] * h / 2] };
        floating.set(window.side, pose);
      }
      place(panel, pose);
      holders.push({ pose, source: window.rect, panel });
    }
    for (const side of ["left", "right"] as const) if (!windows.some(window => window.side === side)) floating.delete(side);
    let index = 0;
    for (const { rect: popup, element } of page?.popups ?? []) {
      let holder: (typeof holders)[number] | null = null;
      const menu = shows.windows && plusMenus.has(element);
      if (!menu) {
        let nearest = POPUP_REACH_PX;
        for (const candidate of holders) {
          const gap = rectGap(popup, candidate.source);
          if (gap <= nearest) { nearest = gap; holder = candidate; }
        }
        // Near no panel, it is of a part on a surface, which shows it; or it stands on the "+".
        if (!holder && (surfaces.length > 0 || !shows.windows)) continue;
      }
      const panel = panelFor(`popup-${index++}`, "popup");
      used.add(panel.id);
      panel.source = popup;
      panel.holder = holder?.panel ?? null;
      place(panel, popupPose(popup, holder, plus.pose!));
    }
    for (const panel of [...panels.values()]) {
      if (used.has(panel.id)) continue;
      for (const [hand, on] of pressed) if (on.panel === panel) { pressed.delete(hand); pointerFor(hand).leave(); }
      if (panel === plus) { panel.mesh.setEnabled(false); continue; }
      removePanel(panel);
    }
  };

  const toWorld = new Matrix();
  const toSpace = new Matrix();
  /** Where a ray in the headset space meets a surface, which takes rays in the world. */
  const onSurface = (ray: HandRay, surface: HeadsetSurface): Pointing | null => {
    toWorld.copyFrom(space.getWorldMatrix());
    const origin = Vector3.TransformCoordinates(Vector3.FromArray(ray.origin), toWorld);
    const direction = Vector3.TransformNormal(Vector3.FromArray(ray.direction), toWorld).normalize();
    const hit = surface.hit([origin.x, origin.y, origin.z], [direction.x, direction.y, direction.z]);
    if (!hit) return null;
    const size = Math.hypot(...ray.direction) || 1;
    // The headset space has no scale: metres along the ray are the same in it.
    const point = ray.origin.map((value, i) => value + ray.direction[i]! / size * hit.distance) as unknown as Vec3;
    return { panel: null, surface, hit: { u: 0.5, v: 0.5, distance: hit.distance, point }, page: hit.page };
  };
  const onPanel = (ray: HandRay, panel: Panel, bounded = true): Pointing | null => {
    const hit = panel.pose ? rayPanel(ray.origin, ray.direction, panel.pose, bounded) : null;
    return hit ? { panel, surface: null, hit, page: panel.source ? pagePoint(panel.source, hit.u, hit.v) : null } : null;
  };

  const follow = (rays: readonly HandRay[]): Map<string, number> => {
    const lengths = new Map<string, number>();
    const seen = new Set<string>();
    for (const ray of rays) {
      seen.add(ray.hand);
      const holding = held.get(ray.hand);
      if (holding) {
        const panel = panels.get(`window-${holding.side}`);
        if (panel?.pose) {
          const pose = heldPose(ray.origin, ray.direction, holding.distance, holding.grip, head.position, panel.pose.width, panel.pose.height);
          floating.set(holding.side, pose);
          place(panel, pose);
          lengths.set(ray.hand, holding.distance);
        }
        pointing.delete(ray.hand);
        continue;
      }
      const pressedOn = pressed.get(ray.hand);
      let best: Pointing | null = null;
      if (pressedOn) {
        // A press stays with what it pressed, as a mouse's capture does: off a panel's edge too.
        const surface = surfaces.find(candidate => candidate.id === pressedOn.surface);
        best = pressedOn.panel ? onPanel(ray, pressedOn.panel, false) : surface ? onSurface(ray, surface) : null;
      } else {
        for (const panel of panels.values()) {
          if (!panel.mesh.isEnabled()) continue;
          const on = onPanel(ray, panel);
          if (on && (!best || on.hit.distance < best.hit.distance)) best = on;
        }
        for (const surface of surfaces) {
          const on = onSurface(ray, surface);
          if (on && (!best || on.hit.distance < best.hit.distance)) best = on;
        }
      }
      const pointer = pointerFor(ray.hand);
      if (best) {
        pointing.set(ray.hand, best);
        const { u, v } = best.hit;
        if (u >= 0 && u <= 1 && v >= 0 && v <= 1) lengths.set(ray.hand, best.hit.distance);
        if (best.page) pointer.move(best.page.x, best.page.y);
        else if (!pressedOn && (pointer.hovered || pointer.pressed)) pointer.leave();
      } else {
        pointing.delete(ray.hand);
        if (!pressedOn && (pointer.hovered || pointer.pressed)) pointer.leave();
      }
    }
    for (const hand of [...pointing.keys()]) if (!seen.has(hand)) pointing.delete(hand);
    for (const [hand, pointer] of pointers) if (!seen.has(hand) && (pointer.hovered || pointer.pressed)) { pointer.leave(); pressed.delete(hand); }
    drawPlus([...pointing.values()].some(on => on.panel === plus));
    return lengths;
  };

  /** Presses a page element as the hand's pointer, without moving its ray. */
  const pressElement = (hand: string, element: Element): void => {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    const pointer = pointerFor(hand);
    pointer.down(x, y);
    pointer.up(x, y);
    pointer.leave();
  };
  const plusPressed = (hand: string): void => {
    plusPress = { at: performance.now(), open: new Set(layout?.popups.map(popup => popup.element)) };
    mirror.invalidate();
    for (const side of ["left", "right"] as const) {
      const launcher = document.querySelector(selectors.launchers[side]);
      if (launcher && shown(rectOf(launcher))) { pressElement(hand, launcher); return; }
    }
    // Both sides hold a window: a tab for the one looked at most nearly.
    const ahead = lookDirection(yawOf(head.forward));
    const target: Vec3 = [head.position[0] + ahead[0], head.position[1], head.position[2] + ahead[2]];
    const windows = [...panels.values()].filter(panel => panel.kind === "window" && panel.pose && panel.element)
      .sort((a, b) => apartDeg(head.position, a.pose!.center, target) - apartDeg(head.position, b.pose!.center, target));
    const add = windows[0]?.element?.querySelector(selectors.addTab);
    // Its menu opens in that window, and floats over it there.
    plusPress = null;
    if (add) pressElement(hand, add);
  };

  return {
    frame(next, rays, dtS) {
      if (disposed) return new Map();
      head = next;
      lastRays = rays;
      shows = { ...ALL_PARTS, ...options.parts?.() };
      surfaces = options.surfaces?.() ?? [];
      const now = performance.now();
      // With every part on a surface, no copy of the page is wanted here.
      if (shows.toolbar || shows.windows || shows.instruments) snapshot(now);
      arrange(dtS);
      paint(now);
      return follow(rays);
    },
    point(ray) {
      if (!disposed) follow([ray]);
    },
    press(hand) {
      const on = pointing.get(hand);
      if (disposed || !on) return false;
      if (on.panel === plus) { plusPressed(hand); return true; }
      if (on.page) {
        pointerFor(hand).down(on.page.x, on.page.y);
        pressed.set(hand, targetOf(on));
      }
      return true;
    },
    release(hand) {
      const target = pressed.get(hand);
      if (disposed || !target) return false;
      pressed.delete(hand);
      const on = pointing.get(hand);
      const pointer = pointerFor(hand);
      if (on && sameTarget(targetOf(on), target) && on.page) pointer.up(on.page.x, on.page.y);
      else pointer.leave();
      return true;
    },
    grab(hand) {
      const on = pointing.get(hand);
      // A popup over a window, such as a slider's track, is part of it.
      const window = on?.panel?.kind === "popup" ? on.panel.holder : on?.panel;
      if (disposed || !on || window?.kind !== "window" || !window.side || !window.pose) return false;
      const offset = sub(on.hit.point, window.pose.center);
      held.set(hand, { side: window.side, distance: on.hit.distance, grip: { right: dot(offset, window.pose.right), up: dot(offset, window.pose.up) } });
      pressed.delete(hand);
      pointerFor(hand).leave();
      return true;
    },
    drop(hand) {
      const holding = held.get(hand);
      if (disposed || !holding) return false;
      held.delete(hand);
      const panel = panels.get(`window-${holding.side}`);
      if (panel?.pose && panel.source && home) {
        const docked = dockedPose(holding.side, home.eye, home.yaw, panel.source, DOCK, dockBottomDeg);
        if (apartDeg(head.position, panel.pose.center, docked.center) < REDOCK_DEG) floating.delete(holding.side);
      }
      return true;
    },
    stick(hand, _x, y, dtS) {
      if (disposed) return false;
      const amount = Math.abs(y) < STICK_DEAD_ZONE ? 0 : y;
      const holding = held.get(hand);
      if (holding) {
        // Forward pushes the window away, back brings it near.
        holding.distance = Math.min(HELD_DISTANCE.max, Math.max(HELD_DISTANCE.min, holding.distance - amount * PUSH_M_PER_S * dtS));
        return true;
      }
      const on = pointing.get(hand);
      if (!on) return false;
      if (amount !== 0 && on.page) pointerFor(hand).wheel(on.page.x, on.page.y, 0, amount * SCROLL_PX_PER_S * dtS);
      return true;
    },
    inspect() {
      const hands: HeadsetUiInspection["hands"] = {};
      for (const ray of lastRays) {
        const on = pointing.get(ray.hand);
        const holding = held.get(ray.hand);
        if (!on && !holding) continue;
        hands[ray.hand] = {
          panel: on ? on.panel?.id ?? on.surface!.id : `window-${holding!.side}`, u: on?.hit.u ?? 0.5, v: on?.hit.v ?? 0.5, distance: on?.hit.distance ?? holding!.distance,
          point: on?.hit.point ?? panels.get(`window-${holding!.side}`)!.pose!.center, page: on?.page ?? null,
          element: describe(pointers.get(ray.hand)?.hovered ?? null), held: Boolean(holding),
        };
      }
      return {
        revision: paintedRevision,
        panels: [...panels.values()].filter(panel => panel.pose && panel.mesh.isEnabled()).map(panel => ({
          id: panel.id, kind: panel.kind, side: panel.side, floating: Boolean(panel.side && floating.has(panel.side)), source: panel.source, pose: panel.pose!,
        })),
        hands,
      };
    },
    locate(x, y) {
      space.getWorldMatrix().invertToRef(toSpace);
      for (const surface of surfaces) {
        const world = surface.locate?.({ x, y });
        if (!world) continue;
        const local = Vector3.TransformCoordinates(Vector3.FromArray(world), toSpace);
        return { surface: surface.id, point: [local.x, local.y, local.z] };
      }
      return null;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const pointer of pointers.values()) pointer.dispose();
      pointers.clear();
      for (const panel of [...panels.values()]) removePanel(panel);
      mirror.dispose();
    },
  };
}

/** A local look direction from a camera's rotation in the headset space. */
export function forwardOf(rotation: Quaternion | null): Vec3 {
  const forward = new Vector3(0, 0, -1);
  if (!rotation) return [0, 0, -1];
  const turned = forward.rotateByQuaternionToRef(rotation, new Vector3());
  return [turned.x, turned.y, turned.z];
}
