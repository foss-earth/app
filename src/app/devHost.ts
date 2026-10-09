/** Earth contributes observations to the shared Dev tab over its existing frame. */
import { createDevSession, wantsDev, type DevContribution, type DevTabRegistration } from "@foss-earth/dev";
import { createDevBrowserHost } from "@foss-earth/dev/browser";
import type { BabylonRuntime } from "@foss-earth/engine/babylon";
import type { ImageSessionBroker } from "@foss-earth/images";
import type { createEarthUiHost } from "./uiHost";

export interface EarthDevPorts {
  document: Document;
  runtime: BabylonRuntime;
  broker: ImageSessionBroker;
  refresh: ReturnType<typeof createEarthUiHost>["refresh"];
}
export type EarthDevContribution = DevContribution<EarthDevPorts, HTMLElement>;
export type EarthDevTab = DevTabRegistration & { element: HTMLElement };

export function createEarthDevHost(search: string, ports: EarthDevPorts, contributions: readonly EarthDevContribution[] = []) {
  let tab: EarthDevTab | null = null;
  if (!wantsDev(search)) return { tab, dispose() {}, whenSettled: () => Promise.resolve() };
  const browser = createDevBrowserHost({ document: ports.document,
    registerTab(next) { tab = next; return () => { if (tab === next) tab = null; }; },
  });
  const observations: EarthDevContribution = {
    id: "earth-runtime", title: "Earth runtime", owner: "foss-earth/app",
    description: "Current host observations from the shared renderer and resource session.",
    mount({ ports: host, signal }) {
      const view = host.document.createElement("pre");
      const update = () => {
        if (!signal.aborted) view.textContent = JSON.stringify({
          renderer: host.runtime.renderer.mode, map: host.runtime.status,
          resources: host.broker.pools.stats(),
        }, null, 2);
      };
      update();
      const stop = host.refresh.subscribe(update);
      signal.addEventListener("abort", stop, { once: true });
      return { view, dispose() { signal.removeEventListener("abort", stop); stop(); view.remove(); } };
    },
  };
  const session = createDevSession({ search, ports, host: browser.host,
    createAbortController: () => new AbortController(),
    contributions: [observations, ...contributions], onError: error => console.error("Earth Dev contribution failed", error),
  });
  return { get tab() { return tab; }, dispose: () => session.dispose(), whenSettled: () => session.whenSettled() };
}
