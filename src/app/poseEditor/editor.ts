/** Local-only gizmo for placing a photograph. The dev server loads it; the published site does not. */
import { dot, enuFrame, length, sub, type Vec3 } from "@foss-earth/engine";
import { worldViewportClientRect } from "@foss-earth/engine/browser";
import type { SceneController, SceneEntryStatus, ScenePlacement, SceneStatus } from "@foss-earth/scenes/browser";
import type { SpherePoseEdit } from "../sceneWorld";
import "./pose-editor.css";
import {
  POSE_HANDLES, axisShift, axisSpin, axisTravel, clampLatitude, clampPitch, gizmoArmMeters, gizmoPolylines, insideGizmoAnchor,
  projectPoint, ringScreenDragDeg, rotateHeading, screenTurnDeg, shiftCapture, viewRay, wrapHeading, wrapLongitude,
  type PoseHandle, type ViewFrame,
} from "./poseMath";
import { scenePublicPath } from "./poseFile";
import { bindPoseEditStop, setPoseEditTitle } from "./poseEditTab";

const SAVE_URL = "/__foss-earth/pose";
const HANDLE_COLOR: Record<PoseHandle, string> = {
  east: "#ff5a5a", north: "#4aa3ff", up: "#3dde8a", heading: "#3dde8a", pitch: "#ff5a5a", spin: "#f4efe4",
};
const HANDLE_LABEL: Record<PoseHandle, string> = { east: "E", north: "N", up: "Up", heading: "H", pitch: "P", spin: "" };
const HANDLE_TITLE: Record<PoseHandle, string> = {
  east: "Drag to move. Click for the arc that turns these arrows.",
  north: "Drag to move. Click for the arc that turns these arrows.",
  up: "Drag to change altitude",
  heading: "Drag the ring to change heading",
  pitch: "Drag the ring to change pitch",
  spin: "Slide along the arc to turn the red and blue arrows",
};

interface Draft {
  longitudeDeg: number;
  latitudeDeg: number;
  headingDeg: number;
  pitchDeg: number;
  offsetM: number;
  heightMeters: number | null;
  mode: "ground-relative" | "capture-relative";
}

