/**
 * The id of the `<script type="application/json">` in which `lazyFeatures()` (foss-earth/vite) names, for each
 * lazy feature a built page can load, the chunks it fetches that the page has not: `{ [id]: LazyFeatureChunks }`.
 * Development pages have none, and prefetching there does nothing.
 */
export const LAZY_FEATURES_ELEMENT_ID = "foss-earth-lazy-features";

export interface LazyFeatureChunks {
  /** The feature's chunk first, then the chunks it imports statically, as the page's URLs. */
  urls: string[];
  /** Their size as built, before compression. */
  bytes: number;
}
