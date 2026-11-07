import { DEFAULT_RASTER_BASE_MAP_ID, TERRAIN_SOURCES, resolveRasterBaseMapSource } from "@foss-earth/engine";
import { describe, expect, it } from "vitest";
import { DEFAULT_TILE_URLS, preconnect, preconnectOrigins } from "./preconnect";

type Handler = () => { tag: string; attrs: Record<string, string | boolean>; injectTo: string }[];

describe("preconnect", () => {
  it("names each origin once, in order, and refuses anything but https", () => {
    expect(preconnectOrigins(["https://a.example/{z}/{x}/{y}.webp", "https://b.example/tile", "https://a.example/other"]))
      .toEqual(["https://a.example", "https://b.example"]);
    expect(() => preconnectOrigins(["http://a.example/tile"])).toThrow("https");
  });

  it("puts one anonymous preconnect per origin first in <head>, after every other hook", () => {
    const plugin = preconnect(["https://a.example/{z}", "https://b.example/{z}"]);
    const hook = plugin.transformIndexHtml as { order: string; handler: Handler };
    expect(hook.order).toBe("post");
    expect(hook.handler()).toEqual([
      { tag: "link", attrs: { rel: "preconnect", href: "https://a.example", crossorigin: true }, injectTo: "head-prepend" },
      { tag: "link", attrs: { rel: "preconnect", href: "https://b.example", crossorigin: true }, injectTo: "head-prepend" },
    ]);
  });

  it("opens the hosts of the default elevation and base map, and nothing else", () => {
    const defaults = [TERRAIN_SOURCES[0].urlTemplate, resolveRasterBaseMapSource(DEFAULT_RASTER_BASE_MAP_ID).urlTemplate];
    expect(preconnectOrigins(DEFAULT_TILE_URLS)).toEqual(preconnectOrigins(defaults));
    expect(preconnectOrigins(DEFAULT_TILE_URLS)).toEqual(["https://tiles.mapterhorn.com", "https://basemap.nationalmap.gov"]);
  });
});
