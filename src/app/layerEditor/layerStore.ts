/**
 * Which photograph belongs in which panoramas layer, kept in the browser and
 * exported the way place and orientation corrections are. Storage is a copy:
 * a failed read or write leaves the session's corrections usable.
 */
export const LAYER_STORAGE_KEY = "foss-earth.layer-overrides.v1";
export const LAYER_FORMAT = "foss-earth-layer-overrides";
export const LAYER_VERSION = 1;
export const DEFAULT_LAYER_EXPORT_PREFIX = "foss-earth-layers";
const COALESCE_MS = 300;

export interface LayerEditRecord {
  entityId: string;
  title: string;
  /** The panoramas layer the photograph was moved into. */
  layerId: string;
  /** The panoramas layer the published scene gives it. */
  authoredLayerId: string;
  authoredRevision: string;
  updatedAt: string;
}

export interface LayerSceneRecord {
  sceneId: string;
  sceneUrl: string;
  edits: LayerEditRecord[];
}

export interface LayerEnvelope {
  format: typeof LAYER_FORMAT;
  version: typeof LAYER_VERSION;
  scenes: LayerSceneRecord[];
}

export interface LayerExport extends LayerEnvelope {
  exportedAt: string;
}

export interface LayerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type LayerPersist = "schedule" | "now" | "memory";

export interface LayerStoreOptions {
  storage: LayerStorage | null;
  nowIso(): string;
  schedule(run: () => void, delayMs: number): { cancel(): void };
  key?: string;
}

export interface LayerStoreStatus {
  persistence: "saved" | "session" | "blocked" | "foreign";
  messages: readonly string[];
}

export interface LayerStore {
  status(): LayerStoreStatus;
  edits(sceneId: string, sceneUrl: string): readonly LayerEditRecord[];
  summary(): { edits: number };
  assign(sceneId: string, sceneUrl: string, edit: LayerEditRecord, persist: LayerPersist): boolean;
  remove(sceneId: string, sceneUrl: string, entityId: string, persist: LayerPersist): void;
  clearScene(sceneId: string, sceneUrl: string, persist: LayerPersist): void;
  replaceSaved(): { ok: boolean; message: string };
  exportDocument(exportedAt: string): { document: LayerExport; text: string; disclosures: readonly string[] };
  flush(): void;
  cancelPending(): void;
  observeExternal(raw: string | null): void;
  dispose(): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): value is string {
  // Reject control characters in exported identifiers and labels.
  // eslint-disable-next-line no-control-regex
  return typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= 500 && !/[\u0000-\u001f]/.test(value);
}

function validIso(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}

export function layerExportFilename(prefix: string | undefined, exportedAt: string): string {
  const base = prefix && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(prefix) ? prefix : DEFAULT_LAYER_EXPORT_PREFIX;
  const day = /^\d{4}-\d{2}-\d{2}/.test(exportedAt) ? exportedAt.slice(0, 10) : "0000-00-00";
  return `${base}-${day}.json`;
}

export function serializeLayerDocument(document: LayerEnvelope | LayerExport): string {
  const scenes = [...document.scenes].sort((a, b) => a.sceneId.localeCompare(b.sceneId) || a.sceneUrl.localeCompare(b.sceneUrl));
  const body: Record<string, unknown> = { format: LAYER_FORMAT, version: LAYER_VERSION };
  if ("exportedAt" in document && document.exportedAt) body.exportedAt = document.exportedAt;
  body.scenes = scenes.map(scene => ({
    sceneId: scene.sceneId,
    sceneUrl: scene.sceneUrl,
    edits: [...scene.edits].sort((a, b) => a.entityId.localeCompare(b.entityId)).map(edit => ({
      entityId: edit.entityId, title: edit.title, layerId: edit.layerId, authoredLayerId: edit.authoredLayerId,
      authoredRevision: edit.authoredRevision, updatedAt: edit.updatedAt,
    })),
  }));
  return `${JSON.stringify(body, null, 2)}\n`;
}

function readEdit(value: unknown): LayerEditRecord | null {
  if (!isRecord(value)) return null;
  if (!text(value.entityId) || !text(value.title) || !text(value.layerId) || !text(value.authoredLayerId) || !text(value.authoredRevision) || !validIso(value.updatedAt)) return null;
  if (value.layerId === value.authoredLayerId) return null;
  return {
    entityId: value.entityId, title: value.title, layerId: value.layerId, authoredLayerId: value.authoredLayerId,
    authoredRevision: value.authoredRevision, updatedAt: value.updatedAt,
  };
}

export function parseLayerStore(raw: string): { ok: true; scenes: LayerSceneRecord[]; skipped: string[] } | { ok: false; message: string } {
  let parsed: unknown;
  try { parsed = JSON.parse(raw) as unknown; }
  catch { return { ok: false, message: "The saved layer corrections could not be read." }; }
  if (!isRecord(parsed) || parsed.format !== LAYER_FORMAT || parsed.version !== LAYER_VERSION || !Array.isArray(parsed.scenes)) {
    return { ok: false, message: "The saved layer corrections are a different format." };
  }
  const scenes: LayerSceneRecord[] = [];
  const skipped: string[] = [];
  for (const scene of parsed.scenes) {
    if (!isRecord(scene) || !text(scene.sceneId) || !text(scene.sceneUrl) || !Array.isArray(scene.edits)) { skipped.push("a scene"); continue; }
    const edits: LayerEditRecord[] = [];
    for (const edit of scene.edits) {
      const record = readEdit(edit);
      if (record) edits.push(record);
      else skipped.push(isRecord(edit) && typeof edit.entityId === "string" ? edit.entityId : "an edit");
    }
    scenes.push({ sceneId: scene.sceneId, sceneUrl: scene.sceneUrl, edits });
  }
  return { ok: true, scenes, skipped };
}

