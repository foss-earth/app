import type { NavigationSnapshot } from "@foss-earth/engine";
import type { OpeningLook } from "./openingView";
interface Storage { getItem(key: string): string | null; setItem(key: string, value: string): void }
interface SavedView { version: 1; globe: NavigationSnapshot; panorama: { sceneId: string; id: string; look: OpeningLook } | null }
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const finite = (...values: unknown[]): boolean => values.every(value => typeof value === "number" && Number.isFinite(value));
function snapshot(value: unknown): value is NavigationSnapshot {
  if (!object(value) || value.version !== 1 || !object(value.camera) || !object(value.view) || !object(value.camera.center)) return false;
  const c = value.camera, p = c.center as Record<string, unknown>, v = value.view;
  return finite(p.x, p.y, p.z, c.yaw, c.pitch, c.radius, c.fov, v.latDeg, v.lonDeg, v.headingDeg, v.pitchDeg, v.zoomMeters) &&
    Math.abs(v.latDeg as number) <= 90 && Math.abs(v.lonDeg as number) <= 180 && (c.radius as number) > 0 &&
    (c.fov as number) > 0 && (c.fov as number) < Math.PI && (c.pitch as number) >= 0 && (c.pitch as number) <= Math.PI;
}
function look(value: unknown): value is OpeningLook {
  return object(value) && finite(value.headingDeg, value.pitchDeg, value.verticalFovDeg) && Math.abs(value.pitchDeg as number) <= 90 && (value.verticalFovDeg as number) > 0 && (value.verticalFovDeg as number) < 180;
}
function read(storage: Storage | null, key: string): SavedView | null {
  try {
    const value: unknown = JSON.parse(storage?.getItem(key) ?? "null");
    if (!object(value) || value.version !== 1 || !snapshot(value.globe)) return null;
    const p = value.panorama;
    const panorama = object(p) && typeof p.sceneId === "string" && typeof p.id === "string" && look(p.look) ? { sceneId: p.sceneId, id: p.id, look: p.look } : null;
    return { version: 1, globe: value.globe, panorama };
  } catch { return null; }
}
/** Save from existing drawn frames; this owns no render loop or camera animation. */
export function createViewSession(options: {
  storage: Storage | null; key: string;
  capture(): NavigationSnapshot | null;
  restore(snapshot: NavigationSnapshot): boolean;
  held(): boolean;
  panorama(): { sceneId: string; phase: string; active: string | null; view?: OpeningLook | null } | null;
  schedule(run: () => void, ms: number): { cancel(): void };
}) {
  const saved = read(options.storage, options.key);
  let current: SavedView | null = saved;
  let written = saved ? JSON.stringify(saved) : null;
  let pending: { cancel(): void } | null = null;
  let started = false, disposed = false;
  const captureCurrent = (): void => {
    const captured = options.held() ? null : options.capture();
    const globe = snapshot(captured) ? captured : current?.globe;
    if (!globe) return;
    let panorama = current?.panorama ?? null;
    const p = options.panorama();
    if (p?.phase === "overview") panorama = null;
    else if (p?.phase === "immersive" && p.active && look(p.view)) panorama = { sceneId: p.sceneId, id: p.active, look: p.view };
    current = { version: 1, globe, panorama };
  };
  const flush = (): void => {
    pending?.cancel(); pending = null;
    if (!started || disposed) return;
    captureCurrent();
    if (!current) return;
    const text = JSON.stringify(current);
    if (text === written) return;
    try { options.storage?.setItem(options.key, text); written = text; } catch { /* The current session still works. */ }
  };
  const observe = (): void => {
    if (!started || disposed) return;
    captureCurrent();
    if (!pending) pending = options.schedule(flush, 300);
  };
  return {
    saved,
    restoreGlobe: () => Boolean(saved && options.restore(saved.globe)),
    start() { started = true; observe(); },
    observe, flush,
    dispose() { if (disposed) return; flush(); disposed = true; },
  };
}
