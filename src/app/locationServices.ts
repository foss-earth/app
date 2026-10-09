/** Earth supplies the browser realm; Engine owns the existing Location lookup. */
import {
  createAirportLookup,
  createLocationLookupCache,
  createLocationLookupTransport,
  createLocationSearch,
  createLocationSearchTuning,
} from "@foss-earth/engine/location-provider";
import type { SettingsRegistry, SettingsStorage } from "@foss-earth/ui/settings";

export interface EarthLocationServicesPorts {
  storage: SettingsStorage | null;
  fetch: typeof fetch;
  nowMs(): number;
  createAbortController(): AbortController;
  timers: {
    setTimeout(callback: () => void, delayMs: number): unknown;
    clearTimeout(handle: unknown): void;
  };
}

/** One cache/transport for this host session. No lookup or timer starts here. */
export function createEarthLocationServices(settings: SettingsRegistry, ports: EarthLocationServicesPorts) {
  const tuning = createLocationSearchTuning(settings);
  const cache = createLocationLookupCache({
    storage: ports.storage,
    tuning,
    nowMs: () => ports.nowMs(),
    createAbortController: () => ports.createAbortController(),
    abortError: message => new DOMException(message, "AbortError"),
  });
  const transport = createLocationLookupTransport({
    fetch: (url, options) => ports.fetch(url, options),
    createAbortController: () => ports.createAbortController(),
    nowMs: () => ports.nowMs(),
    tuning,
    timers: {
      setTimeout: (callback, delay) => ports.timers.setTimeout(callback, delay),
      clearTimeout: handle => ports.timers.clearTimeout(handle),
    },
    timeoutError: () => new DOMException("Location lookup timed out.", "TimeoutError"),
    combineSignals(signals) {
      const controller = ports.createAbortController();
      const removals: (() => void)[] = [];
      const dispose = (): void => { for (const remove of removals.splice(0)) remove(); };
      try {
        for (const signal of signals) {
          if (signal.aborted) { controller.abort(signal.reason); break; }
          const abort = (): void => controller.abort(signal.reason);
          signal.addEventListener("abort", abort, { once: true });
          removals.push(() => signal.removeEventListener("abort", abort));
          if (signal.aborted) { abort(); break; }
        }
      } catch (error) { dispose(); throw error; }
      return { signal: controller.signal, dispose };
    },
  });
  const airports = createAirportLookup({
    cache,
    transport,
    copyAirports: records => records.map(airport => ({ ...airport, runways: airport.runways.map(runway => ({
      ...runway, start: { ...runway.start }, end: { ...runway.end },
    })) })),
  });
  const search = createLocationSearch({ cache, transport, airports });
  return { ...search, dispose: () => cache.dispose() };
}

type EarthLocationServices = ReturnType<typeof createEarthLocationServices>;
const activeServices: EarthLocationServices[] = [];

/** Deprecated no-port calls borrow the current app's service instead of creating another cache. */
export function bindEarthLocationServices(services: EarthLocationServices): () => void {
  activeServices.push(services);
  return () => {
    const index = activeServices.lastIndexOf(services);
    if (index >= 0) activeServices.splice(index, 1);
  };
}

function currentServices(): EarthLocationServices {
  const services = activeServices.at(-1);
  if (!services) throw new Error("No active Earth Location host. Use Engine's createLocationSearch with explicit host ports.");
  return services;
}

export const searchLocations = (...args: Parameters<EarthLocationServices["searchLocations"]>) => currentServices().searchLocations(...args);
export const nearbyAirports = (...args: Parameters<EarthLocationServices["nearbyAirports"]>) => currentServices().nearbyAirports(...args);
