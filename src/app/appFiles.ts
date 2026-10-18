/**
 * Keeps the app's own files on this device (docs/app-files.md), as Settings
 * → App files → Keep the app's files asks: registers the service worker the
 * build's appFiles plugin (vite/appFiles.ts) wrote, or unregisters it and
 * deletes what it kept.
 */
import { createKeptFilesClient } from "@foss-earth/ui/browser";
import type { SettingsRegistry } from "@foss-earth/ui/settings";

/** Set by the appFiles Vite plugin: the worker's file at the build's root, or "" where there is none to keep files. */
declare const __FOSS_EARTH_APP_FILES__: string | undefined;
/** Set by the appFiles Vite plugin: whether the build's worker may isolate the page, "off" while developing. */
declare const __FOSS_EARTH_ISOLATION__: "off" | "report-only" | "enforce" | undefined;

export const KEEP_APP_FILES = "app.keepFiles";
/** Settings → App files → Cross-origin isolation (ui/src/browser/isolation.ts). */
export const APP_ISOLATION = "app.isolation";
/** Whether this build's worker may isolate its pages. */
export const BUILD_ISOLATION = typeof __FOSS_EARTH_ISOLATION__ === "string" ? __FOSS_EARTH_ISOLATION__ : "off";
export interface AppFilesStatus {
  /** Why nothing can be kept here, or null. */
  unavailable: string | null;
  /** A worker is installed for this page, and controls it now. */
  installed: boolean;
  controlling: boolean;
  /** The files it keeps and their bytes, of every version it has kept. */
  files: number;
  bytes: number;
}

/** The browser as appFiles uses it, so tests can stand in for it. */
export interface AppFilesEnvironment {
  /** The worker's address, or why there is none. */
  worker: { url: string } | { unavailable: string };
  /** What it controls: everything under the app's base, where its files are, so that the workers the app starts from there are answered too. */
  scope: string;
  container: Pick<ServiceWorkerContainer, "register" | "getRegistration" | "ready" | "controller"> | null;
  caches: Pick<CacheStorage, "open" | "has" | "delete"> | null;
  /** Calls `listener` with the app's files the page has loaded, then with each it loads later; returns a stop. */
  observeLoaded(listener: (urls: string[]) => void): () => void;
  /** Calls `listener` when another worker takes control of the page, as a new version does; returns a stop. */
  onControllerChange(listener: () => void): () => void;
  /** Runs `work` once the page has finished loading. */
  afterLoad(work: () => void): void;
}

export interface AppFilesKeeper {
  status(): Promise<AppFilesStatus>;
  /** Settles once the worker is registered, or removed, as the setting last asked. */
  settled(): Promise<void>;
  dispose(): void;
}

export function browserAppFilesEnvironment(): AppFilesEnvironment {
  const file = typeof __FOSS_EARTH_APP_FILES__ === "string" ? __FOSS_EARTH_APP_FILES__ : "";
  const secure = typeof window !== "undefined" && window.isSecureContext && typeof navigator !== "undefined" && "serviceWorker" in navigator && typeof caches !== "undefined";
  const base = typeof window === "undefined" ? null : new URL(import.meta.env.BASE_URL ?? "/", window.location.href);
  const worker = !file || !base
    ? { unavailable: "This build has no worker to keep its files: a development build, or an app that does not use FOSS Earth's appFiles plugin." }
    : !secure
      ? { unavailable: "This browser cannot keep the app's files for this page: it needs a secure (https) page with service workers, which some private windows turn off." }
      : { url: new URL(file, base).href };
  return {
    worker,
    scope: base?.pathname ?? "/",
    container: secure ? navigator.serviceWorker : null,
    caches: secure ? caches : null,
    observeLoaded(listener) {
      if (typeof PerformanceObserver === "undefined") return () => {};
      // The folder this module was built into holds the app's files; scene images and map tiles are elsewhere.
      // Resolved where the module runs, not at build time, which has no such file to point at.
      const folder = new URL(/* @vite-ignore */ ".", import.meta.url).href;
      const observer = new PerformanceObserver(list => {
        const urls = list.getEntries().map(entry => entry.name).filter(url => url.startsWith(folder));
        if (urls.length) listener(urls);
      });
      // Buffered: what loaded before the worker took over, too.
      observer.observe({ type: "resource", buffered: true });
      return () => observer.disconnect();
    },
    onControllerChange(listener) {
      if (!secure) return () => {};
      navigator.serviceWorker.addEventListener("controllerchange", listener);
      return () => navigator.serviceWorker.removeEventListener("controllerchange", listener);
    },
    afterLoad(work) {
      if (document.readyState === "complete") queueMicrotask(work);
      else window.addEventListener("load", () => work(), { once: true });
    },
  };
}

export function keepAppFiles(settings: SettingsRegistry, environment: AppFilesEnvironment = browserAppFilesEnvironment(), isolation: "off" | "report-only" | "enforce" = BUILD_ISOLATION): AppFilesKeeper {
  // Where the build's worker may isolate, its address carries both choices, as the page's first script asks for them.
  // Isolation as this page loaded: a worker that stopped isolating now would leave an isolated page unable to start
  // its workers. The next page's script registers what the setting asks then (ui/src/browser/isolation.ts).
  const isolating = settings.get(APP_ISOLATION) !== false;
  const isolate = isolation === "off" ? undefined : () => isolating;
  const client = createKeptFilesClient({ environment, cacheNamespace: "foss-earth-app-files",
    policy: { enabled: () => settings.get(KEEP_APP_FILES) === true, ...(isolate ? { isolate } : {}),
      subscribe: listener => settings.watch(KEEP_APP_FILES, listener) },
    onError: error => console.warn("The app's files could not be kept as Settings → App files asks.", error),
  });
  return { status: client.status, settled: client.settled, dispose: client.dispose };
}
