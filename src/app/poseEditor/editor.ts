/** Placement gizmo. It loads only when the address has exactly one `dev=1`, including on the published site. */
import { dot, enuFrame, length, sub, type Vec3 } from "@foss-earth/engine";
import { worldViewportClientRect } from "@foss-earth/engine/browser";
import type { SceneController, SceneStatus } from "@foss-earth/scenes/browser";
import "./pose-editor.css";
import {
  POSE_HANDLES, axisShift, axisSpin, axisTravel, clampLatitude, clampPitch, gizmoArmMeters, gizmoPolylines, insideGizmoAnchor,
  projectPoint, ringScreenDragDeg, rotateHeading, screenTurnDeg, shiftCapture, viewRay, wrapHeading, wrapLongitude, wrapRoll,
  type PoseHandle, type ViewFrame,
} from "./poseMath";
import { scenePublicPath } from "./poseFile";
import { bindPoseEditStop, setPoseEditTitle } from "./poseEditTab";
import { createPoseEditSession } from "./poseEditSession";
import type { PoseOverrides } from "./poseOverrides";
import { DEFAULT_POSE_EXPORT_PREFIX, poseExportFilename, type DesiredNumbers, type PoseEditRecord } from "./poseStore";

const SAVE_URL = "/__foss-earth/pose";
const LONG_PRESS_MS = 500;
const CONFIRM_MS = 5000;
const HANDLE_COLOR: Record<PoseHandle, string> = {
  east: "#ff5a5a", north: "#4aa3ff", up: "#3dde8a", heading: "#3dde8a", pitch: "#ff5a5a", roll: "#4aa3ff", spin: "#f4efe4",
};
const HANDLE_LABEL: Record<PoseHandle, string> = { east: "E", north: "N", up: "Up", heading: "H", pitch: "P", roll: "R", spin: "" };
const HANDLE_TITLE: Record<PoseHandle, string> = {
  east: "Click to select, then drag to move. Once selected, hold its tip to turn the red and blue arrows.",
  north: "Click to select, then drag to move. Once selected, hold its tip to turn the red and blue arrows.",
  up: "Click to select, then drag to change altitude",
  heading: "Click to select, then drag the ring to change heading",
  pitch: "Click to select, then drag the ring to change pitch",
  roll: "Click to select, then drag the ring to change roll",
  spin: "Slide along the arc to turn the red and blue arrows",
};

export interface PoseEditorHost {
  document: Document;
  canvas: HTMLCanvasElement;
  baseUrl: string;
  sceneUrl(): string | null;
  controller: SceneController;
  overrides: PoseOverrides;
  /** Filename prefix for an export. The default is `foss-earth-poses`. */
  exportPrefix?: string;
  viewer: {
    describeImage?(id: string): { placement: { marker: Vec3 | null } } | null;
    setImageOpacity(id: string | null, opacity: number): void;
  };
  world: {
    posePlacement(id: string): { placement: { marker: Vec3 | null } } | null;
  };
  renderer: {
    cameraFrame(): { eye: Vec3; view: ViewFrame["view"] } | null;
    inspectOrb(id: string): { effectiveRadius: number | null } | null;
  };
  runtime: {
    getPresentationView(): { position: { x: number; y: number; z: number } } | null;
    setPresentedWorldVisible(visible: boolean): void;
    syncPresentedCamera(): boolean;
    requestRender(): void;
  };
  beforeFrame(listener: () => void): () => void;
  afterFrame(listener: () => void): () => void;
  /** How far a press may move and still count as a click, from `input.mouse.dragThreshold`. */
  dragThresholdPx(): number;
  /** The photograph's tab, titled with the photograph's title. Placement is appended at its bottom. */
  tab: HTMLElement;
}

interface Draft {
  longitudeDeg: number;
  latitudeDeg: number;
  headingDeg: number;
  pitchDeg: number;
  rollDeg: number;
  offsetM: number;
  heightMeters: number | null;
  mode: "ground-relative" | "capture-relative";
}

function copyDraft(draft: Draft): Draft {
  return { ...draft };
}

