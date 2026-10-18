/**
 * Startup marks that a measurement reads with `performance.getEntriesByName`
 * (docs/proposals/startup-loading.md, Acceptance). `boot:html` is set by the
 * HTML's first inline script (`browserRecovery` in `@foss-earth/ui/vite`).
 * `boot:globe` is the first frame that draws the globe's ground, and
 * `boot:content` the first that draws what the page is for: a tour's scene on
 * the globe, an aircraft, or for the app alone the opening view with no tile
 * missing.
 */
export type BootMark = "boot:modules" | "boot:renderer" | "boot:first-frame" | "boot:globe" | "boot:content" | "boot:settled";

/** Marks a step once per page, so a host started again (a new scene host, a hot reload) keeps the first. */
export function markBoot(name: BootMark, options: { startTime?: number; detail?: unknown } = {}): void {
  try {
    if (performance.getEntriesByName(name, "mark").length === 0) performance.mark(name, options);
  } catch { /* marks are for measurement only */ }
}

/** Rendered frames: a scene's `onAfterRenderObservable`. */
export interface BootFrames {
  onFrame(listener: () => void): () => void;
}

/**
 * Marks `name` after the first rendered frame for which `drawn()` holds, so
 * the mark is when the screen first showed it. Returns the stop of the watch,
 * which also ends once it has marked.
 */
export function markBootOnFrame(name: BootMark, frames: BootFrames, drawn: () => boolean): () => void {
  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    off();
  };
  const off = frames.onFrame(() => {
    if (stopped || !drawn()) return;
    markBoot(name);
    stop();
  });
  return stop;
}

/** Frames must stop this long for the scene to count as settled. */
export const SETTLED_QUIET_MS = 1000;

export interface RenderActivity {
  isRendering(): boolean;
  onActiveRenderChange(listener: (active: boolean) => void): () => void;
}
export interface SettledClock {
  now(): number;
  setTimeout(callback: () => void, ms: number): number;
  clearTimeout(handle: number): void;
}

/**
 * Marks `boot:settled` at the moment frames stopped for the first whole quiet
 * second after the first frame: tiles streaming in hold frames until they are
 * done, then calls `onSettled`. Returns the stop of the watch, which also ends
 * once it has marked.
 */
export function markBootSettled(activity: RenderActivity, clock: SettledClock, onSettled?: () => void): () => void {
  let idleSince: number | null = activity.isRendering() ? null : clock.now();
  let timer = 0;
  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    clock.clearTimeout(timer);
    off();
  };
  const arm = (): void => {
    clock.clearTimeout(timer);
    if (idleSince === null || stopped) return;
    timer = clock.setTimeout(() => {
      // Quiet before the first frame is a scene still loading, not a settled one.
      if (performance.getEntriesByName("boot:first-frame", "mark").length === 0) { idleSince = clock.now(); arm(); return; }
      markBoot("boot:settled", { startTime: idleSince! });
      stop();
      onSettled?.();
    }, SETTLED_QUIET_MS);
  };
  const off = activity.onActiveRenderChange(active => {
    idleSince = active ? null : clock.now();
    arm();
  });
  arm();
  return stop;
}
