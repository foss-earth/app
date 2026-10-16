import { sceneManifestUrl, type SceneController, type SceneHandle, type SceneStatus } from "@foss-earth/scenes/browser";
import { canonicalSceneUrl } from "../poseEditor/poseStore";

export const LINK_STORAGE_KEY = "foss-earth.link-overrides.v1";
export const LINK_FORMAT = "foss-earth-link-overrides";
export interface ImageLink { target: string; label: string; direction?: { headingDeg: number; pitchDeg: number } }
export interface LinkEdit { entityId: string; title: string; links: ImageLink[]; authoredRevision: string; updatedAt: string }
interface LinkScene { sceneId: string; sceneUrl: string; edits: LinkEdit[] }
interface LinkDocument { format: typeof LINK_FORMAT; version: 1; scenes: LinkScene[] }
interface LinkPorts { controller: SceneController; baseUrl: string; storage: Storage | null; exportPrefix?: string; nowIso?(): string }
export type LinkOverrides = ReturnType<typeof createLinkOverrides>;
const empty = (): LinkDocument => ({ format: LINK_FORMAT, version: 1, scenes: [] });
const text = (value: unknown): value is string => typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= 500;
const iso = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;

/** Untrusted browser storage must never produce arbitrary destinations or directions. */
export function parseLinkDocument(raw: string): LinkDocument | null {
  try {
    if (raw.length > 4_000_000) return null;
    const value = JSON.parse(raw);
    if (value?.format !== LINK_FORMAT || value.version !== 1 || !Array.isArray(value.scenes)) return null;
    const scenes = new Set<string>();
    for (const scene of value.scenes) {
      if (!scene || !text(scene.sceneId) || !text(scene.sceneUrl) || canonicalSceneUrl(scene.sceneUrl, scene.sceneUrl) !== scene.sceneUrl || !Array.isArray(scene.edits)) return null;
      const key = `${scene.sceneId}\n${scene.sceneUrl}`;
      if (scenes.has(key)) return null;
      scenes.add(key);
      const ids = new Set<string>();
      for (const edit of scene.edits) {
        if (!edit || !text(edit.entityId) || !text(edit.title) || !text(edit.authoredRevision) || !iso(edit.updatedAt) || !Array.isArray(edit.links) || ids.has(edit.entityId)) return null;
        ids.add(edit.entityId);
        const targets = new Set<string>();
        for (const link of edit.links) {
          if (!link || !text(link.target) || link.target === edit.entityId || !text(link.label) || targets.has(link.target)) return null;
          targets.add(link.target);
          const d = link.direction;
          if (d !== undefined && (!d || !Number.isFinite(d.headingDeg) || d.headingDeg < 0 || d.headingDeg >= 360 || !Number.isFinite(d.pitchDeg) || Math.abs(d.pitchDeg) > 90)) return null;
        }
      }
    }
    // Keep only declared fields on the next write/export.
    return { format: LINK_FORMAT, version: 1, scenes: value.scenes.map((scene: LinkScene) => ({ sceneId: scene.sceneId, sceneUrl: scene.sceneUrl,
      edits: scene.edits.map(edit => ({ entityId: edit.entityId, title: edit.title, authoredRevision: edit.authoredRevision, updatedAt: edit.updatedAt,
        links: edit.links.map(link => ({ target: link.target, label: link.label, ...(link.direction ? { direction: { headingDeg: link.direction.headingDeg, pitchDeg: link.direction.pitchDeg } } : {}) })) })) })) };
  } catch { return null; }
}

export function linkGeometry(from: { longitudeDeg: number; latitudeDeg: number; heightMeters: number | null }, to: typeof from) {
  const r = Math.PI / 180, a = from.latitudeDeg * r, b = to.latitudeDeg * r, d = (to.longitudeDeg - from.longitudeDeg) * r;
  const h = Math.sin((b - a) / 2) ** 2 + Math.cos(a) * Math.cos(b) * Math.sin(d / 2) ** 2;
  const distance = 6_371_000 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
  const headingDeg = (Math.atan2(Math.sin(d) * Math.cos(b), Math.cos(a) * Math.sin(b) - Math.sin(a) * Math.cos(b) * Math.cos(d)) / r + 360) % 360;
  const pitchDeg = from.heightMeters !== null && to.heightMeters !== null ? Math.atan2(to.heightMeters - from.heightMeters, Math.max(distance, .01)) / r : 0;
  return { distance, direction: { headingDeg, pitchDeg } };
}

function directed(from: SceneStatus["entries"][number], to: SceneStatus["entries"][number], label: string): ImageLink {
  const geometry = from.capture && to.capture ? linkGeometry(from.capture, to.capture) : null;
  return { target: to.id, label, ...(geometry && geometry.distance > .1 ? { direction: geometry.direction } : {}) };
}

