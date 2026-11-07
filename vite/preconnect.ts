/**
 * Opens the default maps' tile connections from the page's first bytes
 * (docs/proposals/performance-limits.md, L23). The first elevation and imagery
 * requests start only once the modules run, about 2 s into a cold visit; with
 * the hints, DNS, TCP and TLS for their hosts (about three round trips) are
 * done by then.
 *
 * The hints go first in <head>, before the build's inline isolation script
 * (about 14 KB) and the boot terminal's style, so they arrive in the
 * response's first packets. `crossorigin` opens the anonymous connection the
 * tile fetches use: they are CORS requests without credentials.
 */
import type { HtmlTagDescriptor, Plugin } from "vite";

/** The default elevation's and base map's tiles (Mapterhorn and USGS); preconnect.test.ts checks them against the engine's defaults. */
export const DEFAULT_TILE_URLS: readonly string[] = [
  "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp",
  "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/tile/{z}/{y}/{x}",
];

/** The origins of `urls`, once each, in order; a URL that is not https is refused. */
export function preconnectOrigins(urls: readonly string[]): string[] {
  const origins: string[] = [];
  for (const url of urls) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") throw new Error(`preconnect needs https origins, not ${url}.`);
    if (!origins.includes(parsed.origin)) origins.push(parsed.origin);
  }
  return origins;
}

/** One `<link rel="preconnect" crossorigin>` per origin, first in each page's <head>, in dev and in builds. */
export function preconnect(urls: readonly string[]): Plugin {
  const tags: HtmlTagDescriptor[] = preconnectOrigins(urls)
    .map(href => ({ tag: "link", attrs: { rel: "preconnect", href, crossorigin: true }, injectTo: "head-prepend" }));
  return {
    name: "foss-earth-preconnect",
    // After every other hook, so no later head-prepend lands before the hints.
    transformIndexHtml: { order: "post", handler: () => tags },
  };
}
