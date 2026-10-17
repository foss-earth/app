/**
 * Startup marks that a measurement reads with `performance.getEntriesByName`
 * (docs/proposals/startup-loading.md, Acceptance). `boot:html` is set by the
 * HTML's first inline script (`browserRecovery` in `@foss-earth/ui/vite`).
 */
export type BootMark = "boot:modules" | "boot:renderer" | "boot:first-frame" | "boot:settled";

/** Marks a step once per page, so a host started again (a new scene host, a hot reload) keeps the first. */
export function markBoot(name: BootMark, options: { startTime?: number; detail?: unknown } = {}): void {
  try {
    if (performance.getEntriesByName(name, "mark").length === 0) performance.mark(name, options);
  } catch { /* marks are for measurement only */ }
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
 * done. Returns the stop of the watch, which also ends once it has marked.
 */
export function markBootSettled(activity: RenderActivity, clock: SettledClock): () => void {
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
    }, SETTLED_QUIET_MS);
  };
  const off = activity.onActiveRenderChange(active => {
    idleSince = active ? null : clock.now();
    arm();
  });
  arm();
  return stop;
}
