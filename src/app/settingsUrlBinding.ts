/** Earth site composition: one supplied registry follows the host's URL/history. */
import type { SettingsRegistry } from "@foss-earth/ui/settings";
import { stringifyValue, type ParameterState } from "@foss-earth/ui/settings";

export interface EarthSettingsUrlHost {
  readUrl(): URL;
  /** Replace the current URL while preserving the host's history state. */
  replaceUrl(url: URL): void;
  onPopState(listener: () => void): () => void;
  onStorage(listener: (key: string | null) => void): () => void;
}

export interface EarthSettingsUrlBindingOptions {
  registry: Pick<SettingsRegistry, "list" | "inspect" | "set" | "watch" | "reload">;
  host: EarthSettingsUrlHost;
  names: Readonly<Record<string, readonly string[]>>;
  prefix: string;
  storageKey: string;
  linkedIds: readonly string[];
}

/** Owns subscriptions only; neither creates nor disposes the supplied registry. */
export function bindEarthSettingsUrl(options: EarthSettingsUrlBindingOptions): () => void {
  const { registry, host } = options;
  const stops: (() => void)[] = [];
  const written = new Map<string, string>();
  let disposed = false;
  const names = (id: string): string[] => [...(options.names[id] ?? []), `${options.prefix}${id}`];
  const unchosen = (state: ParameterState): boolean =>
    state.provenance === "default" || state.provenance === "host-default" || state.provenance === "host";
  function editQuery(edit: (params: URLSearchParams) => void): void {
    if (disposed) return;
    const url = new URL(host.readUrl().href);
    const before = url.searchParams.toString();
    edit(url.searchParams);
    if (!disposed && url.searchParams.toString() !== before) host.replaceUrl(url);
  }
  function writeLinked(): void {
    editQuery(params => {
      for (const [id, text] of written) {
        const [name, ...older] = names(id);
        for (const other of older) params.delete(other);
        params.set(name, text);
      }
    });
  }
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    written.clear();
    const failures: unknown[] = [];
    for (const stop of stops.splice(0)) {
      try { stop(); } catch (error) { failures.push(error); }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "Earth settings URL cleanup failed.");
  }
  try {
    // Keep query secrets off links/bookmarks while saving the exact supplied value.
    const secretNames: string[] = [];
    for (const spec of registry.list()) {
      if (!spec.sensitive) continue;
      const given = registry.inspect(spec.id).layers.url;
      if (given) registry.set(spec.id, given.value);
      secretNames.push(...names(spec.id));
    }
    editQuery(params => { for (const name of secretNames) params.delete(name); });
    for (const id of options.linkedIds) {
      let last = registry.inspect(id);
      stops.push(registry.watch(id, value => {
        if (disposed) return;
        const state = registry.inspect(id);
        const defaultsOnly = unchosen(last) && unchosen(state);
        last = state;
        if (state.provenance === "host") return;
        if (defaultsOnly && !names(id).some(name => host.readUrl().searchParams.has(name))) return;
        written.set(id, stringifyValue(value));
        writeLinked();
      }));
    }
    stops.push(host.onPopState(writeLinked));
    stops.push(host.onStorage(key => { if (!disposed && key === options.storageKey) registry.reload(); }));
    return dispose;
  } catch (error) {
    try { dispose(); } catch (cleanup) {
      throw new AggregateError([error, cleanup], "Earth settings URL setup and cleanup failed.");
    }
    throw error;
  }
}
