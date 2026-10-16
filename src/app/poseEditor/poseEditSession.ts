/** The photograph this tab was editing, separate from the persistent pose corrections. */
interface SceneIdentity { sceneId: string; sceneUrl: string }
interface SavedSelection extends SceneIdentity { version: 1; entityId: string }
interface SessionStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }

export function createPoseEditSession(storage: SessionStorage | null, key: string) {
  let saved: SavedSelection | null = null;
  try {
    const value: unknown = JSON.parse(storage?.getItem(key) ?? "null");
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      if (record.version === 1 && [record.sceneId, record.sceneUrl, record.entityId].every(item => typeof item === "string" && item.trim().length > 0)) {
        saved = record as unknown as SavedSelection;
      }
    }
  } catch { /* Editing still works without session storage. */ }
  return {
    selected(scene: SceneIdentity): string | null {
      return saved?.sceneId === scene.sceneId && saved.sceneUrl === scene.sceneUrl ? saved.entityId : null;
    },
    select(scene: SceneIdentity, entityId: string | null): void {
      saved = entityId ? { version: 1, sceneId: scene.sceneId, sceneUrl: scene.sceneUrl, entityId } : null;
      try { storage?.setItem(key, JSON.stringify(saved)); } catch { /* The current edit remains available. */ }
    },
  };
}
