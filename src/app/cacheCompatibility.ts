/** Legacy no-argument inspection borrows the active Earth host's actual stores. */
import type { createMapCache } from "@foss-earth/engine/browser";
type MapCache = ReturnType<typeof createMapCache>;
import type { MediaStore } from "@foss-earth/images";
export type { MapCacheSnapshot, MapCacheEntry } from "@foss-earth/engine/browser";
const maps: MapCache[] = [];
const media: MediaStore[] = [];
function bind<T>(list: T[], value: T): () => void {
  list.push(value);
  return () => { const at = list.lastIndexOf(value); if (at >= 0) list.splice(at, 1); };
}
function active<T>(list: readonly T[], name: string): T {
  const value = list.at(-1);
  if (!value) throw new Error(`No active Earth ${name} host. Supply the owner's explicit store port.`);
  return value;
}
export const bindEarthMapCache = (cache: MapCache) => bind(maps, cache);
export const bindEarthSceneMedia = (store: MediaStore) => bind(media, store);
export const inspectMapCache = () => active(maps, "map cache").inspect();
export const clearMapCache = () => active(maps, "map cache").clear();
export const inspectSceneMedia = () => active(media, "image storage").inspect();
export const clearSceneMedia = () => active(media, "image storage").clear();