export interface PoseEditorHost {
  document: Document;
  canvas: HTMLCanvasElement;
  baseUrl: string;
  sceneUrl(): string | null;
  controller: SceneController;
  viewer: {
    describeImage?(id: string): { placement: { marker: Vec3 | null }; details?: { capture?: { heightMeters: number | null } | null } | null } | null;
    reposition(id: string, edit: { placement: ScenePlacement["placement"]; capture?: { latitudeDeg: number; longitudeDeg: number; heightMeters: number | null } }): void;
    setImageOpacity(id: string | null, opacity: number): void;
  };
  world: {
    setPoseEdit(id: string, edit: SpherePoseEdit | null): ScenePlacement | null;
    posePlacement(id: string): ScenePlacement | null;
  };
  renderer: { cameraFrame(): { eye: Vec3; view: ViewFrame["view"] } | null };
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

function draftFrom(entry: SceneEntryStatus): Draft | null {
  if (!entry.supported || !entry.capture || !entry.pose || !entry.marker) return null;
  return {
    longitudeDeg: entry.capture.longitudeDeg, latitudeDeg: entry.capture.latitudeDeg,
    headingDeg: entry.pose.headingDeg, pitchDeg: entry.pose.pitchDeg,
    offsetM: entry.marker.offsetM, heightMeters: entry.capture.heightMeters, mode: entry.marker.mode,
  };
}

function copyDraft(draft: Draft): Draft {
  return { ...draft };
}

function shortestHeading(from: number, to: number): number {
  const delta = Math.abs(wrapHeading(to - from));
  return Math.min(delta, 360 - delta);
}

function changed(from: Draft, to: Draft): boolean {
  return shortestHeading(from.headingDeg, to.headingDeg) > 1e-4
    || Math.abs(from.pitchDeg - to.pitchDeg) > 1e-4
    || Math.abs(from.latitudeDeg - to.latitudeDeg) > 1e-8
    || Math.abs(from.longitudeDeg - to.longitudeDeg) > 1e-8
    || Math.abs(from.offsetM - to.offsetM) > 1e-3
    || Math.abs((from.heightMeters ?? 0) - (to.heightMeters ?? 0)) > 1e-3;
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
  const panel = element(document, "details", "foss-earth-panel-section pose-editor");
  panel.open = true;
  panel.hidden = true;
  const summary = element(document, "summary", "foss-earth-panel-section__title", "Placement");
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
    latitudeDeg: field(document, fields, "Latitude"),
    longitudeDeg: field(document, fields, "Longitude"),
    altitude: field(document, fields, altitudeLabel),
    headingDeg: field(document, fields, "Heading"),
    pitchDeg: field(document, fields, "Pitch"),
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
  const hint = element(document, "p", "pose-editor-hint", "Drag the axes to move the photograph and the rings to turn it. Hover a red or blue arrow to lengthen it, then click it and slide the arc on either side to turn those two. Click the ground to stop editing. See through shows the map already loaded.");
  const actions = element(document, "div", "pose-editor-actions");
  const reset = element(document, "button", "pose-editor-reset", "Reset");
  reset.type = "button";
  const save = element(document, "button", "pose-editor-save", "Save place");
  save.type = "button";
  actions.append(reset, save);
  const status = element(document, "p", "pose-editor-status", "");
  status.setAttribute("role", "status");
  body.append(see, fields, hint, actions, status);
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

  const baselines = new Map<string, Draft>();
  const drafts = new Map<string, Draft>();
  const opacityOf = new Map<string, number>();
  let sceneKey = "";
  let selected: string | null = null;
  let note = "";
  let saving = false;
  let probe: boolean | null = null;
  let worldVisible = false;
  let appliedKey = "";
  let drag: { handle: PoseHandle; pointerId: number; x: number; y: number; startX: number; startY: number; moved: boolean } | null = null;
  let spinArm: "east" | "north" | null = null;
  let hoverHandle: PoseHandle | null = null;
  const HOVER_REACH = 1.22;
  const axisHeadingOf = new Map<string, number>();

  const stop = (event: Event) => event.stopPropagation();
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
    return selected ? drafts.get(selected) ?? null : null;
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

  function editOf(draft: Draft): SpherePoseEdit {
    return {
      longitudeDeg: draft.longitudeDeg, latitudeDeg: draft.latitudeDeg,
      heightMeters: draft.mode === "capture-relative" ? draft.heightMeters : null,
      headingDeg: wrapHeading(draft.headingDeg), pitchDeg: clampPitch(draft.pitchDeg), offsetM: draft.offsetM,
    };
  }

  function captureOf(draft: Draft): { latitudeDeg: number; longitudeDeg: number; heightMeters: number | null } {
    const authored = selected ? host.viewer.describeImage?.(selected)?.details?.capture?.heightMeters ?? null : null;
    return {
      latitudeDeg: draft.latitudeDeg, longitudeDeg: wrapLongitude(draft.longitudeDeg),
      heightMeters: draft.mode === "capture-relative" ? draft.heightMeters : authored,
    };
  }

  function markerKey(placement: ScenePlacement["placement"] | null): string {
    if (!placement?.marker) return "";
    return `${placement.marker.join(",")}|${placement.content.flat().join(",")}`;
  }

  function applyPlacement(id: string, draft: Draft, placement: ScenePlacement | null): void {
    const next = placement?.state === "placed" ? placement.placement : null;
    const key = markerKey(next);
    if (!next?.marker || key === appliedKey) return;
    appliedKey = key;
    host.viewer.reposition(id, { placement: next, capture: captureOf(draft) });
    if (host.controller.state().status?.phase === "immersive") host.runtime.syncPresentedCamera();
  }

  function publish(id: string, draft: Draft): void {
    const placed = host.world.setPoseEdit(id, editOf(draft));
    applyPlacement(id, draft, placed ?? host.world.posePlacement(id));
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
    axisInput.disabled = !draft;
    const arrowHeading = axisHeading();
    const arrowTurn = Math.min(arrowHeading, 360 - arrowHeading);
    axisReset.disabled = !draft || arrowTurn < 1e-3;
    write(axisInput, draft ? arrowHeading.toFixed(3) : "");
    if (!draft) return;
    altitudeLabel.textContent = draft.mode === "ground-relative" ? "Above the ground" : "Above the ellipsoid";
    write(inputs.latitudeDeg, draft.latitudeDeg.toFixed(6));
    write(inputs.longitudeDeg, draft.longitudeDeg.toFixed(6));
    write(inputs.altitude, (draft.mode === "ground-relative" ? draft.offsetM : draft.heightMeters ?? 0).toFixed(2));
    write(inputs.headingDeg, draft.headingDeg.toFixed(3));
    write(inputs.pitchDeg, draft.pitchDeg.toFixed(3));
  }

  function paint(): void {
    const scene = host.controller.state().status;
    const draft = currentDraft();
    const baseline = selected ? baselines.get(selected) ?? null : null;
    const dirty = Boolean(draft && baseline && changed(baseline, draft));
    const file = sceneFile();
    const showing = Boolean(draft && editingHere(scene));
    if (showing && panel.hidden) panel.scrollIntoView({ block: "nearest" });
    panel.hidden = !showing;
    const percent = Math.round((selected ? opacityFor(selected) : 1) * 100);
    if (document.activeElement !== opacity) opacity.value = String(100 - percent);
    opacityReadout.textContent = `${100 - percent}%`;
    opacity.disabled = !draft;
    writeFields(draft);
    reset.disabled = !dirty || saving;
    save.disabled = !dirty || saving || probe !== true || !file;
    if (note) status.textContent = note;
    else if (!file && scene && draft) status.textContent = "This scene is not a file in the app, so its place cannot be saved.";
    else if (probe === false) status.textContent = "Saving works on the local dev server, not on the published site.";
    else status.textContent = dirty ? "Save writes the scene file on this computer." : "";
    publishEditTab();
  }

  function publishEditTab(): void {
    if (!selected) { setPoseEditTitle(null); return; }
    const entry = host.controller.state().status?.entries.find(item => item.id === selected);
    setPoseEditTitle(entry?.title ?? null);
  }

  function stopEdit(): void {
    if (!selected) return;
    selected = null;
    spinArm = null;
    hoverHandle = null;
    note = "";
    syncOpacity();
    paint();
  }

  function axisHeading(): number {
    return selected ? axisHeadingOf.get(selected) ?? 0 : 0;
  }

  function remember(scene: SceneStatus): void {
    const key = `${scene.sceneId}:${scene.revision}:${scene.generation}`;
    if (key === sceneKey) return;
    for (const id of drafts.keys()) host.world.setPoseEdit(id, null);
    sceneKey = key; baselines.clear(); drafts.clear(); opacityOf.clear(); axisHeadingOf.clear(); spinArm = null; hoverHandle = null; appliedKey = ""; note = ""; selected = null;
    for (const entry of scene.entries) {
      const draft = draftFrom(entry);
      if (!draft) continue;
      baselines.set(entry.id, draft); drafts.set(entry.id, copyDraft(draft));
    }
    syncOpacity();
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
    const baseline = selected ? baselines.get(selected) : null;
    if (phase === "immersive" && selected && baseline && changed(baseline, draft)) applyPlacement(selected, draft, host.world.posePlacement(selected));
    const rect = worldViewportClientRect(host.canvas);
    const enu = enuFrame(draft.longitudeDeg, draft.latitudeDeg);
    const distance = length(sub(anchor, frame.eye));
    const arm = gizmoArmMeters(distance, frame.view.verticalFovRad, rect.height);
    const heading = axisHeading();
    const stretch: { east?: number; north?: number; up?: number } = {};
    if (hoverHandle === "east" || hoverHandle === "north" || hoverHandle === "up") stretch[hoverHandle] = HOVER_REACH;
    if (spinArm) stretch[spinArm] = HOVER_REACH;
    const lines = gizmoPolylines(anchor, enu.east, enu.north, enu.up, arm, frame.eye, heading, stretch);
    if (spinArm) {
      const turned = rotateHeading(enu.east, enu.north, heading);
      const direction = spinArm === "east" ? turned.east : turned.north;
      lines.push(axisSpin(anchor, direction, enu.up, arm * (stretch[spinArm] ?? 1)));
    }
    const box = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    const hubPoint = projectPoint(frame, anchor, box);
    if (hubPoint) { hub.setAttribute("cx", hubPoint.x.toFixed(1)); hub.setAttribute("cy", hubPoint.y.toFixed(1)); }
    hub.style.display = hubPoint ? "" : "none";
    const drawn = new Map(lines.map(line => [line.handle, line]));
    for (const handle of POSE_HANDLES) {
      const group = groups.get(handle);
      const line = drawn.get(handle);
      if (!group) continue;
      if (!line) { group.group.style.display = "none"; continue; }
      const path = traced(line.points, line.closed, frame, box);
      const head = line.head ? polygon(line.head, frame, box) : null;
      const headB = line.headB ? polygon(line.headB, frame, box) : null;
      const labelAt = HANDLE_LABEL[handle] ? projectPoint(frame, line.label, box) : null;
      group.group.style.display = path ? "" : "none";
      if (!path) continue;
      if (handle === "spin" && spinArm) {
        const color = HANDLE_COLOR[spinArm];
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
    const frame = frameOf(scene.phase);
    const anchor = frame ? anchorOf(scene.phase, frame) : null;
    if (!frame || !anchor) return;
    const rect = worldViewportClientRect(host.canvas);
    const rayAt = (x: number, y: number) => viewRay(frame, (x - rect.left) / Math.max(1, rect.width), (y - rect.top) / Math.max(1, rect.height));
    const enu = enuFrame(draft.longitudeDeg, draft.latitudeDeg);
    const turned = rotateHeading(enu.east, enu.north, axisHeading());
    const axis = handle === "east" ? turned.east : handle === "north" ? turned.north : enu.up;
    if (handle === "spin") {
      if (!spinArm) return;
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
      const around = handle === "heading" ? enu.up : enu.east;
      const delta = ringScreenDragDeg(handle, dot(around, sub(frame.eye, anchor)), turn);
      if (handle === "heading") next.headingDeg = wrapHeading(next.headingDeg + delta);
      else next.pitchDeg = clampPitch(next.pitchDeg + delta);
    }
    drafts.set(selected, next); note = ""; publish(selected, next); paint();
  }

  function commitNumber(key: "latitudeDeg" | "longitudeDeg" | "headingDeg" | "pitchDeg" | "altitude"): void {
    const draft = currentDraft();
    if (!draft || !selected) return;
    const input = inputs[key];
    const value = Number(input.value);
    if (!Number.isFinite(value)) { paint(); return; }
    const next = copyDraft(draft);
    if (key === "latitudeDeg") next.latitudeDeg = clampLatitude(value);
    else if (key === "longitudeDeg") next.longitudeDeg = wrapLongitude(value);
    else if (key === "headingDeg") next.headingDeg = wrapHeading(value);
    else if (key === "pitchDeg") next.pitchDeg = clampPitch(value);
    else if (next.mode === "ground-relative") next.offsetM = value;
    else next.heightMeters = value;
    drafts.set(selected, next); note = ""; publish(selected, next); paint();
  }

  for (const key of ["latitudeDeg", "longitudeDeg", "headingDeg", "pitchDeg", "altitude"] as const) {
    inputs[key].addEventListener("change", () => commitNumber(key));
    inputs[key].addEventListener("input", () => fitInput(inputs[key]));
  }
  axisInput.addEventListener("input", () => fitInput(axisInput));
  axisInput.addEventListener("change", () => {
    if (!selected) return;
    const value = Number(axisInput.value);
    if (!Number.isFinite(value)) { paint(); return; }
    axisHeadingOf.set(selected, wrapHeading(value));
    paint();
    host.runtime.requestRender();
  });
  axisReset.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!selected) return;
    axisHeadingOf.set(selected, 0);
    paint();
    host.runtime.requestRender();
  });
  opacity.addEventListener("input", () => {
    if (!selected) return;
    opacityOf.set(selected, 1 - Number(opacity.value) / 100);
    note = ""; syncOpacity(); paint();
  });
  reset.addEventListener("click", () => {
    if (!selected) return;
    const baseline = baselines.get(selected);
    if (!baseline) return;
    drafts.set(selected, copyDraft(baseline)); appliedKey = ""; note = "";
    const placed = host.world.setPoseEdit(selected, null);
    applyPlacement(selected, baseline, placed ?? host.world.posePlacement(selected));
    paint();
  });
  save.addEventListener("click", () => {
    const draft = currentDraft();
    const file = sceneFile();
    if (!draft || !selected || !file || probe !== true) return;
    saving = true; paint();
    const body: Record<string, unknown> = {
      file, entityId: selected, longitudeDeg: wrapLongitude(draft.longitudeDeg), latitudeDeg: clampLatitude(draft.latitudeDeg),
      headingDeg: wrapHeading(draft.headingDeg), pitchDeg: clampPitch(draft.pitchDeg), offsetM: draft.offsetM,
    };
    if (draft.mode === "capture-relative") body.heightMeters = draft.heightMeters;
    void fetch(new URL(SAVE_URL, window.location.origin), {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }).then(async response => {
      const payload = await response.json() as { ok?: boolean; error?: string };
      note = payload.ok ? "Saved into the scene file. Reload to update the status bar." : (payload.error ?? "The place could not be saved.");
      if (payload.ok && selected) {
        const saved = drafts.get(selected);
        if (saved) baselines.set(selected, copyDraft(saved));
      }
    }).catch(() => { note = "The place could not be saved."; }).finally(() => { saving = false; paint(); });
  });