/** Additions are scoped to one scene URL; authored links always remain available. */
export function createLinkOverrides(ports: LinkPorts) {
  let saved: string | null = null, document = empty(), blocked = false, note = "", sessionOnly = !ports.storage;
  const now = ports.nowIso ?? (() => new Date().toISOString());
  try {
    saved = ports.storage?.getItem(LINK_STORAGE_KEY) ?? null;
    if (saved !== null) { const parsed = parseLinkDocument(saved); if (parsed) document = parsed; else { blocked = true; note = "Saved links could not be read. Download preserves this session's links; the saved data will not be overwritten."; } }
  } catch { sessionOnly = true; }
  let bound: SceneHandle | null = null, identity: { sceneId: string; sceneUrl: string; revision: string } | null = null;
  let authored = new Map<string, Set<string>>(), applied = new Set<string>(), loading = false, epoch = 0, disposed = false;
  const listeners = new Set<() => void>();
  const emit = () => { for (const listener of [...listeners]) listener(); };
  const scene = () => identity ? document.scenes.find(s => s.sceneId === identity!.sceneId && s.sceneUrl === identity!.sceneUrl) : undefined;
  const canEdit = () => !disposed && !loading && !!identity && bound === ports.controller.handle();
  function persist() {
    if (blocked || sessionOnly || !ports.storage) return;
    try {
      if (ports.storage.getItem(LINK_STORAGE_KEY) !== saved) { blocked = true; note = "Links changed in another tab. Download this session's links before reloading."; return; }
      const raw = JSON.stringify(document);
      ports.storage.setItem(LINK_STORAGE_KEY, raw); saved = raw;
    } catch { sessionOnly = true; }
  }
  /** Drops saved additions this scene now authors, so they are not offered for removal or exported again. */
  function prunePublished() {
    const record = scene();
    if (!record) return;
    let pruned = false;
    for (const edit of record.edits) {
      const kept = edit.links.filter(link => !authored.get(edit.entityId)?.has(link.target));
      if (kept.length !== edit.links.length) { edit.links = kept; pruned = true; }
    }
    if (!pruned) return;
    record.edits = record.edits.filter(edit => edit.links.length);
    document.scenes = document.scenes.filter(s => s.edits.length);
    persist();
  }
  function apply() {
    if (!bound || !identity || bound !== ports.controller.handle()) return;
    const status = bound.status, edits = scene()?.edits ?? [], byId = new Map(status.entries.map(e => [e.id, e]));
    const sources = new Set([...applied, ...edits.map(edit => edit.entityId)]);
    for (const entry of status.entries.filter(entry => sources.has(entry.id))) {
      const links = edits.find(e => e.entityId === entry.id)?.links ?? [];
      // Directions follow this scene's captures, not ones saved with an older pose.
      bound.setAdditionalLinks(entry.id, links.flatMap(link => { const to = byId.get(link.target); return to?.supported ? [directed(entry, to, link.label)] : []; }));
    }
    applied = new Set(edits.map(edit => edit.entityId));
  }
  function assign(entityId: string, links: ImageLink[], status: SceneStatus) {
    if (!identity) return;
    let record = scene();
    if (!record) { record = { sceneId: identity.sceneId, sceneUrl: identity.sceneUrl, edits: [] }; document.scenes.push(record); }
    record.edits = record.edits.filter(e => e.entityId !== entityId);
    if (links.length) record.edits.push({ entityId, title: status.entries.find(e => e.id === entityId)!.title, links, authoredRevision: identity.revision, updatedAt: now() });
    document.scenes = document.scenes.filter(s => s.edits.length);
  }
  const originalLoad = ports.controller.load.bind(ports.controller);
  ports.controller.load = async (input, options) => {
    if (disposed) return false;
    const token = ++epoch;
    loading = true; emit();
    try {
      const example = options?.exampleId ? ports.controller.examples.find(e => e.id === input.trim()) : null;
      const url = canonicalSceneUrl(sceneManifestUrl(example?.url ?? input, ports.baseUrl).href, ports.baseUrl);
      const ok = await originalLoad(input, options);
      if (disposed || token !== epoch) return ok;
      const status = ports.controller.state().status;
      if (ok && url && status) {
        bound = ports.controller.handle(); applied = new Set(); identity = { sceneId: status.sceneId, sceneUrl: url, revision: status.revision };
        authored = new Map(status.entries.map(e => [e.id, new Set(e.links.filter(l => !l.externalDestination).map(l => l.target))]));
        prunePublished();
        apply();
      }
      return ok;
    } finally { if (!disposed && token === epoch) { loading = false; emit(); } }
  };
  return {
    ready: canEdit,
    additions: (id: string) => structuredClone(scene()?.edits.find(e => e.entityId === id)?.links ?? []),
    count: () => document.scenes.reduce((n, s) => n + s.edits.reduce((m, e) => m + e.links.length, 0), 0),
    note: () => note || (sessionOnly ? "Links stay in this session. Download a copy to keep them." : "Links are saved in this browser. Download a copy to add them to the tour."),
    add(source: string, target: string, bothWays: boolean) {
      if (!canEdit() || source === target) return false;
      const status = bound!.status, from = status.entries.find(e => e.id === source && e.supported), to = status.entries.find(e => e.id === target && e.supported);
      if (!from || !to) return false;
      let changed = false;
      for (const [a, b] of bothWays ? [[from, to], [to, from]] : [[from, to]]) {
        const links = scene()?.edits.find(e => e.entityId === a.id)?.links ?? [];
        if (authored.get(a.id)?.has(b.id) || links.some(l => l.target === b.id)) continue;
        assign(a.id, [...links, directed(a, b, b.title)], status); changed = true;
      }
      if (changed) { persist(); apply(); emit(); }
      return changed;
    },
    remove(source: string, target: string) {
      if (!canEdit()) return;
      assign(source, (scene()?.edits.find(e => e.entityId === source)?.links ?? []).filter(l => l.target !== target), bound!.status);
      persist(); apply(); emit();
    },
    reset() { if (!canEdit() || !identity) return; document.scenes = document.scenes.filter(s => s !== scene()); persist(); apply(); emit(); },
    exportDocument() {
      const exportedAt = now(), prefix = ports.exportPrefix && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(ports.exportPrefix) ? ports.exportPrefix : "foss-earth-links";
      return { text: JSON.stringify({ ...document, exportedAt }, null, 2) + "\n", filename: `${prefix}-${exportedAt.slice(0, 10)}.json` };
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose() { if (disposed) return; disposed = true; ++epoch; ports.controller.load = originalLoad; listeners.clear(); },
  };
}
