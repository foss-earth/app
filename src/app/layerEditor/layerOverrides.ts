/**
 * Applies saved layer corrections to the open scene. A drag in the Scenes panel
 * moves the photograph immediately; this remembers the difference from the
 * published scene and can export it.
 */
import { sceneManifestUrl, type SceneController, type SceneStatus } from "@foss-earth/scenes/browser";
import { canonicalSceneUrl } from "../poseEditor/poseStore";
import {
  createLayerStore, LAYER_STORAGE_KEY, layerExportFilename, type LayerEditRecord, type LayerPersist, type LayerStorage, type LayerStore,
} from "./layerStore";

export interface LayerOverridePorts {
  baseUrl: string;
  controller: SceneController;
  persist: boolean;
  /** Filename prefix. The default is `foss-earth-layers`. */
  exportPrefix?: string;
  store?: LayerStore;
  storage?: LayerStorage | null;
  nowIso?(): string;
  schedule?(run: () => void, delayMs: number): { cancel(): void };
}

export interface LayerOverrides {
  count(): number;
  note(): string;
  exportDocument(): { text: string; filename: string; disclosures: readonly string[] };
  reset(): void;
  subscribe(listener: () => void): () => void;
  flush(): void;
  observeExternal(raw: string | null): void;
  dispose(): void;
}

