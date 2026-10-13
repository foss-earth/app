/** The photograph tab's title while its place is being edited, including from the map. */
let title: string | null = null;
const listeners = new Set<() => void>();
let stopEditing: (() => void) | null = null;

export function poseEditTitle(): string | null {
  return title;
}

export function setPoseEditTitle(next: string | null): void {
  if (title === next) return;
  title = next;
  for (const listener of listeners) listener();
}

export function subscribePoseEditTitle(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The editor registers this so closing the photograph's tab leaves editing. */
export function bindPoseEditStop(stop: () => void): () => void {
  stopEditing = stop;
  return () => { if (stopEditing === stop) stopEditing = null; };
}

export function requestPoseEditStop(): void {
  stopEditing?.();
}