  overlay.addEventListener("pointerdown", event => {
    if (!(event instanceof PointerEvent)) return;
    const handle = (event.target as Element | null)?.closest?.("[data-handle]")?.getAttribute("data-handle");
    if (!handle || !(POSE_HANDLES as readonly string[]).includes(handle)) return;
    event.preventDefault(); event.stopPropagation();
    try { (event.currentTarget as Element).setPointerCapture(event.pointerId); } catch { /* capture is optional; the drag still tracks the pointer */ }
    drag = { handle: handle as PoseHandle, pointerId: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false };
  }, true);
  overlay.addEventListener("pointermove", event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    const threshold = host.dragThresholdPx();
    const limit = Number.isFinite(threshold) && threshold >= 0 ? threshold : 4;
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= limit) drag.moved = true;
    if (!drag.moved) return;
    const from = drag;
    nudge(from.handle, from.x, from.y, event.clientX, event.clientY);
    drag = { ...from, x: event.clientX, y: event.clientY };
  });
  const endDrag = (event: PointerEvent) => {
    if (drag?.pointerId !== event.pointerId) return;
    const finished = drag;
    drag = null;
    if (event.type !== "pointerup" || finished.moved || (finished.handle !== "east" && finished.handle !== "north")) return;
    spinArm = spinArm === finished.handle ? null : finished.handle;
    host.runtime.requestRender();
  };
  overlay.addEventListener("pointerup", endDrag);
  overlay.addEventListener("pointercancel", endDrag);
  const handleOf = (event: Event): PoseHandle | null => {
    const name = (event.target as Element | null)?.closest?.("[data-handle]")?.getAttribute("data-handle");
    return name && (POSE_HANDLES as readonly string[]).includes(name) ? name as PoseHandle : null;
  };
  overlay.addEventListener("pointerover", event => {
    if (drag) return;
    const next = handleOf(event);
    if (!next || next === hoverHandle) return;
    hoverHandle = next;
    host.runtime.requestRender();
  });
  overlay.addEventListener("pointerout", event => {
    if (drag) return;
    if (handleOf(event) !== hoverHandle) return;
    const still = (event.relatedTarget as Element | null)?.closest?.("[data-handle]")?.getAttribute("data-handle");
    if (still === hoverHandle) return;
    hoverHandle = null;
    host.runtime.requestRender();
  });

  let rightPress: { x: number; y: number; moved: boolean } | null = null;
  let primaryPress: { x: number; y: number; moved: boolean } | null = null;
  const markMoved = (press: { x: number; y: number; moved: boolean } | null, event: PointerEvent) => {
    const threshold = host.dragThresholdPx();
    if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) >= (Number.isFinite(threshold) && threshold >= 0 ? threshold : 4)) press.moved = true;
  };
  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    if (event.button === 2) rightPress = { x: event.clientX, y: event.clientY, moved: false };
    if (event.button === 0) primaryPress = { x: event.clientX, y: event.clientY, moved: false };
  };
  const onPointerMove = (event: PointerEvent) => {
    if ((event.buttons & 2) !== 0) markMoved(rightPress, event);
    if ((event.buttons & 1) !== 0) markMoved(primaryPress, event);
  };
  const onPrimaryUp = (event: PointerEvent) => {
    if (event.button !== 0) return;
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
    const moved = rightPress?.moved ?? false;
    rightPress = null;
    if (moved) return;
    const scene = host.controller.state().status;
    if (!scene || scene.phase !== "overview") return;
    const [id] = host.controller.handle()?.pick(event.clientX, event.clientY) ?? [];
    if (!id || !drafts.has(id)) return;
    event.preventDefault();
    if (selected !== id) spinArm = null;
    selected = id; note = ""; appliedKey = "";
    syncOpacity(); paint();
  };
  const unbindStop = bindPoseEditStop(stopEdit);
  const onPointerCancel = () => { primaryPress = null; };
  host.canvas.addEventListener("pointerdown", onPointerDown, true);
  host.canvas.addEventListener("pointermove", onPointerMove, true);
  host.canvas.addEventListener("pointerup", onPrimaryUp);
  host.canvas.addEventListener("pointercancel", onPointerCancel);
  host.canvas.addEventListener("contextmenu", onContextMenu);

  const offStatus = host.controller.subscribe(state => {
    if (state.status) remember(state.status);
    syncOpacity(); paint();
  });
  const offBefore = host.beforeFrame(() => {
    const phase = host.controller.state().status?.phase;
    if (phase === "immersive" && worldVisible) host.runtime.syncPresentedCamera();
  });
  const offAfter = host.afterFrame(draw);
  void fetch(new URL(SAVE_URL, window.location.origin)).then(response => { probe = response.ok; paint(); }, () => { probe = false; paint(); });

  return {
    dispose() {
      offStatus(); offBefore(); offAfter(); unbindStop();
      host.canvas.removeEventListener("pointerdown", onPointerDown, true);
      host.canvas.removeEventListener("pointermove", onPointerMove, true);
      host.canvas.removeEventListener("pointerup", onPrimaryUp);
      host.canvas.removeEventListener("pointercancel", onPointerCancel);
      host.canvas.removeEventListener("contextmenu", onContextMenu);
      selected = null; setPoseEditTitle(null);
      showWorld(false);
      host.viewer.setImageOpacity(null, 1);
      for (const id of drafts.keys()) host.world.setPoseEdit(id, null);
      panel.remove(); overlay.remove();
    },
  };
}
