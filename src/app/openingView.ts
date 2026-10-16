/**
 * Where a photograph opens. The mode lives in settings; the remembered looks
 * live here, apart from place and layer corrections.
 */
export const OPENING_STORAGE_KEY = "foss-earth.opening-view.v1";
const COALESCE_MS = 300;
const IMAGE_CAP = 120;

export type OpeningMode = "enter" | "last" | "image" | "fixed";

export interface OpeningLook {
  headingDeg: number;
  pitchDeg: number;
  verticalFovDeg: number;
}

/** A map arrival keeps its flight direction. Explicit caller views, such as history restoration, still take precedence. */
export function openingOptions<T extends object>(options: T | undefined, remembered: OpeningLook | null, fromMap = false): T | { view: OpeningLook } | undefined {
  if (options && "view" in options && options.view) return options;
  if (fromMap) return options;
  return remembered ? { ...options, view: remembered } : options;
}

export function lookUpOpening(pitch: { min: number; max: number }, set: (id: string, value: number | OpeningMode) => void): void {
  set("scene.panorama.openingHeading", 0);
  set("scene.panorama.openingPitch", Math.max(pitch.min, pitch.max));
  set("scene.panorama.openingView", "fixed");
}

export interface OpeningStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface Memory {
  last: OpeningLook | null;
  images: Map<string, OpeningLook>;
}

function lookOf(value: unknown): OpeningLook | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { headingDeg?: unknown; pitchDeg?: unknown; verticalFovDeg?: unknown };
  const headingDeg = record.headingDeg;
  const pitchDeg = record.pitchDeg;
  const verticalFovDeg = record.verticalFovDeg;
  if (typeof headingDeg !== "number" || typeof pitchDeg !== "number" || typeof verticalFovDeg !== "number") return null;
  if (![headingDeg, pitchDeg, verticalFovDeg].every(Number.isFinite)) return null;
  return { headingDeg, pitchDeg, verticalFovDeg };
}

function read(storage: OpeningStorage | null): Memory {
  const memory: Memory = { last: null, images: new Map() };
  if (!storage) return memory;
  let parsed: unknown;
  try { parsed = JSON.parse(storage.getItem(OPENING_STORAGE_KEY) ?? ""); } catch { return memory; }
  if (!parsed || typeof parsed !== "object") return memory;
  const record = parsed as { last?: unknown; images?: unknown };
  memory.last = lookOf(record.last);
  if (record.images && typeof record.images === "object") {
    for (const [id, value] of Object.entries(record.images)) {
      const look = lookOf(value);
      if (id && look) memory.images.set(id, look);
    }
  }
  return memory;
}

function same(a: OpeningLook | null, b: OpeningLook): boolean {
  return Boolean(a) && Math.abs(a!.headingDeg - b.headingDeg) < 0.05 && Math.abs(a!.pitchDeg - b.pitchDeg) < 0.05 && Math.abs(a!.verticalFovDeg - b.verticalFovDeg) < 0.05;
}

export function createOpeningViews(options: {
  storage: OpeningStorage | null;
  schedule(run: () => void, ms: number): { cancel(): void };
}): {
  resolve(mode: OpeningMode, id: string, fixed: OpeningLook | null): OpeningLook | null;
  remember(id: string, look: OpeningLook): void;
  flush(): void;
  dispose(): void;
} {
  const memory = read(options.storage);
  let pending: { cancel(): void } | null = null;
  let disposed = false;

  const write = (): void => {
    pending = null;
    if (disposed || !options.storage) return;
    const images: Record<string, OpeningLook> = {};
    for (const [id, look] of memory.images) images[id] = look;
    try { options.storage.setItem(OPENING_STORAGE_KEY, JSON.stringify({ last: memory.last, images })); } catch { /* The session still has the looks. */ }
  };

  const schedule = (): void => {
    if (disposed || pending) return;
    pending = options.schedule(write, COALESCE_MS);
  };

  return {
    resolve(mode, id, fixed) {
      if (mode === "fixed") return fixed;
      if (mode === "last") return memory.last;
      if (mode === "image") return memory.images.get(id) ?? null;
      return null;
    },
    remember(id, look) {
      if (disposed || !id || same(memory.images.get(id) ?? null, look) && same(memory.last, look)) return;
      memory.last = look;
      memory.images.set(id, look);
      while (memory.images.size > IMAGE_CAP) {
        const oldest = memory.images.keys().next().value;
        if (oldest === undefined) break;
        memory.images.delete(oldest);
      }
      schedule();
    },
    flush() {
      pending?.cancel();
      pending = null;
      write();
    },
    dispose() {
      if (disposed) return;
      pending?.cancel();
      pending = null;
      write();
      disposed = true;
    },
  };
}