function membership(status: SceneStatus): Map<string, string> {
  const map = new Map<string, string>();
  const walk = (layers: SceneStatus["layers"]): void => {
    for (const layer of layers) {
      if (layer.kind === "panoramas") for (const id of layer.members) if (!map.has(id)) map.set(id, layer.id);
      walk(layer.layers);
    }
  };
  walk(status.layers);
  return map;
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

/** localStorage, or null when the browser refuses it. */
export function openLayerStorage(view: Window): LayerStorage | null {
  try {
    const storage = view.localStorage;
    storage.getItem(LAYER_STORAGE_KEY);
    return {
      getItem: key => storage.getItem(key),
      setItem: (key, value) => storage.setItem(key, value),
      removeItem: key => storage.removeItem(key),
    };
  } catch {
    return null;
  }
}

export function createLayerOverrides(ports: LayerOverridePorts): LayerOverrides {
  const store = ports.store ?? createLayerStore({
    storage: ports.storage === undefined ? null : ports.storage,
    nowIso: ports.nowIso ?? (() => new Date().toISOString()),
    schedule: ports.schedule ?? ((run, delayMs) => {
      const id = setTimeout(run, delayMs);
      return { cancel: () => clearTimeout(id) };
    }),
  });
  const listeners = new Set<() => void>();
  let identity: { sceneId: string; sceneUrl: string; revision: string } | null = null;
  let authored = new Map<string, string>();
  let titles = new Map<string, string>();
  let applying = false;
  let disposed = false;
  const emit = (): void => { for (const listener of [...listeners]) listener(); };
  const mode = (): LayerPersist => ports.persist ? "schedule" : "memory";

  function applyStored(): void {
    const handle = ports.controller.handle();
    if (!handle || !identity) return;
    applying = true;
    try {
      for (const edit of store.edits(identity.sceneId, identity.sceneUrl)) {
        const published = authored.get(edit.entityId);
        if (!published) continue;
        if (published === edit.layerId) { store.remove(identity.sceneId, identity.sceneUrl, edit.entityId, mode()); continue; }
        handle.movePanorama(edit.entityId, edit.layerId);
      }
    } finally { applying = false; }
  }

  function remember(status: SceneStatus): void {
    if (!identity || status.sceneId !== identity.sceneId || status.revision !== identity.revision) return;
    const live = membership(status);
    const saved = store.edits(identity.sceneId, identity.sceneUrl);
    for (const [entityId, authoredLayerId] of authored) {
      const layerId = live.get(entityId);
      if (!layerId || layerId === authoredLayerId) {
        if (saved.some(edit => edit.entityId === entityId)) store.remove(identity.sceneId, identity.sceneUrl, entityId, mode());
        continue;
      }
      {
        const edit: LayerEditRecord = {
          entityId, title: titles.get(entityId) ?? entityId, layerId, authoredLayerId,
          authoredRevision: identity.revision, updatedAt: new Date().toISOString(),
        };
        const previous = store.edits(identity.sceneId, identity.sceneUrl).find(item => item.entityId === entityId);
        if (previous && previous.layerId === layerId && previous.authoredLayerId === authoredLayerId) continue;
        store.assign(identity.sceneId, identity.sceneUrl, previous && previous.layerId === layerId ? previous : edit, mode());
      }
    }
  }

  const originalLoad = ports.controller.load.bind(ports.controller);
  ports.controller.load = async (input, loadOptions) => {
    if (disposed) return false;
    if (ports.persist) store.flush();
    else store.cancelPending();
    const url = resolveLoadUrl(ports.controller, ports.baseUrl, input, loadOptions?.exampleId);
    const ok = await originalLoad(input, loadOptions);
    if (disposed) return ok;
    const status = ports.controller.state().status;
    const sceneUrl = url ? canonicalSceneUrl(url, ports.baseUrl) : null;
    if (!ok || !sceneUrl || !status?.sceneId) { identity = null; authored = new Map(); titles = new Map(); emit(); return ok; }
    identity = { sceneId: status.sceneId, sceneUrl, revision: status.revision };
    authored = membership(status);
    titles = new Map(status.entries.map(entry => [entry.id, entry.title]));
    applyStored();
    emit();
    return ok;
  };

  const off = ports.controller.subscribe(state => {
    if (applying || disposed || !state.status) return;
    remember(state.status);
    emit();
  });

  return {
    count() { return identity ? store.edits(identity.sceneId, identity.sceneUrl).length : 0; },
    note() {
      const count = identity ? store.edits(identity.sceneId, identity.sceneUrl).length : 0;
      const status = store.status();
      const photographs = count === 1 ? "1 photograph is in a different layer." : `${count} photographs are in different layers.`;
      const kept = status.messages[0] ?? (status.persistence === "session" ? "They stay in this session until you download them." : "They are saved in this browser. Download keeps a copy.");
      return `${photographs} ${kept}`;
    },
    exportDocument() {
      store.flush();
      const exported = store.exportDocument(new Date().toISOString());
      const disclosures = [...exported.disclosures];
      if (identity) {
        const stale = store.edits(identity.sceneId, identity.sceneUrl).filter(edit => {
          const published = authored.get(edit.entityId);
          return published !== undefined && published !== edit.authoredLayerId && published !== edit.layerId;
        }).map(edit => edit.entityId);
        if (stale.length) disclosures.push(`Based on an older layer: ${stale.join(", ")}.`);
        const unknown = store.edits(identity.sceneId, identity.sceneUrl).filter(edit => !authored.has(edit.entityId)).map(edit => edit.entityId);
        if (unknown.length) disclosures.push(`Kept corrections for photographs this scene does not show: ${unknown.join(", ")}.`);
      }
      return { text: exported.text, filename: layerExportFilename(ports.exportPrefix, exported.document.exportedAt), disclosures };
    },
    reset() {
      const handle = ports.controller.handle();
      if (!identity || !handle) return;
      applying = true;
      try {
        for (const [entityId, layerId] of authored) handle.movePanorama(entityId, layerId);
        store.clearScene(identity.sceneId, identity.sceneUrl, ports.persist ? "now" : "memory");
      } finally { applying = false; }
      emit();
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    flush() { store.flush(); },
    observeExternal(raw) {
      store.observeExternal(raw);
      const handle = ports.controller.handle();
      if (!identity || !handle) { emit(); return; }
      applying = true;
      try {
        for (const [entityId, layerId] of authored) handle.movePanorama(entityId, layerId);
        applyStored();
      } finally { applying = false; }
      emit();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (ports.persist) store.dispose();
      else store.cancelPending();
      off();
      ports.controller.load = originalLoad;
      listeners.clear();
    },
  };
}