function element<K extends keyof HTMLElementTagNameMap>(document: Document, name: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(name);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svg(document: Document, name: string): SVGElement {
  return document.createElementNS("http://www.w3.org/2000/svg", name);
}

function resetIcon(document: Document): SVGElement {
  const icon = svg(document, "svg");
  icon.setAttribute("viewBox", "0 0 16 16");
  icon.setAttribute("aria-hidden", "true");
  const path = svg(document, "path");
  path.setAttribute("d", "M13.2 8a5.2 5.2 0 1 1-1.4-3.5");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.6");
  path.setAttribute("stroke-linecap", "round");
  const head = svg(document, "path");
  head.setAttribute("d", "M11.6 2.4v3.1H8.5");
  head.setAttribute("fill", "none");
  head.setAttribute("stroke", "currentColor");
  head.setAttribute("stroke-width", "1.6");
  head.setAttribute("stroke-linecap", "round");
  head.setAttribute("stroke-linejoin", "round");
  icon.append(path, head);
  return icon;
}

function fitInput(input: HTMLInputElement): void {
  const chars = Math.max(input.value.length, 1);
  input.style.setProperty("--pose-chars", String(chars));
  input.size = chars;
}

/** Mounts placement at the bottom of the photograph's tab, and the axis gizmo in the view. */
export function mountPoseEditor(host: PoseEditorHost): { dispose(): void } {
  const { document } = host;
  let sessionStorage: Storage | null = null;
  try { sessionStorage = document.defaultView?.sessionStorage ?? null; } catch { /* Editing remains available. */ }
  const editSession = createPoseEditSession(sessionStorage, `foss-earth.pose-edit-session.v1:${document.defaultView?.location.pathname ?? ""}`);
  const panel = element(document, "details", "foss-earth-panel-section pose-editor");
  panel.open = true;
  panel.hidden = true;
  const summary = element(document, "summary", "foss-earth-panel-section__title", "Placement");
  const toggle = element(document, "button", "pose-edit-toggle", "Edit");
  toggle.type = "button";
  toggle.hidden = true;
  toggle.setAttribute("aria-pressed", "false");
  summary.append(toggle);
  const body = element(document, "div", "foss-earth-panel-section__body pose-editor-body");
  const see = element(document, "label", "pose-editor-see");
  see.append(element(document, "span", "", "See through"));
  const opacity = document.createElement("input");
  opacity.type = "range"; opacity.min = "0"; opacity.max = "100"; opacity.step = "1"; opacity.value = "0";
  opacity.setAttribute("aria-label", "See through");
  const opacityReadout = element(document, "span", "", "0%");
  see.append(opacity, opacityReadout);
  const fields = element(document, "div", "pose-editor-fields");
  const altitudeLabel = element(document, "span", "", "Above the ground");
  const inputs = {
    latitudeDeg: field(document, fields, "Capture latitude"),
    longitudeDeg: field(document, fields, "Capture longitude"),
    altitude: field(document, fields, altitudeLabel),
    headingDeg: field(document, fields, "Heading"),
    pitchDeg: field(document, fields, "Pitch"),
    rollDeg: field(document, fields, "Roll"),
  };
  const axisRow = element(document, "div", "pose-editor-field");
  axisRow.append(element(document, "span", "", "Arrow heading"));
  const axisWrap = element(document, "span", "pose-editor-axis");
  const axisInput = document.createElement("input");
  axisInput.type = "number"; axisInput.step = "any";
  axisInput.setAttribute("aria-label", "Heading of the red and blue arrows");
  const axisReset = element(document, "button", "pose-editor-axis-reset");
  axisReset.type = "button";
  axisReset.title = "Reset the red and blue arrows to east and north";
  axisReset.setAttribute("aria-label", "Reset the red and blue arrows to east and north");
  axisReset.append(resetIcon(document));
  axisWrap.append(axisInput, axisReset);
  axisRow.append(axisWrap);
  fields.append(axisRow);
  const AXIS_TREE = [
    { label: "Linear", handles: ["east", "north", "up"] },
    { label: "Rotation", handles: ["heading", "pitch", "roll"] },
  ] as const;
  const AXIS_NAME: Record<Exclude<PoseHandle, "spin">, string> = {
    east: "East", north: "North", up: "Up", heading: "Heading", pitch: "Pitch", roll: "Roll",
  };
  const AXES_KEY = "foss-earth-pose-axes-v1";
  const hidden = new Set<PoseHandle>();
  try {
    const saved: unknown = JSON.parse(document.defaultView?.localStorage.getItem(AXES_KEY) ?? "[]");
    if (Array.isArray(saved)) for (const name of saved) if ((POSE_HANDLES as readonly unknown[]).includes(name)) hidden.add(name as PoseHandle);
  } catch { /* Every axis shows when storage is unavailable. */ }
  const tree = element(document, "div", "pose-editor-axes");
  const treeBoxes: { parent: HTMLInputElement; children: [Exclude<PoseHandle, "spin">, HTMLInputElement][] }[] = [];
  function syncTree(): void {
    for (const { parent, children } of treeBoxes) {
      const shown = children.filter(([handle]) => !hidden.has(handle)).length;
      for (const [handle, box] of children) box.checked = !hidden.has(handle);
      parent.checked = shown === children.length;
      parent.indeterminate = shown > 0 && shown < children.length;
    }
  }
  function setShown(handles: readonly PoseHandle[], shown: boolean): void {
    for (const handle of handles) {
      if (shown) hidden.delete(handle); else hidden.add(handle);
      if (!shown && active === handle) active = null;
    }
    try { document.defaultView?.localStorage.setItem(AXES_KEY, JSON.stringify([...hidden])); } catch { /* kept for this session */ }
    syncTree();
    host.runtime.requestRender();
  }
  for (const branch of AXIS_TREE) {
    const group = element(document, "div", "pose-editor-axes-group");
    const head = element(document, "label", "pose-editor-axes-parent");
    const parent = document.createElement("input");
    parent.type = "checkbox";
    head.append(parent, element(document, "span", "", branch.label));
    const list = element(document, "div", "pose-editor-axes-children");
    const children: [Exclude<PoseHandle, "spin">, HTMLInputElement][] = [];
    for (const handle of branch.handles) {
      const row = element(document, "label", "pose-editor-axes-child");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.addEventListener("change", () => setShown([handle], box.checked));
      row.append(box, element(document, "span", "", AXIS_NAME[handle]));
      list.append(row);
      children.push([handle, box]);
    }
    parent.addEventListener("change", () => setShown(branch.handles, parent.checked));
    group.append(head, list);
    tree.append(group);
    treeBoxes.push({ parent, children });
  }
  syncTree();
  const hint = element(document, "p", "pose-editor-hint", "Click an axis or ring to select it, then drag it: axes move the photograph, rings turn it. Select the red or blue arrow, then press and hold its tip to show the arc that turns those two arrows, and slide without letting go. Inside a photograph, Edit beside Placement turns editing on and off. Click the ground to stop editing. See through loads and shows the map. Hotspot directions and the opening view update after the corrections are imported and the scenes are rebuilt.");
  const offsetHint = element(document, "p", "pose-editor-hint", "");
  const northRow = element(document, "label", "pose-editor-see");
  const north = document.createElement("input");
  north.type = "checkbox";
  north.setAttribute("aria-label", "North checked");
  northRow.append(north, element(document, "span", "", "North checked"));
  const referenceRow = element(document, "label", "pose-editor-field");
  referenceRow.append(element(document, "span", "", "Checked against"));
  const reference = document.createElement("input");
  reference.type = "text";
  reference.className = "pose-editor-reference";
  reference.setAttribute("aria-label", "Checked against");
  referenceRow.append(reference);
  const actions = element(document, "div", "pose-editor-actions");
  const reset = element(document, "button", "pose-editor-reset", "Reset");
  reset.type = "button";
  const save = element(document, "button", "pose-editor-save", "Save place");
  save.type = "button";
  const share = element(document, "button", "pose-editor-export", "Export");
  share.type = "button";
  const download = element(document, "button", "pose-editor-download", "Download");
  download.type = "button";
  const copy = element(document, "button", "pose-editor-copy", "Copy JSON");
  copy.type = "button";
  const clear = element(document, "button", "pose-editor-clear", "Clear saved edits");
  clear.type = "button";
  const undo = element(document, "button", "", "Undo");
  const redo = element(document, "button", "", "Redo");
  undo.type = redo.type = "button";
  actions.append(undo, redo, reset, save, share, download, copy, clear);
  const replace = element(document, "button", "pose-editor-replace", "Replace unreadable saved data");
  replace.type = "button";
  const copyOriginal = element(document, "button", "pose-editor-copy", "Copy original saved text");
  copyOriginal.type = "button";
  const persistent = element(document, "p", "pose-editor-status", "");
  persistent.setAttribute("role", "status");
  const status = element(document, "p", "pose-editor-status", "");
  status.setAttribute("role", "status");
  const exported = element(document, "pre", "pose-editor-export pose-editor-export-text");
  exported.hidden = true;
  body.append(see, tree, fields, northRow, referenceRow, hint, offsetHint, actions, replace, copyOriginal, persistent, status, exported);
  panel.append(summary, body);
  host.tab.append(panel);
  const overlay = svg(document, "svg");
  overlay.classList.add("pose-gizmo");
  overlay.setAttribute("aria-hidden", "true");
  const defs = svg(document, "defs");
  const filter = svg(document, "filter");
  filter.id = "pose-gizmo-shadow";
  const shadow = svg(document, "feDropShadow");
  shadow.setAttribute("dx", "0"); shadow.setAttribute("dy", "0"); shadow.setAttribute("stdDeviation", "1.4");
  shadow.setAttribute("flood-color", "#000"); shadow.setAttribute("flood-opacity", "0.7");
  filter.append(shadow); defs.append(filter);
  const hub = svg(document, "circle");
  hub.classList.add("pose-gizmo-hub"); hub.setAttribute("r", "3");
  const groups = new Map<PoseHandle, { group: SVGElement; hit: SVGElement; line: SVGElement; head: SVGElement; headB: SVGElement; label: SVGElement }>();
  for (const handle of POSE_HANDLES) {
    const group = svg(document, "g");
    group.dataset.handle = handle;
    const hit = svg(document, "path"); hit.classList.add("pose-gizmo-hit");
    const line = svg(document, "path"); line.classList.add("pose-gizmo-line"); line.setAttribute("stroke", HANDLE_COLOR[handle]);
    const head = svg(document, "polygon"); head.classList.add("pose-gizmo-head"); head.setAttribute("fill", HANDLE_COLOR[handle]);
    const headB = svg(document, "polygon"); headB.classList.add("pose-gizmo-head"); headB.setAttribute("fill", HANDLE_COLOR[handle]);
    const label = svg(document, "text"); label.classList.add("pose-gizmo-label"); label.textContent = HANDLE_LABEL[handle];
    const titleNode = svg(document, "title"); titleNode.textContent = HANDLE_TITLE[handle];
    group.append(titleNode, hit, line, head, headB, label);
    groups.set(handle, { group, hit, line, head, headB, label });
    overlay.append(group);
  }
  overlay.prepend(defs); overlay.append(hub);
  overlay.style.display = "none";
  document.body.append(overlay);
  const stop = (event: Event) => event.stopPropagation();

  const opacityOf = new Map<string, number>();
  const undoStack: PoseEditRecord[][] = [];
  const redoStack: PoseEditRecord[][] = [];
  let lastEdits: PoseEditRecord[] = [];
  let replaying = false;
  function editsNow(): PoseEditRecord[] {
    const scene = host.overrides.scene();
    return scene ? [...host.overrides.store.edits(scene.sceneId, scene.sceneUrl)] : [];
  }
  function trackEdit(): void {
    if (drag || replaying) return;
    const next = editsNow();
    if (JSON.stringify(next) === JSON.stringify(lastEdits)) return;
    undoStack.push(lastEdits);
    if (undoStack.length > 100) undoStack.shift();
    redoStack.length = 0;
    lastEdits = next;
  }
  function travelHistory(back: boolean): void {
    if (drag) cancelGestures();
    const source = back ? undoStack : redoStack;
    const target = back ? redoStack : undoStack;
    const next = source.pop();
    if (!next) return;
    target.push(lastEdits);
    replaying = true;
    try { host.overrides.restoreEdits(next); lastEdits = editsNow(); }
    finally { replaying = false; }
    paint();
  }
  undo.addEventListener("click", () => travelHistory(true));
  redo.addEventListener("click", () => travelHistory(false));
  const onHistoryKey = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (!selected || event.altKey || !(event.metaKey || event.ctrlKey)
      || target?.closest?.("input, textarea, select, [contenteditable='true']")) return;
    const key = event.key.toLowerCase();
    if (key !== "z" && !(key === "y" && event.ctrlKey)) return;
    event.preventDefault();
    travelHistory(key === "z" && !event.shiftKey);
  };
  document.addEventListener("keydown", onHistoryKey);
  function opacityKey(): string {
    const scene = host.overrides.scene();
    return `foss-earth-pose-opacity-v1:${JSON.stringify([scene?.sceneId, scene?.sceneUrl])}`;
  }
  function loadOpacity(): void {
    opacityOf.clear();
    try {
      const data: unknown = JSON.parse(document.defaultView?.localStorage.getItem(opacityKey()) ?? "{}");
      if (data && typeof data === "object" && !Array.isArray(data)) {
        for (const [id, value] of Object.entries(data)) {
          if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1) opacityOf.set(id, value);
        }
      }
    } catch { /* Editing remains available when storage is unavailable. */ }
  }
  let sceneKey = "";
  let followed: string | null = null;
  let suspended = false;
  let selected: string | null = null;
  let note = "";
  let saving = false;
  let probe: boolean | null = null;
  let worldVisible = false;
  let gesture = 0;
  let drag: { handle: PoseHandle; pointerId: number; x: number; y: number; startX: number; startY: number; moved: boolean } | null = null;
  /** The axis or ring a click selected. Only it, and the spin arc of a selected red or blue arrow, can be dragged. */
  let active: Exclude<PoseHandle, "spin"> | null = null;
  /** True while a press held on the tip of the selected red or blue arrow shows the arc that turns those arrows. */
  let spinShown = false;
  let holdTimer = 0;
  const spinArm = (): "east" | "north" | null => spinShown && (active === "east" || active === "north") ? active : null;
  function endHold(): void {
    if (holdTimer && view) view.clearTimeout(holdTimer);
    holdTimer = 0;
    if (!spinShown) return;
    spinShown = false;
    host.runtime.requestRender();
  }
  const axisHeadingOf = new Map<string, number>();
  let clearArmedUntil = 0;
  let replaceArmedUntil = 0;
  let confirmToken = 0;
  let arm: { pointerId: number; id: string; x: number; y: number; timer: number } | null = null;
  let suppressMenu = false;
  const view = document.defaultView;

  panel.addEventListener("pointerdown", stop, true);
  panel.addEventListener("wheel", stop, true);

  function field(owner: Document, form: HTMLElement, label: string | HTMLElement): HTMLInputElement {
    const row = element(owner, "label", "pose-editor-field");
    row.append(typeof label === "string" ? element(owner, "span", "", label) : label);
    const input = owner.createElement("input");
    input.type = "number"; input.step = "any";
    row.append(input); form.append(row);
    return input;
  }

  function currentDraft(): Draft | null {
    if (!selected) return null;
    const base = host.overrides.baseline(selected);
    if (!base) return null;
    const edit = host.overrides.record(selected);
    if (!edit) {
      return {
        longitudeDeg: base.longitudeDeg, latitudeDeg: base.latitudeDeg, headingDeg: base.headingDeg,
        pitchDeg: base.pitchDeg, rollDeg: base.rollDeg, offsetM: base.offsetM, heightMeters: base.heightMeters, mode: base.mode,
      };
    }
    return {
      longitudeDeg: edit.capture.longitudeDeg, latitudeDeg: edit.capture.latitudeDeg,
      headingDeg: edit.imagePose.headingDeg, pitchDeg: edit.imagePose.pitchDeg, rollDeg: edit.imagePose.rollDeg,
      offsetM: edit.marker.offsetM, heightMeters: edit.capture.heightMeters, mode: edit.mode,
    };
  }

  function desiredOf(draft: Draft): DesiredNumbers {
    return {
      mode: draft.mode, longitudeDeg: draft.longitudeDeg, latitudeDeg: draft.latitudeDeg, heightMeters: draft.heightMeters,
      headingDeg: draft.headingDeg, pitchDeg: draft.pitchDeg, rollDeg: draft.rollDeg, offsetM: draft.offsetM,
    };
  }

  function opacityFor(id: string): number {
    return opacityOf.get(id) ?? 1;
  }

  function showWorld(visible: boolean): void {
    if (visible === worldVisible) return;
    worldVisible = visible;
    host.runtime.setPresentedWorldVisible(visible);
  }

  function editingHere(scene: SceneStatus | null): boolean {
    if (!selected || !scene) return false;
    return scene.phase === "overview" || (scene.phase === "immersive" && scene.active === selected);
  }

  function syncOpacity(): void {
    const scene = host.controller.state().status;
    const inside = scene?.phase === "immersive" && scene.active === selected;
    if (!selected || !editingHere(scene)) {
      host.viewer.setImageOpacity(null, 1);
      showWorld(false);
      return;
    }
    const value = opacityFor(selected);
    host.viewer.setImageOpacity(selected, value);
    showWorld(Boolean(inside && value < 0.999));
    if (inside) host.runtime.syncPresentedCamera();
  }

  function writeFields(draft: Draft | null): void {
    const active = document.activeElement;
    const write = (input: HTMLInputElement, text: string) => {
      if (active !== input) input.value = text;
      fitInput(input);
    };
    inputs.latitudeDeg.disabled = !draft;
    inputs.longitudeDeg.disabled = !draft;
    inputs.altitude.disabled = !draft;
    inputs.headingDeg.disabled = !draft;
    inputs.pitchDeg.disabled = !draft;
    inputs.rollDeg.disabled = !draft;
    axisInput.disabled = !draft;
    const arrowHeading = axisHeading();
    const arrowTurn = Math.min(arrowHeading, 360 - arrowHeading);
    axisReset.disabled = !draft || arrowTurn < 1e-3;
    write(axisInput, draft ? arrowHeading.toFixed(3) : "");
    if (!draft) {
      for (const input of Object.values(inputs)) write(input, "");
      return;
    }
    altitudeLabel.textContent = draft.mode === "ground-relative" ? "Above the ground" : "Above the ellipsoid";
    write(inputs.latitudeDeg, draft.latitudeDeg.toFixed(6));
    write(inputs.longitudeDeg, draft.longitudeDeg.toFixed(6));
    write(inputs.altitude, draft.mode === "ground-relative" ? draft.offsetM.toFixed(2) : draft.heightMeters === null ? "" : draft.heightMeters.toFixed(2));
    write(inputs.headingDeg, draft.headingDeg.toFixed(3));
    write(inputs.pitchDeg, draft.pitchDeg.toFixed(3));
    write(inputs.rollDeg, draft.rollDeg.toFixed(3));
  }

  function cancelConfirmations(): void {
    confirmToken += 1;
    clearArmedUntil = 0;
    replaceArmedUntil = 0;
  }

  function armExpiry(): void {
    const token = confirmToken;
    view?.setTimeout(() => {
      if (token !== confirmToken) return;
      clearArmedUntil = 0;
      replaceArmedUntil = 0;
      paint();
    }, CONFIRM_MS);
  }

  function cancelArm(): void {
    if (arm && view) view.clearTimeout(arm.timer);
    arm = null;
  }

  function cancelGestures(): void {
    gesture += 1;
    const wasDragging = Boolean(drag);
    drag = null;
    endHold();
    if (wasDragging) trackEdit();
    cancelArm();
  }

  function thresholdPx(): number {
    const threshold = host.dragThresholdPx();
    return Number.isFinite(threshold) && threshold >= 0 ? threshold : 4;
  }

  function paint(): void {
    const scene = host.controller.state().status;
    const draft = currentDraft();
    const record = selected ? host.overrides.record(selected) : null;
    const baseline = selected ? host.overrides.baseline(selected) : null;
    const file = sceneFile();
    const showing = Boolean(selected && editingHere(scene));
    if (showing && !panel.open) panel.scrollIntoView?.({ block: "nearest" });
    panel.hidden = false;
    panel.open = showing || host.overrides.counts().scene > 0;
    const percent = Math.round((selected ? opacityFor(selected) : 1) * 100);
    if (document.activeElement !== opacity) opacity.value = String(100 - percent);
    opacityReadout.textContent = `${100 - percent}%`;
    opacity.disabled = !draft;
    undo.disabled = undoStack.length === 0;
    redo.disabled = redoStack.length === 0;
    writeFields(draft);
    const counts = host.overrides.counts();
    const storeStatus = host.overrides.status();
    const now = Date.now();
    reset.disabled = !record || saving;
    save.hidden = !file;
    save.disabled = !record || saving || probe !== true || !file;
    share.disabled = counts.all === 0;
    download.disabled = counts.all === 0;
    copy.disabled = counts.all === 0;
    clear.disabled = counts.scene === 0;
    clear.textContent = now < clearArmedUntil ? `Clear ${counts.scene} edits for this scene` : `Clear saved edits (${counts.scene})`;
    replace.hidden = !storeStatus.canReplaceSaved;
    replace.textContent = now < replaceArmedUntil ? "Discard unreadable records and replace them" : "Replace unreadable saved data";
    copyOriginal.hidden = !storeStatus.originalText;
    north.disabled = !draft;
    reference.disabled = !draft;
    if (document.activeElement !== north) north.checked = record ? record.imagePose.aligned : baseline?.aligned === true;
    if (document.activeElement !== reference) reference.value = record?.verification.orientation?.checkedAgainst ?? "";
    const east = Math.abs(baseline?.eastM ?? 0);
    const northOffset = Math.abs(baseline?.northM ?? 0);
    offsetHint.hidden = !draft || (east < 1e-3 && northOffset < 1e-3);
    offsetHint.textContent = "The marker's east and north are display offsets. Capture longitude and latitude above are the photograph's place.";
    const lines = [...storeStatus.messages];
    if (counts.all > 0) lines.unshift(`${counts.all} saved edit${counts.all === 1 ? "" : "s"} in this browser.`);
    persistent.textContent = lines.join(" ");
    if (note) status.textContent = note;
    else if (file && probe === true) status.textContent = record ? "Save place writes this local scene file. Export keeps a copy you can take with you." : "Save place writes a local scene file. Export keeps edits from every scene.";
    else if (counts.all > 0) status.textContent = "Export keeps a copy of these edits. Keep that file as a backup.";
    else status.textContent = "";
    const inside = scene?.phase === "immersive" && scene.active ? scene.active : null;
    toggle.hidden = !inside || !host.overrides.baseline(inside);
    const on = Boolean(inside && selected === inside);
    toggle.textContent = on ? "Done editing" : "Edit";
    toggle.setAttribute("aria-pressed", String(on));
    toggle.classList.toggle("is-on", on);
    publishEditTab();
  }

  function publishEditTab(): void {
    if (!selected) { setPoseEditTitle(null); return; }
    const entry = host.controller.state().status?.entries.find(item => item.id === selected);
    setPoseEditTitle(entry?.title ?? null);
  }

  function stopEdit(): void {
    if (!selected && !suspended) return;
    cancelGestures();
    cancelConfirmations();
    suspended = true;
    selected = null;
    const scene = host.overrides.scene();
    if (scene) editSession.select(scene, null);
    active = null;
    note = "";
    syncOpacity();
    paint();
  }

  function armPhoto(id: string): void {
    if (!host.overrides.baseline(id)) return;
    cancelConfirmations();
    if (selected !== id) active = null;
    suspended = false;
    selected = id;
    const scene = host.overrides.scene();
    if (scene) editSession.select(scene, id);
    note = "";
    syncOpacity();
    paint();
  }

  function axisHeading(): number {
    return selected ? axisHeadingOf.get(selected) ?? 0 : 0;
  }

  function syncFromHost(): void {
    const scene = host.controller.state().status;
    const identity = host.overrides.scene();
    const key = identity ? `${identity.sceneId}\n${identity.sceneUrl}\n${identity.revision}` : "";
    if (key !== sceneKey) {
      cancelGestures();
      cancelConfirmations();
      loadOpacity();
      undoStack.length = redoStack.length = 0;
      lastEdits = editsNow();
      axisHeadingOf.clear();
      selected = null;
      suspended = false;
      followed = null;
      sceneKey = key;
      active = null;
      note = "";
    }
    const inside = scene?.phase === "immersive" ? scene.active : null;
    if (inside !== followed) {
      cancelGestures();
      if (followed) axisHeadingOf.delete(followed);
      host.viewer.setImageOpacity(null, 1);
      followed = inside;
      if (selected && selected !== inside) {
        // Entering a photograph starts with editing off; the Edit button turns it on.
        selected = null;
        active = null;
        note = "";
      }
      suspended = Boolean(inside);
    }
    if (inside && !selected && identity && editSession.selected(identity) === inside && host.overrides.baseline(inside)) {
      selected = inside;
      suspended = false;
    }
  }

  function sceneFile(): string | null {
    const url = host.sceneUrl();
    return url ? scenePublicPath(url, host.baseUrl) : null;
  }

  function frameOf(phase: SceneStatus["phase"]): ViewFrame | null {
    const camera = host.renderer.cameraFrame();
    if (!camera) return null;
    const presented = phase === "immersive" ? host.runtime.getPresentationView() : null;
    const eye = presented ? [presented.position.x, presented.position.y, presented.position.z] as Vec3 : camera.eye;
    return { eye, view: camera.view };
  }

  function anchorOf(phase: SceneStatus["phase"], frame: ViewFrame): Vec3 | null {
    if (phase === "immersive") return insideGizmoAnchor(frame.eye, frame.view.forward);
    if (phase !== "overview" || !selected) return null;
    return host.viewer.describeImage?.(selected)?.placement.marker ?? host.world.posePlacement(selected)?.placement.marker ?? null;
  }

  function draw(): void {
    const scene = host.controller.state().status;
    const draft = currentDraft();
    const phase = scene?.phase ?? "overview";
    const editing = editingHere(scene);
    const frame = editing && draft ? frameOf(phase) : null;
    const anchor = frame && draft ? anchorOf(phase, frame) : null;
    overlay.style.display = frame && anchor && draft ? "" : "none";
    if (!frame || !anchor || !draft) return;
    const rect = worldViewportClientRect(host.canvas);
    const enu = enuFrame(draft.longitudeDeg, draft.latitudeDeg);
    const distance = length(sub(anchor, frame.eye));
    const orbRadius = phase === "overview" && selected ? host.renderer.inspectOrb(selected)?.effectiveRadius ?? 0 : 0;
    const arm = gizmoArmMeters(distance, frame.view.verticalFovRad, rect.height, 72, orbRadius);
    const heading = axisHeading();
    const lines = gizmoPolylines(anchor, enu.east, enu.north, enu.up, arm, frame.eye, heading, orbRadius);
    const spinning = spinArm();
    if (spinning) {
      const turned = rotateHeading(enu.east, enu.north, heading);
      const direction = spinning === "east" ? turned.east : turned.north;
      lines.push(axisSpin(anchor, direction, enu.up, arm));
    }
    const box = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    const hubPoint = projectPoint(frame, anchor, box);
    if (hubPoint) { hub.setAttribute("cx", hubPoint.x.toFixed(1)); hub.setAttribute("cy", hubPoint.y.toFixed(1)); }
    hub.style.display = hubPoint && orbRadius === 0 ? "" : "none";
    const drawn = new Map(lines.map(line => [line.handle, line]));
    for (const handle of POSE_HANDLES) {
      const group = groups.get(handle);
      const line = drawn.get(handle);
      if (!group) continue;
      if (!line || hidden.has(handle) || (handle === "spin" && hidden.has(spinning ?? "spin"))) { group.group.style.display = "none"; continue; }
      const path = traced(line.points, line.closed, frame, box);
      const head = line.head ? polygon(line.head, frame, box) : null;
      const headB = line.headB ? polygon(line.headB, frame, box) : null;
      const labelAt = HANDLE_LABEL[handle] ? projectPoint(frame, line.label, box) : null;
      group.group.style.display = path ? "" : "none";
      if (!path) continue;
      group.group.classList.toggle("is-selected", handle === active || (handle === "spin" && Boolean(spinning)));
      group.group.classList.toggle("is-idle", Boolean(active) && handle !== active && handle !== "spin");
      if (handle === "spin" && spinning) {
        const color = HANDLE_COLOR[spinning];
        group.line.setAttribute("stroke", color);
        group.head.setAttribute("fill", color);
        group.headB.setAttribute("fill", color);
      }
      group.hit.setAttribute("d", path);
      group.line.setAttribute("d", path);
      if (head) group.head.setAttribute("points", head);
      group.head.style.display = head ? "" : "none";
      if (headB) group.headB.setAttribute("points", headB);
      group.headB.style.display = headB ? "" : "none";
      if (labelAt) { group.label.setAttribute("x", (labelAt.x + 6).toFixed(1)); group.label.setAttribute("y", (labelAt.y - 6).toFixed(1)); }
      group.label.style.display = labelAt ? "" : "none";
    }
  }

  function polygon(points: readonly Vec3[], frame: ViewFrame, rect: { left: number; top: number; width: number; height: number }): string | null {
    const projected = points.map(point => projectPoint(frame, point, rect));
    if (projected.some(point => !point)) return null;
    return projected.map(point => `${point!.x.toFixed(1)},${point!.y.toFixed(1)}`).join(" ");
  }

  function traced(points: readonly Vec3[], closed: boolean, frame: ViewFrame, rect: { left: number; top: number; width: number; height: number }): string | null {
    const projected = points.map(point => projectPoint(frame, point, rect));
    if (projected.some(point => !point)) return null;
    const commands = projected.map((point, index) => `${index === 0 ? "M" : "L"}${point!.x.toFixed(1)} ${point!.y.toFixed(1)}`);
    if (closed) commands.push("Z");
    return commands.join(" ");
  }

  function nudge(handle: PoseHandle, fromX: number, fromY: number, toX: number, toY: number): void {
    const draft = currentDraft();
    const scene = host.controller.state().status;
    if (!draft || !selected || !scene) return;
    const token = gesture;
    const id = selected;
    const frame = frameOf(scene.phase);
    const anchor = frame ? anchorOf(scene.phase, frame) : null;
    if (!frame || !anchor) return;
    const rect = worldViewportClientRect(host.canvas);
    const rayAt = (x: number, y: number) => viewRay(frame, (x - rect.left) / Math.max(1, rect.width), (y - rect.top) / Math.max(1, rect.height));
    const enu = enuFrame(draft.longitudeDeg, draft.latitudeDeg);
    const turned = rotateHeading(enu.east, enu.north, axisHeading());
    const axis = handle === "east" ? turned.east : handle === "north" ? turned.north : enu.up;
    if (handle === "spin") {
      if (!spinArm()) return;
      const hub = projectPoint(frame, anchor, { left: rect.left, top: rect.top, width: rect.width, height: rect.height });
      const turn = hub ? screenTurnDeg(hub.x, hub.y, fromX, fromY, toX, toY) : null;
      if (turn === null || Math.abs(turn) > 40) return;
      const delta = ringScreenDragDeg("heading", dot(enu.up, sub(frame.eye, anchor)), turn);
      axisHeadingOf.set(selected, wrapHeading(axisHeading() + delta));
      paint();
      host.runtime.requestRender();
      return;
    }
    const next = copyDraft(draft);
    if (handle === "east" || handle === "north" || handle === "up") {
      const start = axisTravel(frame.eye, rayAt(fromX, fromY), anchor, axis);
      const end = axisTravel(frame.eye, rayAt(toX, toY), anchor, axis);
      if (start === null || end === null || Math.abs(end - start) > 5000) return;
      const delta = end - start;
      if (handle === "up") {
        if (next.mode === "ground-relative") next.offsetM += delta;
        else next.heightMeters = (next.heightMeters ?? 0) + delta;
      } else {
        const shift = axisShift(axisHeading(), handle, delta);
        const shifted = shiftCapture(next.longitudeDeg, next.latitudeDeg, shift.eastMeters, shift.northMeters);
        next.longitudeDeg = shifted.longitudeDeg; next.latitudeDeg = shifted.latitudeDeg;
      }
    } else {
      const hub = projectPoint(frame, anchor, { left: rect.left, top: rect.top, width: rect.width, height: rect.height });
      const turn = hub ? screenTurnDeg(hub.x, hub.y, fromX, fromY, toX, toY) : null;
      if (turn === null || Math.abs(turn) > 40) return;
      const around = handle === "heading" ? enu.up : handle === "pitch" ? enu.east : enu.north;
      const delta = ringScreenDragDeg(handle, dot(around, sub(frame.eye, anchor)), turn);
      if (handle === "heading") next.headingDeg = wrapHeading(next.headingDeg + delta);
      else if (handle === "pitch") next.pitchDeg = clampPitch(next.pitchDeg + delta);
      else next.rollDeg = wrapRoll(next.rollDeg + delta);
    }
    if (gesture !== token || selected !== id) return;
    note = "";
    host.overrides.setNumbers(id, desiredOf(next));
    paint();
  }

  function commitNumber(key: "latitudeDeg" | "longitudeDeg" | "headingDeg" | "pitchDeg" | "rollDeg" | "altitude"): boolean {
    const draft = currentDraft();
    if (!draft || !selected) return true;
    const input = inputs[key];
    const text = input.value.trim();
    const value = Number(text);
    if (!text || !Number.isFinite(value)) { note = "Enter a number."; paint(); return false; }
    const next = copyDraft(draft);
    if (key === "latitudeDeg") next.latitudeDeg = clampLatitude(value);
    else if (key === "longitudeDeg") next.longitudeDeg = wrapLongitude(value);
    else if (key === "headingDeg") next.headingDeg = wrapHeading(value);
    else if (key === "pitchDeg") next.pitchDeg = clampPitch(value);
    else if (key === "rollDeg") next.rollDeg = wrapRoll(value);
    else if (next.mode === "ground-relative") next.offsetM = value;
    else next.heightMeters = value;
    note = "";
    host.overrides.setNumbers(selected, desiredOf(next));
    host.overrides.flush();
    paint();
    return true;
  }

  function commitAxis(): boolean {
    if (!selected) return true;
    const text = axisInput.value.trim();
    const value = Number(text);
    if (!text || !Number.isFinite(value)) { note = "Enter a number."; paint(); return false; }
    axisHeadingOf.set(selected, wrapHeading(value));
    paint();
    host.runtime.requestRender();
    return true;
  }

  function commitReference(): boolean {
    if (!selected || !north.checked) return true;
    const against = reference.value.trim();
    if (!against) { note = "Enter what you checked north against."; paint(); return false; }
    const record = host.overrides.record(selected);
    if (record?.verification.orientation) host.overrides.setReference(selected, against);
    else host.overrides.confirm(selected, against);
    return true;
  }

  function commitFocused(): boolean {
    const active = document.activeElement;
    if (active === axisInput) return commitAxis();
    if (active === reference) return commitReference();
    for (const key of ["latitudeDeg", "longitudeDeg", "headingDeg", "pitchDeg", "rollDeg", "altitude"] as const) {
      if (active === inputs[key]) return commitNumber(key);
    }
    return true;
  }

  function preparedExport(): { text: string; filename: string; disclosures: readonly string[] } | null {
    cancelConfirmations();
    if (!commitFocused()) return null;
    host.overrides.flush();
    const iso = new Date().toISOString();
    const exportedDocument = host.overrides.exportDocument(iso);
    return {
      text: exportedDocument.text,
      disclosures: exportedDocument.disclosures,
      filename: poseExportFilename(host.exportPrefix ?? DEFAULT_POSE_EXPORT_PREFIX, iso),
    };
  }

  function showText(text: string, message: string): void {
    exported.hidden = false;
    exported.textContent = text;
    note = message;
    paint();
  }

  for (const key of ["latitudeDeg", "longitudeDeg", "headingDeg", "pitchDeg", "rollDeg", "altitude"] as const) {
    inputs[key].addEventListener("change", () => commitNumber(key));
    inputs[key].addEventListener("input", () => fitInput(inputs[key]));
  }
  axisInput.addEventListener("input", () => fitInput(axisInput));
  axisInput.addEventListener("change", () => { commitAxis(); });
  axisReset.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!selected) return;
    cancelConfirmations();
    axisHeadingOf.set(selected, 0);
    paint();
    host.runtime.requestRender();
  });
  opacity.addEventListener("input", () => {
    if (!selected) return;
    cancelConfirmations();
    opacityOf.set(selected, 1 - Number(opacity.value) / 100);
    try { view?.localStorage.setItem(opacityKey(), JSON.stringify(Object.fromEntries(opacityOf))); }
    catch { note = "See-through is saved for this session only because browser storage is unavailable."; syncOpacity(); paint(); return; }
    note = ""; syncOpacity(); paint();
  });
  north.addEventListener("change", () => {
    if (!selected) return;
    cancelConfirmations();
    if (north.checked) {
      const against = reference.value.trim();
      if (!against) { note = "Enter what you checked north against."; paint(); return; }
      host.overrides.confirm(selected, against);
      note = "North checked against the reference you entered.";
    } else {
      host.overrides.unconfirm(selected);
      note = "North is not checked for this edit.";
    }
    paint();
  });
  reference.addEventListener("change", () => { commitReference(); paint(); });
  reset.addEventListener("click", () => {
    if (!commitFocused() || !selected) return;
    cancelConfirmations();
    host.overrides.reset(selected);
    const persistence = host.overrides.status().persistence;
    note = persistence === "blocked" || persistence === "foreign"
      ? "Reset in this session. Persistence is blocked, so the saved edit may return on reload."
      : "Reset to the published place.";
    paint();
  });
  save.addEventListener("click", () => {
    if (!commitFocused()) return;
    const draft = currentDraft();
    const file = sceneFile();
    if (!draft || !selected || !file || probe !== true) return;
    cancelConfirmations();
    saving = true; paint();
    const body: Record<string, unknown> = {
      file, entityId: selected, longitudeDeg: wrapLongitude(draft.longitudeDeg), latitudeDeg: clampLatitude(draft.latitudeDeg),
      headingDeg: wrapHeading(draft.headingDeg), pitchDeg: clampPitch(draft.pitchDeg), rollDeg: wrapRoll(draft.rollDeg), offsetM: draft.offsetM,
    };
    if (draft.mode === "capture-relative" && draft.heightMeters !== null) body.heightMeters = draft.heightMeters;
    const id = selected;
    void fetch(new URL(SAVE_URL, window.location.origin), {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }).then(async response => {
      const payload = await response.json() as { ok?: boolean; error?: string };
      note = payload.ok ? "Saved into the scene file. Reload to update the status bar." : (payload.error ?? "The place could not be saved.");
      if (payload.ok) host.overrides.noteFileSaved(id);
    }).catch(() => { note = "The place could not be saved."; }).finally(() => { saving = false; paint(); });
  });
  share.addEventListener("click", () => {
    const prepared = preparedExport();
    if (!prepared) return;
    const file = new File([prepared.text], prepared.filename, { type: "application/json" });
    const nav = view?.navigator;
    const canShare = Boolean(nav && typeof nav.canShare === "function" && nav.canShare({ files: [file] }) && nav.share);
    if (!canShare || !nav?.share) {
      note = "Sharing is not available here. Use Download or Copy, and keep a backup.";
      paint();
      return;
    }
    void nav.share({ files: [file], title: prepared.filename }).then(() => {
      note = `Shared ${prepared.filename}. Keep the exported file as a backup.`;
      paint();
    }, (error: unknown) => {
      note = error instanceof DOMException && error.name === "AbortError"
        ? "Share cancelled. The edits are still here."
        : "Share failed. Use Download or Copy, and keep a backup.";
      paint();
    });
  });
  download.addEventListener("click", () => {
    const prepared = preparedExport();
    if (!prepared || !view) return;
    const blob = new Blob([prepared.text], { type: "application/json" });
    const url = view.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = prepared.filename; link.hidden = true;
    document.body.append(link); link.click(); link.remove();
    view.setTimeout(() => view.URL.revokeObjectURL(url), 1500);
    exported.hidden = true;
    const extra = prepared.disclosures.length ? ` ${prepared.disclosures.join(" ")}` : "";
    note = `Download requested for ${prepared.filename}. Keep the exported file as a backup.${extra}`;
    paint();
  });
  copy.addEventListener("click", () => {
    const prepared = preparedExport();
    if (!prepared) return;
    const write = view?.navigator.clipboard?.writeText(prepared.text);
    if (!write) { showText(prepared.text, `Copy failed. Select the JSON below and keep ${prepared.filename} as a backup.`); return; }
    void write.then(() => {
      exported.hidden = true;
      note = `Copied ${prepared.filename}. Keep the exported file as a backup.`;
      paint();
    }, () => showText(prepared.text, `Copy failed. Select the JSON below and keep ${prepared.filename} as a backup.`));
  });
  clear.addEventListener("click", () => {
    if (!commitFocused()) return;
    const now = Date.now();
    if (now >= clearArmedUntil) {
      replaceArmedUntil = 0;
      confirmToken += 1;
      clearArmedUntil = now + CONFIRM_MS;
      armExpiry();
      note = "Tap Clear again to remove this scene's saved edits. Other scenes stay.";
      paint();
      return;
    }
    clearArmedUntil = 0;
    const result = host.overrides.clearScene();
    note = result.blocked
      ? "Cleared this scene in this session. Persistence is still blocked, so this may not last past a reload."
      : "Cleared this scene's saved edits.";
    paint();
  });
  replace.addEventListener("click", () => {
    if (!commitFocused()) return;
    const now = Date.now();
    if (now >= replaceArmedUntil) {
      clearArmedUntil = 0;
      confirmToken += 1;
      replaceArmedUntil = now + CONFIRM_MS;
      armExpiry();
      note = "This replaces the unreadable saved text with the edits in this session. Unreadable records are discarded. Copy the original first if you need it.";
      paint();
      return;
    }
    replaceArmedUntil = 0;
    const result = host.overrides.replaceSaved();
    note = result.ok ? "Replaced the unreadable saved data with this session's edits." : result.message;
    paint();
  });
  copyOriginal.addEventListener("click", () => {
    const text = host.overrides.status().originalText;
    if (!text) return;
    const write = view?.navigator.clipboard?.writeText(text);
    if (!write) { showText(text, "Copy failed. The original saved text is below."); return; }
    void write.then(() => { note = "Copied the original saved text."; paint(); }, () => showText(text, "Copy failed. The original saved text is below."));
  });

  overlay.addEventListener("pointerdown", event => {
    if (!(event instanceof PointerEvent)) return;
    if (drag && event.pointerId !== drag.pointerId) { event.preventDefault(); event.stopPropagation(); return; }
    const handle = (event.target as Element | null)?.closest?.("[data-handle]")?.getAttribute("data-handle");
    if (!handle || !(POSE_HANDLES as readonly string[]).includes(handle)) return;
    event.preventDefault(); event.stopPropagation();
    try { (event.currentTarget as Element).setPointerCapture(event.pointerId); } catch { /* capture is optional; the drag still tracks the pointer */ }
    // A press on a handle that is not selected only selects it, on release.
    drag = { handle: handle as PoseHandle, pointerId: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false };
    // Holding the tip of the selected red or blue arrow shows the arc, and the same press then turns the arrows.
    const tip = (event.target as Element | null)?.closest?.(".pose-gizmo-head");
    if (tip && handle === active && (handle === "east" || handle === "north") && view) {
      const pointerId = event.pointerId;
      holdTimer = view.setTimeout(() => {
        holdTimer = 0;
        if (!drag || drag.pointerId !== pointerId || drag.moved) return;
        spinShown = true;
        drag = { ...drag, handle: "spin" };
        host.runtime.requestRender();
      }, LONG_PRESS_MS);
    }
  }, true);
  overlay.addEventListener("pointermove", event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= thresholdPx()) {
      drag.moved = true;
      if (holdTimer && view) { view.clearTimeout(holdTimer); holdTimer = 0; }
    }
    if (!drag.moved || !draggable(drag.handle)) return;
    const from = drag;
    nudge(from.handle, from.x, from.y, event.clientX, event.clientY);
    drag = { ...from, x: event.clientX, y: event.clientY };
  });
  const endDrag = (event: PointerEvent, cancelled: boolean) => {
    if (drag?.pointerId !== event.pointerId) return;
    const finished = drag;
    drag = null;
    endHold();
    trackEdit();
    host.overrides.flush();
    if (cancelled || event.type !== "pointerup" || finished.moved || finished.handle === "spin") return;
    active = active === finished.handle ? null : finished.handle;
    host.runtime.requestRender();
  };
  function draggable(handle: PoseHandle): boolean {
    if (hidden.has(handle)) return false;
    return handle === "spin" ? Boolean(spinArm()) : handle === active;
  }
  overlay.addEventListener("pointerup", event => endDrag(event, false));
  overlay.addEventListener("pointercancel", event => endDrag(event, true));
  overlay.addEventListener("lostpointercapture", event => endDrag(event, true));
  let rightPress: { x: number; y: number; moved: boolean } | null = null;
  let primaryPress: { x: number; y: number; moved: boolean } | null = null;
  const markMoved = (press: { x: number; y: number; moved: boolean } | null, event: PointerEvent) => {
    if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) >= thresholdPx()) press.moved = true;
  };
  const onPointerDown = (event: PointerEvent) => {
    if (arm && event.pointerId !== arm.pointerId) { cancelArm(); return; }
    if (event.pointerType === "mouse") {
      if (event.button === 2) rightPress = { x: event.clientX, y: event.clientY, moved: false };
      if (event.button === 0) primaryPress = { x: event.clientX, y: event.clientY, moved: false };
      return;
    }
    if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
    if (!event.isPrimary) return;
    const scene = host.controller.state().status;
    if (!scene || scene.phase !== "overview") return;
    const [id] = host.controller.handle()?.pick(event.clientX, event.clientY) ?? [];
    if (!id || !host.overrides.baseline(id)) return;
    const pointerId = event.pointerId;
    const timer = view?.setTimeout(() => {
      if (!arm || arm.pointerId !== pointerId) return;
      host.controller.consumePointerPress(pointerId);
      arm = null;
      suppressMenu = true;
      armPhoto(id);
    }, LONG_PRESS_MS) ?? 0;
    arm = { pointerId, id, x: event.clientX, y: event.clientY, timer };
  };
  const onPointerMove = (event: PointerEvent) => {
    if ((event.buttons & 2) !== 0) markMoved(rightPress, event);
    if ((event.buttons & 1) !== 0) markMoved(primaryPress, event);
    if (arm && event.pointerId === arm.pointerId && Math.hypot(event.clientX - arm.x, event.clientY - arm.y) >= thresholdPx()) cancelArm();
  };
  const onPrimaryUp = (event: PointerEvent) => {
    if (arm?.pointerId === event.pointerId) cancelArm();
    if (event.button !== 0 || event.pointerType !== "mouse") return;
    const press = primaryPress;
    primaryPress = null;
    if (!press || press.moved || !selected) return;
    const scene = host.controller.state().status;
    if (!scene || scene.phase !== "overview") return;
    const [id] = host.controller.handle()?.pick(event.clientX, event.clientY) ?? [];
    if (id === selected) return;
    stopEdit();
  };
  const onContextMenu = (event: MouseEvent) => {
    if (suppressMenu) { suppressMenu = false; event.preventDefault(); return; }
    const moved = rightPress?.moved ?? false;
    rightPress = null;
    const pointerType = "pointerType" in event ? event.pointerType : "";
    if (moved || pointerType === "touch" || pointerType === "pen") return;
    const scene = host.controller.state().status;
    if (!scene || scene.phase !== "overview") return;
    const [id] = host.controller.handle()?.pick(event.clientX, event.clientY) ?? [];
    if (!id || !host.overrides.baseline(id)) return;
    event.preventDefault();
    armPhoto(id);
  };
  toggle.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    const scene = host.controller.state().status;
    const inside = scene?.phase === "immersive" ? scene.active : null;
    if (!inside) return;
    if (selected === inside) stopEdit();
    else armPhoto(inside);
  });
  const unbindStop = bindPoseEditStop(stopEdit);
  const onPointerCancel = (event: PointerEvent) => {
    primaryPress = null;
    if (!event.pointerId || arm?.pointerId === event.pointerId) cancelArm();
  };
  const onLostCapture = (event: PointerEvent) => {
    if (arm?.pointerId === event.pointerId) cancelArm();
  };
  host.canvas.addEventListener("pointerdown", onPointerDown, true);
  host.canvas.addEventListener("pointermove", onPointerMove, true);
  host.canvas.addEventListener("pointerup", onPrimaryUp);
  host.canvas.addEventListener("pointercancel", onPointerCancel);
  host.canvas.addEventListener("lostpointercapture", onLostCapture);
  host.canvas.addEventListener("contextmenu", onContextMenu);

  const offStatus = host.controller.subscribe(() => {
    syncFromHost();
    syncOpacity();
    paint();
  });
  const offOverrides = host.overrides.subscribe(() => { syncFromHost(); trackEdit(); syncOpacity(); paint(); });
  const offTransition = host.overrides.onTransition(() => { cancelGestures(); cancelConfirmations(); });
  const offBefore = host.beforeFrame(() => {
    const phase = host.controller.state().status?.phase;
    if (phase === "immersive" && worldVisible) host.runtime.syncPresentedCamera();
  });
  const offAfter = host.afterFrame(draw);
  const flushDraft = () => { commitFocused(); host.overrides.flush(); };
  const onHide = () => { if (document.hidden) flushDraft(); };
  view?.addEventListener("pagehide", flushDraft);
  document.addEventListener("visibilitychange", onHide);
  void fetch(new URL(SAVE_URL, window.location.origin)).then(response => { probe = response.ok; paint(); }, () => { probe = false; paint(); });

  return {
    dispose() {
      flushDraft();
      cancelGestures();
      view?.removeEventListener("pagehide", flushDraft);
      document.removeEventListener("visibilitychange", onHide);
      document.removeEventListener("keydown", onHistoryKey);
      offStatus(); offOverrides(); offTransition(); offBefore(); offAfter(); unbindStop();
      host.canvas.removeEventListener("pointerdown", onPointerDown, true);
      host.canvas.removeEventListener("pointermove", onPointerMove, true);
      host.canvas.removeEventListener("pointerup", onPrimaryUp);
      host.canvas.removeEventListener("pointercancel", onPointerCancel);
      host.canvas.removeEventListener("lostpointercapture", onLostCapture);
      host.canvas.removeEventListener("contextmenu", onContextMenu);
      selected = null; setPoseEditTitle(null);
      showWorld(false);
      host.viewer.setImageOpacity(null, 1);
      panel.remove(); overlay.remove(); toggle.remove();
    },
  };
}
