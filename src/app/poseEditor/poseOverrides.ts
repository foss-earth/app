/**
 * Applies saved pose overrides to one scene host. The editor submits changes
 * here; it does not keep a second store or clear these shadows on dispose.
 * A load's URL is fixed before overrides are applied. Generation alone never
 * commits a scene: a failed replacement leaves the previous live poses in place.
 */
import type { SceneController, SceneEntryStatus, ScenePlacement, SceneStatus } from "@foss-earth/scenes/browser";
import { sceneManifestUrl } from "@foss-earth/scenes/browser";
import type { SpherePoseEdit } from "../sceneWorld";
import {
  canonicalSceneUrl, conflictFields, createPoseStore, POSE_STORAGE_KEY,
  type DesiredNumbers, type PoseEditRecord, type PosePersist, type PoseStorage, type PoseStore, type PoseStoreStatus, type PublishedBaseline,
} from "./poseStore";

export interface PoseOverridePorts {
  baseUrl: string;
  controller: SceneController;
  world: {
    setPoseEdit(id: string, edit: SpherePoseEdit | null): ScenePlacement | null;
    posePlacement(id: string): ScenePlacement | null;
  };
  viewer: {
    reposition(id: string, edit: { placement: ScenePlacement["placement"]; capture?: { latitudeDeg: number; longitudeDeg: number; heightMeters: number | null } }): void;
    syncPresentedCamera?(): void;
  };
  /** When false, loading prunes memory but does not write. The editor turns writes on. */
  persist: boolean;
  store?: PoseStore;
  nowIso?(): string;
  nowMs?(): number;
  schedule?(run: () => void, delayMs: number): { cancel(): void };
  storage?: PoseStorage | null;
}

