/**
 * Code on demand (docs/proposals/startup-loading.md, section 1): a feature a visitor does not see on the first
 * frame is loaded with import(), and declares when it may be fetched early. Fetching early adds
 * `<link rel="modulepreload">` for its chunks, so nothing runs before `load()`.
 *
 * - `intent`: when the pointer or focus reaches the button of a tab the feature belongs to (`tabs`).
 * - `idle`: after the scene has settled, while the page is idle, and on intent too.
 * - `never`: only when it is used.
 *
 * The build names each feature's chunks in the page (`lazyFeatures()` in foss-earth/vite), from the
 * `defineLazyFeature({ id: "…", …, load: () => import("…") })` calls it finds, so `id` and `load` must be
 * written as literals there.
 */
import { wantsDev } from "@foss-earth/dev";
import { LAZY_FEATURES_ELEMENT_ID, type LazyFeatureChunks } from "./lazyFeatureChunks";

export type LazyPrefetch = "intent" | "idle" | "never";

export interface LazyFeatureOptions<T> {
  id: string;
  /** What the dev log calls it: "Loaded {label} (42 KB)". The id when absent. */
  label?: string;
  prefetch: LazyPrefetch;
  /** True: `never` unless the page is a `?dev=1` one. */
  devOnly?: boolean;
  /** The tabs whose buttons show intent. */
  tabs?: readonly string[];
  load(): Promise<T>;
}

export interface LazyFeature<T> {
  readonly id: string;
  /** Memoized; a failed load is tried again on the next call. */
  load(): Promise<T>;
  /** Queues the feature's chunks for fetching, once. */
  prefetch(): void;
}

export interface LazyFeatureEnvironment {
  document: Document;
  search: string;
  connection(): { saveData?: boolean; effectiveType?: string } | undefined;
  /** Runs the callback when the page is idle. */
  idle(callback: () => void): void;
}

interface Defined {
  id: string;
  label: string;
  prefetch: LazyPrefetch;
  tabs: readonly string[];
  queue(front: boolean): void;
}

/** Connections on which nothing is fetched before it is used. */
const SLOW = new Set(["slow-2g", "2g"]);

