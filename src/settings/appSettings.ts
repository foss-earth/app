import { FOSS_EARTH_MIGRATIONS, FOSS_EARTH_PARAMETERS, FOSS_EARTH_SECTION_TITLES, FOSS_EARTH_URL_NAMES, fossEarthUrlAliases, RENDERER_EXPERIMENT_IDS } from "./catalogue";
import { BUILT_IN_PRESETS } from "./presets";
import { NAVIGATION_ANCHOR_PRESETS } from "@foss-earth/engine/settings";
import { createBrowserSettingsRegistry, readDeviceContext } from "@foss-earth/ui/browser";
import { linkParameterGroup, SETTINGS_STORAGE_KEY, URL_PARAMETER_PREFIX, type SettingsRegistry } from "@foss-earth/ui/settings";
import { bindEarthSettingsUrl } from "../app/settingsUrlBinding";

/** Where FOSS Earth's sources are browsable; hosts add their own prefix with `setSourceBase`. */
export const FOSS_EARTH_SOURCE_BASE = "https://github.com/foss-earth/app/blob/main/";

/** Parameters the address bar shows once chosen, so a link or a reload opens the same map. */
const LINKED_PARAMETER_IDS = ["map.source.basemap", "map.source.elevation"];

let app: SettingsRegistry | null = null;
let stops: (() => void)[] = [];
/**
 * The registry for this page's origin, with FOSS Earth's catalogue registered.
 * Hosts register their own parameters into the same registry, so the whole
 * application has one record and one place to look. It owns the page's query
 * for its parameters: secrets move from it to this device, and the basemap and
 * elevation provider in use are written back to it.
 */
export function getAppSettings(): SettingsRegistry {
  if (app) return app;
  const registry = createBrowserSettingsRegistry({
    searchParams: typeof window === "undefined" ? null : new URLSearchParams(window.location.search),
    urlAliases: fossEarthUrlAliases,
    deviceContext: readDeviceContext({
      navigator: typeof navigator === "undefined" ? null : navigator,
      window: typeof window === "undefined" ? null : window,
    }),
    sourceBase: FOSS_EARTH_SOURCE_BASE,
  });
  registry.register(FOSS_EARTH_PARAMETERS);
  for (const [tab, section, title] of FOSS_EARTH_SECTION_TITLES) registry.setSectionTitle(tab, section, title);
  registry.migrateLegacy(FOSS_EARTH_MIGRATIONS);
  registry.registerPresets(BUILT_IN_PRESETS);
  // The engine owns the zoom and rotation point presets; they set those eight choices only.
  registry.registerPresets(NAVIGATION_ANCHOR_PRESETS);
  const { all: allExperiments, ...experiments } = RENDERER_EXPERIMENT_IDS;
  const nextStops: (() => void)[] = [];
  try {
    nextStops.push(linkParameterGroup(registry, allExperiments, Object.values(experiments)));
    if (typeof window !== "undefined") {
      nextStops.push(bindEarthSettingsUrl({
        registry,
        names: FOSS_EARTH_URL_NAMES,
        prefix: URL_PARAMETER_PREFIX,
        storageKey: SETTINGS_STORAGE_KEY,
        linkedIds: LINKED_PARAMETER_IDS,
        host: {
          readUrl: () => new URL(window.location.href),
          replaceUrl: url => window.history.replaceState(window.history.state, "", url),
          onPopState(listener) {
            window.addEventListener("popstate", listener);
            return () => window.removeEventListener("popstate", listener);
          },
          onStorage(listener) {
            const onStorage = (event: StorageEvent): void => listener(event.key);
            window.addEventListener("storage", onStorage);
            return () => window.removeEventListener("storage", onStorage);
          },
        },
      }));
    }
  } catch (error) {
    const failures: unknown[] = [error];
    for (const stop of nextStops) { try { stop(); } catch (cleanup) { failures.push(cleanup); } }
    if (failures.length > 1) throw new AggregateError(failures, "Earth settings setup and cleanup failed.");
    throw error;
  }
  stops = nextStops;
  app = registry;
  return registry;
}

/** Forgets the app registry, so the next `getAppSettings` reads storage again. For tests. */
export function resetAppSettings(): void {
  const cleanup = stops;
  stops = [];
  app = null;
  const failures: unknown[] = [];
  for (const stop of cleanup) { try { stop(); } catch (error) { failures.push(error); } }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "Earth settings cleanup failed.");
}