export interface PoseOverrides {
  readonly store: PoseStore;
  status(): PoseStoreStatus;
  scene(): { sceneId: string; sceneUrl: string; revision: string } | null;
  baseline(entityId: string): PublishedBaseline | null;
  record(entityId: string): PoseEditRecord | null;
  counts(): { scene: number; all: number };
  unknownIds(): readonly string[];
  conflicts(entityId: string): readonly string[];
  setNumbers(entityId: string, desired: DesiredNumbers): boolean;
  confirm(entityId: string, reference: string): { ok: true } | { ok: false; reason: string };
  unconfirm(entityId: string): void;
  setReference(entityId: string, reference: string): { ok: true } | { ok: false; reason: string };
  restoreEdits(edits: readonly PoseEditRecord[]): void;
  reset(entityId: string): void;
  /** Keeps the live pose after a local file save and drops the override that the file now holds. */
  noteFileSaved(entityId: string): void;
  clearScene(): { blocked: boolean };
  replaceSaved(): { ok: boolean; message: string };
  exportDocument(exportedAt: string): { text: string; disclosures: readonly string[] };
  flush(): void;
  cancelPending(): void;
  observeExternal(raw: string | null): void;
  onTransition(listener: () => void): () => void;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

function baselineFrom(entry: SceneEntryStatus, revision: string): PublishedBaseline | null {
  if (!entry.supported || !entry.capture || !entry.pose || !entry.marker) return null;
  if (entry.marker.mode !== "ground-relative" && entry.marker.mode !== "capture-relative") return null;
  return {
    entityId: entry.id, title: entry.title, revision, mode: entry.marker.mode,
    longitudeDeg: entry.capture.longitudeDeg, latitudeDeg: entry.capture.latitudeDeg, heightMeters: entry.capture.heightMeters,
    headingDeg: entry.pose.headingDeg, pitchDeg: entry.pose.pitchDeg, rollDeg: entry.pose.rollDeg,
    offsetM: entry.marker.offsetM, aligned: entry.pose.aligned, eastM: entry.marker.eastM, northM: entry.marker.northM,
  };
}

function sphereEdit(record: PoseEditRecord, baseline: PublishedBaseline): SpherePoseEdit {
  return {
    longitudeDeg: record.capture.longitudeDeg, latitudeDeg: record.capture.latitudeDeg,
    heightMeters: baseline.mode === "capture-relative" ? record.capture.heightMeters : null,
    headingDeg: record.imagePose.headingDeg, pitchDeg: record.imagePose.pitchDeg, rollDeg: record.imagePose.rollDeg, offsetM: record.marker.offsetM,
  };
}

function captureOf(record: PoseEditRecord, baseline: PublishedBaseline): { latitudeDeg: number; longitudeDeg: number; heightMeters: number | null } {
  return {
    latitudeDeg: record.capture.latitudeDeg, longitudeDeg: record.capture.longitudeDeg,
    heightMeters: baseline.mode === "capture-relative" ? record.capture.heightMeters : baseline.heightMeters,
  };
}

function publishedCapture(baseline: PublishedBaseline): { latitudeDeg: number; longitudeDeg: number; heightMeters: number | null } {
  return { latitudeDeg: baseline.latitudeDeg, longitudeDeg: baseline.longitudeDeg, heightMeters: baseline.heightMeters };
}

function signatureOf(placement: ScenePlacement["placement"], capture: { longitudeDeg: number; latitudeDeg: number; heightMeters: number | null }, heading: number, pitch: number): string {
  const marker = placement.marker ? placement.marker.join(",") : "";
  return `${marker}|${placement.content.flat().join(",")}|${capture.longitudeDeg}|${capture.latitudeDeg}|${capture.heightMeters}|${heading}|${pitch}`;
}

function resolveLoadUrl(controller: SceneController, baseUrl: string, input: string, exampleId?: boolean): string | null {
  try {
    const example = exampleId ? controller.examples.find(entry => entry.id === input.trim()) : undefined;
    if (exampleId && !example) return null;
    return sceneManifestUrl(example?.url ?? input.trim(), baseUrl).href;
  } catch {
    return null;
  }
}

/** localStorage, or null when the browser refuses it. Calls are still guarded by the store. */
export function openPoseStorage(view: Window): PoseStorage | null {
  try {
    const storage = view.localStorage;
    storage.getItem(POSE_STORAGE_KEY);
    return {
      getItem: key => storage.getItem(key),
      setItem: (key, value) => storage.setItem(key, value),
      removeItem: key => storage.removeItem(key),
    };
  } catch {
    return null;
  }
}

export function createPoseOverrides(ports: PoseOverridePorts): PoseOverrides {
  const store = ports.store ?? createPoseStore({
    storage: ports.storage === undefined ? null : ports.storage,
    nowIso: ports.nowIso ?? (() => new Date().toISOString()),
    nowMs: ports.nowMs ?? (() => Date.now()),
    schedule: ports.schedule ?? ((run, delayMs) => {
      const id = setTimeout(run, delayMs);
      return { cancel: () => clearTimeout(id) };
    }),
  });
  const listeners = new Set<() => void>();
  const transitionListeners = new Set<() => void>();
  let identity: { sceneId: string; sceneUrl: string; revision: string } | null = null;
  let baselines = new Map<string, PublishedBaseline>();
  const applied = new Map<string, PoseEditRecord>();
  let held = new Set<string>();
  const awaitingPublished = new Set<string>();
  const signatures = new Map<string, string>();
  let unknown: string[] = [];
  let withheld: string[] = [];
  let applying = 0;
  let transitioning = false;
  let accepting = true;
  let epoch = 0;
  let disposed = false;

  const emit = () => { for (const listener of [...listeners]) listener(); };

  function reposition(id: string, placement: ScenePlacement["placement"], capture: { latitudeDeg: number; longitudeDeg: number; heightMeters: number | null }, heading: number, pitch: number): void {
    const key = signatureOf(placement, capture, heading, pitch);
    if (signatures.get(id) === key) return;
    signatures.set(id, key);
    ports.viewer.reposition(id, { placement, capture });
    const status = ports.controller.state().status;
    if (status?.phase === "immersive" && status.active === id) ports.viewer.syncPresentedCamera?.();
  }

  function restorePublished(id: string): void {
    const baseline = baselines.get(id);
    applying += 1;
    try {
      const result = ports.world.setPoseEdit(id, null);
      applied.delete(id);
      held.delete(id);
      signatures.delete(id);
      const placement = result?.state === "placed" && result.placement.marker ? result.placement
        : ports.world.posePlacement(id)?.state === "placed" ? ports.world.posePlacement(id)!.placement : null;
      if (baseline && placement?.marker) {
        reposition(id, placement, publishedCapture(baseline), baseline.headingDeg, baseline.pitchDeg);
        awaitingPublished.delete(id);
      } else if (baseline) awaitingPublished.add(id);
    } finally { applying -= 1; }
  }

  function applyRecord(record: PoseEditRecord): void {
    const baseline = baselines.get(record.entityId);
    if (!baseline || baseline.mode !== record.mode) return;
    const edit = sphereEdit(record, baseline);
    applying += 1;
    try {
      const result = ports.world.setPoseEdit(record.entityId, edit);
      applied.set(record.entityId, record);
      const placement = result?.state === "placed" && result.placement.marker ? result.placement : null;
      if (placement) reposition(record.entityId, placement, captureOf(record, baseline), record.imagePose.headingDeg, record.imagePose.pitchDeg);
      else signatures.delete(record.entityId);
    } finally { applying -= 1; }
  }

  function releaseLive(): void {
    applying += 1;
    try {
      for (const id of applied.keys()) ports.world.setPoseEdit(id, null);
    } finally { applying -= 1; }
    applied.clear();
    held.clear();
    awaitingPublished.clear();
    signatures.clear();
  }

  function applyCurrent(): void {
    if (!identity) return;
    const list = [...baselines.values()];
    store.reconcile(identity.sceneId, identity.sceneUrl, list, "memory");
    unknown = [];
    withheld = [];
    const edits = store.edits(identity.sceneId, identity.sceneUrl);
    const known = new Set(baselines.keys());
    for (const record of edits) {
      if (!known.has(record.entityId)) { unknown.push(record.entityId); continue; }
      const baseline = baselines.get(record.entityId)!;
      if (baseline.mode !== record.mode) { withheld.push(record.entityId); continue; }
      applyRecord(record);
    }
  }

  function commit(status: SceneStatus, url: string): void {
    const sceneUrl = canonicalSceneUrl(url, ports.baseUrl);
    if (!sceneUrl || !status.sceneId) return;
    releaseLive();
    identity = { sceneId: status.sceneId, sceneUrl, revision: status.revision };
    baselines = new Map();
    for (const entry of status.entries) {
      const baseline = baselineFrom(entry, status.revision);
      if (baseline) baselines.set(entry.id, baseline);
    }
    applyCurrent();
  }

  function resync(): void {
    if (applying || transitioning || !identity) return;
    for (const [id, record] of applied) {
      const baseline = baselines.get(id);
      const watched = ports.world.posePlacement(id);
      if (!baseline || watched?.state !== "placed" || !watched.placement.marker) continue;
      reposition(id, watched.placement, captureOf(record, baseline), record.imagePose.headingDeg, record.imagePose.pitchDeg);
    }
    for (const id of [...awaitingPublished]) {
      const baseline = baselines.get(id);
      const watched = ports.world.posePlacement(id);
      if (!baseline || watched?.state !== "placed" || !watched.placement.marker) continue;
      reposition(id, watched.placement, publishedCapture(baseline), baseline.headingDeg, baseline.pitchDeg);
      awaitingPublished.delete(id);
    }
  }

  const originalLoad = ports.controller.load.bind(ports.controller);
  ports.controller.load = async (input, loadOptions) => {
    if (disposed) return false;
    const token = ++epoch;
    const url = resolveLoadUrl(ports.controller, ports.baseUrl, input, loadOptions?.exampleId);
    const previous = { identity, baselines, applied: new Map(applied), held: new Set(held) };
    transitioning = true;
    accepting = false;
    for (const listener of [...transitionListeners]) listener();
    if (ports.persist) store.flush();
    else store.cancelPending();
    releaseLive();
    const restore = () => {
      identity = previous.identity;
      baselines = previous.baselines;
      for (const record of previous.applied.values()) applyRecord(record);
      held = previous.held;
    };
    let ok = false;
    try { ok = await originalLoad(input, loadOptions); }
    catch (error) {
      if (token === epoch && !disposed) { restore(); transitioning = false; accepting = true; emit(); }
      throw error;
    }
    if (token !== epoch || disposed) return ok;
    const status = ports.controller.state().status;
    if (!ok || !url || !status?.sceneId) restore();
    else commit(status, url);
    transitioning = false;
    accepting = true;
    emit();
    return ok;
  };

  const offStatus = ports.controller.subscribe(state => {
    if (applying || transitioning || disposed) return;
    if (!state.status) {
      if (identity) { releaseLive(); identity = null; baselines = new Map(); unknown = []; withheld = []; emit(); }
      return;
    }
    resync();
  });

  function requireScene(): { sceneId: string; sceneUrl: string; revision: string } | null {
    return accepting && identity ? identity : null;
  }

  function mutatePersist(): PosePersist {
    return ports.persist ? "schedule" : "memory";
  }

  return {
    store,
    status: () => store.status(),
    scene: () => identity ? { ...identity } : null,
    baseline: id => {
      const baseline = baselines.get(id);
      return baseline ? { ...baseline } : null;
    },
    record: id => identity ? store.edit(identity.sceneId, identity.sceneUrl, id) : null,
    counts() {
      const scene = identity ? store.edits(identity.sceneId, identity.sceneUrl).length : 0;
      return { scene, all: store.summary().edits };
    },
    unknownIds: () => [...unknown],
    conflicts(id) {
      if (!identity) return [];
      const record = store.edit(identity.sceneId, identity.sceneUrl, id);
      const baseline = baselines.get(id);
      return record && baseline ? [...conflictFields(record.authored, baseline)] : [];
    },
    setNumbers(id, desired) {
      const scene = requireScene();
      const baseline = baselines.get(id);
      if (!scene || !baseline) return false;
      held.delete(id);
      const ok = store.setNumbers(scene.sceneId, scene.sceneUrl, baseline, desired, mutatePersist());
      const record = store.edit(scene.sceneId, scene.sceneUrl, id);
      if (!record) restorePublished(id);
      else applyRecord(record);
      emit();
      return ok;
    },
    confirm(id, reference) {
      const scene = requireScene();
      const baseline = baselines.get(id);
      if (!scene || !baseline) return { ok: false, reason: "No photograph is open." };
      const result = store.confirm(scene.sceneId, scene.sceneUrl, baseline, reference, ports.persist ? "now" : "memory");
      const record = store.edit(scene.sceneId, scene.sceneUrl, id);
      if (!record) restorePublished(id);
      else applyRecord(record);
      emit();
      return result;
    },
    unconfirm(id) {
      const scene = requireScene();
      const baseline = baselines.get(id);
      if (!scene || !baseline) return;
      store.unconfirm(scene.sceneId, scene.sceneUrl, baseline, ports.persist ? "now" : "memory");
      const record = store.edit(scene.sceneId, scene.sceneUrl, id);
      if (!record) restorePublished(id);
      else applyRecord(record);
      emit();
    },
    setReference(id, reference) {
      const scene = requireScene();
      if (!scene) return { ok: false, reason: "No photograph is open." };
      const result = store.setReference(scene.sceneId, scene.sceneUrl, id, reference, ports.persist ? "now" : "memory");
      emit();
      return result;
    },
    restoreEdits(edits) {
      const scene = requireScene();
      if (!scene) return;
      store.restoreScene(scene.sceneId, scene.sceneUrl, edits, ports.persist ? "now" : "memory");
      for (const id of [...applied.keys()]) restorePublished(id);
      applyCurrent();
      emit();
    },
    reset(id) {
      const scene = requireScene();
      if (!scene) return;
      store.cancelPending();
      store.remove(scene.sceneId, scene.sceneUrl, id, ports.persist ? "now" : "memory");
      restorePublished(id);
      emit();
    },
    noteFileSaved(id) {
      if (!applied.has(id)) return;
      held.add(id);
      if (identity) store.remove(identity.sceneId, identity.sceneUrl, id, ports.persist ? "now" : "memory");
      emit();
    },
    clearScene() {
      const scene = requireScene();
      if (!scene) return { blocked: true };
      store.cancelPending();
      const result = store.clearScene(scene.sceneId, scene.sceneUrl, ports.persist ? "now" : "memory");
      for (const id of [...applied.keys()]) restorePublished(id);
      unknown = [];
      withheld = [];
      emit();
      return result;
    },
    replaceSaved() {
      const result = store.replaceSaved();
      emit();
      return result;
    },
    exportDocument(exportedAt) {
      store.flush();
      const exported = store.exportDocument(exportedAt);
      const disclosures = [...exported.disclosures];
      if (unknown.length) disclosures.push(`Kept corrections for photographs this scene does not show: ${unknown.join(", ")}.`);
      if (withheld.length) disclosures.push(`Kept corrections whose placement mode no longer matches: ${withheld.join(", ")}.`);
      if (identity) {
        const older = store.edits(identity.sceneId, identity.sceneUrl)
          .filter(record => { const baseline = baselines.get(record.entityId); return baseline && conflictFields(record.authored, baseline).length; })
          .map(record => record.entityId);
        if (older.length) disclosures.push(`Based on an older placement: ${older.join(", ")}.`);
      }
      return { text: exported.text, disclosures };
    },
    flush: () => store.flush(),
    cancelPending: () => store.cancelPending(),
    observeExternal(raw) { store.observeExternal(raw); emit(); },
    onTransition(listener) { transitionListeners.add(listener); return () => { transitionListeners.delete(listener); }; },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose() {
      if (disposed) return;
      disposed = true;
      accepting = false;
      if (ports.persist) store.dispose();
      else store.cancelPending();
      offStatus();
      ports.controller.load = originalLoad;
      listeners.clear();
      transitionListeners.clear();
    },
  };
}