export function createLazyFeatures(environment: () => LazyFeatureEnvironment) {
  const features: Defined[] = [];
  let chunks: Record<string, LazyFeatureChunks> | null = null;
  let log: ((text: string) => void) | null = null;
  let idleStarted = false;
  let watching = false;
  // Prefetching takes one chunk at a time; intent goes before idle.
  const pending: { url: string; urgent: boolean }[] = [];
  const requested = new Set<string>();
  let busy = false;

  const env = (): LazyFeatureEnvironment => environment();
  const chunksOf = (id: string): LazyFeatureChunks | undefined => {
    if (!chunks) {
      chunks = {};
      try {
        const text = env().document.getElementById(LAZY_FEATURES_ELEMENT_ID)?.textContent;
        if (text) chunks = JSON.parse(text) as Record<string, LazyFeatureChunks>;
      } catch { /* No map: prefetching does nothing. */ }
    }
    return chunks[id];
  };
  const skipped = (): boolean => {
    const connection = env().connection();
    return connection?.saveData === true || SLOW.has(connection?.effectiveType ?? "");
  };
  const pump = (): void => {
    const { document } = env();
    if (busy || pending.length === 0) return;
    // Resumed by visibilitychange.
    if (document.visibilityState === "hidden") return;
    if (skipped()) { pending.length = 0; return; }
    const next = pending[0]!;
    const fetchOne = (): void => {
      if (busy || pending[0] !== next || document.visibilityState === "hidden") return;
      pending.shift();
      busy = true;
      const link = document.createElement("link");
      link.rel = "modulepreload";
      link.crossOrigin = "";
      link.href = next.url;
      const done = (): void => { link.removeEventListener("load", done); link.removeEventListener("error", done); busy = false; pump(); };
      link.addEventListener("load", done);
      link.addEventListener("error", done);
      document.head.append(link);
    };
    if (next.urgent) fetchOne();
    else env().idle(fetchOne);
  };
  const enqueue = (urls: readonly string[], urgent: boolean): void => {
    const { document } = env();
    // Vite preloads a chunk's imports itself when it imports the chunk.
    const preloaded = new Set([...document.querySelectorAll<HTMLLinkElement>('link[rel="modulepreload"]')].map(link => link.href));
    const fresh = urls.filter(url => !requested.has(url) && !preloaded.has(new URL(url, document.baseURI).href));
    for (const url of fresh) requested.add(url);
    const items = fresh.map(url => ({ url, urgent }));
    if (urgent) pending.unshift(...items);
    else pending.push(...items);
    if (!watching) {
      watching = true;
      document.addEventListener("visibilitychange", pump);
    }
    pump();
  };

  function define<T>(options: LazyFeatureOptions<T>): LazyFeature<T> {
    let loading: Promise<T> | null = null;
    const prefetch = (): LazyPrefetch => (options.devOnly && !wantsDev(env().search) ? "never" : options.prefetch);
    const queue = (urgent: boolean): void => {
      const found = chunksOf(options.id);
      if (found) enqueue(found.urls, urgent);
    };
    const feature: Defined = { id: options.id, label: options.label ?? options.id, get prefetch() { return prefetch(); }, tabs: options.tabs ?? [], queue };
    features.push(feature);
    if (idleStarted && feature.prefetch === "idle") queue(false);
    return {
      id: options.id,
      load() {
        loading ??= options.load().then(module => {
          const bytes = chunksOf(options.id)?.bytes;
          if (log && bytes !== undefined) log(`Loaded ${feature.label} (${Math.max(1, Math.round(bytes / 1000))} KB)`);
          return module;
        }, (error: unknown) => {
          loading = null;
          throw error;
        });
        return loading;
      },
      prefetch() { if (feature.prefetch !== "never") queue(true); },
    };
  }

  return {
    define,
    /** Starts fetching the `idle` features, in the order they were defined: call it once the scene has settled. */
    startIdle(): void {
      if (idleStarted) return;
      idleStarted = true;
      for (const feature of features) if (feature.prefetch === "idle") feature.queue(false);
    },
    /** Fetches a tab's features when the pointer or focus reaches its button (`data-tab-id`). */
    watchTabIntent(root: Document | HTMLElement): () => void {
      const onIntent = (event: Event): void => {
        const tab = (event.target as Element | null)?.closest?.("[data-tab-id]")?.getAttribute("data-tab-id");
        if (!tab) return;
        for (const feature of features) if (feature.prefetch !== "never" && feature.tabs.includes(tab)) feature.queue(true);
      };
      root.addEventListener("pointerover", onIntent, { passive: true });
      root.addEventListener("focusin", onIntent);
      return () => {
        root.removeEventListener("pointerover", onIntent);
        root.removeEventListener("focusin", onIntent);
      };
    },
    /** Where "Loaded … (… KB)" goes: the game log on a `?dev=1` page. Null stops it. */
    setLog(next: ((text: string) => void) | null): void { log = next; },
  };
}

type IdleWindow = Window & { requestIdleCallback?(callback: () => void, options?: { timeout: number }): number };

const browser = createLazyFeatures(() => ({
  document: window.document,
  search: window.location.search,
  connection: () => (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection,
  idle(callback) {
    const idleWindow = window as IdleWindow;
    if (idleWindow.requestIdleCallback) idleWindow.requestIdleCallback(callback, { timeout: 5000 });
    else window.setTimeout(callback, 200);
  },
}));

export const defineLazyFeature = browser.define;
export const startIdlePrefetch = browser.startIdle;
export const watchTabIntent = browser.watchTabIntent;
export const setLazyFeatureLog = browser.setLog;
