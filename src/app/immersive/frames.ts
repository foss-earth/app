/**
 * One frame authority for the render scheduler that a headset can take over.
 * A browser stops window animation frames while an immersive session presents,
 * so the scheduler's frames move to the session's while it does.
 */

export type FrameCallback = (time: number) => void;

export interface FrameSource {
  requestFrame(callback: FrameCallback): number;
  cancelFrame(handle: number): void;
}

export interface ImmersiveFrames {
  /** The scheduler's frame port. */
  readonly port: FrameSource;
  /** Whether a headset session supplies the frames. */
  readonly presenting: boolean;
  /** Moves every waiting frame to `source`, or back to the window with null. */
  present(source: FrameSource | null): void;
  /** Hidden only when the page is hidden and no headset is presenting it. */
  isHidden(pageHidden: () => boolean): boolean;
  /** The page's visibility changes, and the headset's start and end. */
  onVisibilityChange(page: (listener: () => void) => () => void, listener: () => void): () => void;
}

export function createImmersiveFrames(window: FrameSource): ImmersiveFrames {
  let headset: FrameSource | null = null;
  let next = 1;
  type Waiting = { callback: FrameCallback; source: FrameSource; handle: number };
  const waiting = new Map<number, Waiting>();
  const visibility = new Set<() => void>();
  const register = (id: number, entry: Waiting): void => {
    const source = headset ?? window;
    entry.source = source;
    entry.handle = source.requestFrame(time => {
      // A frame moved to another source is delivered only there.
      if (waiting.get(id) !== entry || entry.source !== source) return;
      waiting.delete(id);
      entry.callback(time);
    });
  };
  return {
    port: {
      requestFrame(callback) {
        const id = next++;
        const entry: Waiting = { callback, source: window, handle: 0 };
        waiting.set(id, entry);
        try { register(id, entry); } catch (error) { waiting.delete(id); throw error; }
        return id;
      },
      cancelFrame(id) {
        const entry = waiting.get(id);
        if (!entry) return;
        waiting.delete(id);
        entry.source.cancelFrame(entry.handle);
      },
    },
    get presenting() { return headset !== null; },
    present(source) {
      if (source === headset) return;
      const moving = [...waiting];
      for (const [, entry] of moving) entry.source.cancelFrame(entry.handle);
      headset = source;
      for (const [id, entry] of moving) register(id, entry);
      for (const listener of [...visibility]) listener();
    },
    isHidden: pageHidden => headset === null && pageHidden(),
    onVisibilityChange(page, listener) {
      visibility.add(listener);
      const off = page(listener);
      return () => { visibility.delete(listener); off(); };
    },
  };
}