export function createLayerStore(options: LayerStoreOptions): LayerStore {
  const key = options.key ?? LAYER_STORAGE_KEY;
  let scenes: LayerSceneRecord[] = [];
  let persistence: LayerStoreStatus["persistence"] = "saved";
  let messages: string[] = [];
  let originalText: string | null = null;
  let blocked = false;
  let pending: { cancel(): void } | null = null;
  let disposed = false;

  const sceneOf = (sceneId: string, sceneUrl: string): LayerSceneRecord => {
    let scene = scenes.find(item => item.sceneId === sceneId && item.sceneUrl === sceneUrl);
    if (!scene) { scene = { sceneId, sceneUrl, edits: [] }; scenes.push(scene); }
    return scene;
  };

  function load(): void {
    if (!options.storage) { persistence = "session"; messages = ["This browser is not keeping layer corrections."]; return; }
    let raw: string | null = null;
    try { raw = options.storage.getItem(key); }
    catch { persistence = "blocked"; messages = ["Saved layer corrections could not be read."]; blocked = true; return; }
    if (!raw) return;
    const parsed = parseLayerStore(raw);
    if (!parsed.ok) { originalText = raw; blocked = true; persistence = "foreign"; messages = [parsed.message]; return; }
    scenes = parsed.scenes;
    if (parsed.skipped.length) messages = [`Skipped unreadable layer corrections: ${parsed.skipped.join(", ")}.`];
  }

  function write(): void {
    if (disposed || blocked || !options.storage) { if (!blocked && !options.storage) persistence = "session"; return; }
    const text = serializeLayerDocument({ format: LAYER_FORMAT, version: LAYER_VERSION, scenes: scenes.filter(scene => scene.edits.length) });
    try {
      if (text === `${JSON.stringify({ format: LAYER_FORMAT, version: LAYER_VERSION, scenes: [] }, null, 2)}\n`) options.storage.removeItem(key);
      else options.storage.setItem(key, text);
      persistence = "saved";
    } catch {
      persistence = "blocked";
      messages = ["Layer corrections stayed in this session. The browser refused to store them."];
      blocked = true;
    }
  }

  function persist(mode: LayerPersist): void {
    if (mode === "memory") { persistence = options.storage && !blocked ? persistence : "session"; return; }
    if (mode === "now") { pending?.cancel(); pending = null; write(); return; }
    pending?.cancel();
    pending = options.schedule(() => { pending = null; write(); }, COALESCE_MS);
    persistence = blocked ? "blocked" : options.storage ? "saved" : "session";
  }

  load();

  return {
    status: () => ({ persistence, messages: [...messages] }),
    edits(sceneId, sceneUrl) { return [...(scenes.find(scene => scene.sceneId === sceneId && scene.sceneUrl === sceneUrl)?.edits ?? [])]; },
    summary: () => ({ edits: scenes.reduce((sum, scene) => sum + scene.edits.length, 0) }),
    assign(sceneId, sceneUrl, edit, mode) {
      if (!text(sceneId) || !text(sceneUrl) || !readEdit(edit)) return false;
      const scene = sceneOf(sceneId, sceneUrl);
      scene.edits = scene.edits.filter(item => item.entityId !== edit.entityId);
      scene.edits.push({ ...edit });
      persist(mode);
      return true;
    },
    remove(sceneId, sceneUrl, entityId, mode) {
      const scene = scenes.find(item => item.sceneId === sceneId && item.sceneUrl === sceneUrl);
      if (!scene) return;
      scene.edits = scene.edits.filter(item => item.entityId !== entityId);
      persist(mode);
    },
    clearScene(sceneId, sceneUrl, mode) {
      const scene = scenes.find(item => item.sceneId === sceneId && item.sceneUrl === sceneUrl);
      if (!scene) return;
      scene.edits = [];
      persist(mode);
    },
    replaceSaved() {
      if (!blocked) return { ok: false, message: "Saved layer corrections are already in use." };
      blocked = false;
      originalText = null;
      persistence = "saved";
      messages = [];
      write();
      return persistence === "saved" ? { ok: true, message: "Saved layer corrections were replaced with this session." } : { ok: false, message: messages[0] ?? "The corrections could not be stored." };
    },
    exportDocument(exportedAt) {
      const document: LayerExport = { format: LAYER_FORMAT, version: LAYER_VERSION, exportedAt, scenes: scenes.filter(scene => scene.edits.length).map(scene => ({ ...scene, edits: scene.edits.map(edit => ({ ...edit })) })) };
      const disclosures = [...messages];
      if (originalText) disclosures.push("An older saved copy could not be read and is not in this export.");
      return { document, text: serializeLayerDocument(document), disclosures };
    },
    flush() { pending?.cancel(); pending = null; write(); },
    cancelPending() { pending?.cancel(); pending = null; },
    observeExternal(raw) {
      if (blocked || disposed) return;
      pending?.cancel(); pending = null;
      if (!raw) { scenes = []; persistence = "saved"; messages = []; return; }
      const parsed = parseLayerStore(raw);
      if (!parsed.ok) { originalText = raw; blocked = true; persistence = "foreign"; messages = [parsed.message]; return; }
      scenes = parsed.scenes;
      messages = parsed.skipped.length ? [`Skipped unreadable layer corrections: ${parsed.skipped.join(", ")}.`] : [];
      persistence = "saved";
    },
    dispose() { disposed = true; pending?.cancel(); pending = null; write(); },
  };
}
