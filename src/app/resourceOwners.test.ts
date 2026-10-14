import { describe, expect, it, vi } from "vitest";
import type { NetworkSource } from "@foss-earth/renderer/profiling";
import { gpuMemoryOwner, meterMapFetch, requestOwner } from "./resourceOwners";

const page = "https://foss-earth.test/app/?scene=umn-single";

describe("request owners", () => {
  it("names the map's, the sky's and search's servers, and the app's own files", () => {
    expect(requestOwner("https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/tile/3/2/1", page)).toBe("map/imagery");
    expect(requestOwner("https://a.basemaps.cartocdn.com/dark_all/3/2/1.png", page)).toBe("map/imagery");
    expect(requestOwner("https://tiles.mapterhorn.com/12/1/2.webp", page)).toBe("map/terrain");
    expect(requestOwner("https://s3.amazonaws.com/elevation-tiles-prod/terrarium/1/0/0.png", page)).toBe("map/terrain");
    expect(requestOwner("https://tile.googleapis.com/v1/3dtiles/root.json", page)).toBe("map/3D tiles");
    expect(requestOwner("https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/x.png", page)).toBe("sky/night lights");
    expect(requestOwner("https://nominatim.openstreetmap.org/search?q=x", page)).toBe("search");
    expect(requestOwner("https://foss-earth.test/app/examples/panorama-scenes/umn-single.scene.json", page)).toBe("panoramas");
    expect(requestOwner("/app/assets/index.js", page)).toBe("app files");
    expect(requestOwner("https://elsewhere.test/x", page)).toBeNull();
    expect(requestOwner("not a url ::", "also not")).toBeNull();
  });
});

describe("GPU memory owners", () => {
  it("names Babylon textures and meshes by their creators' names", () => {
    expect(gpuMemoryOwner("imagery-atlas")).toBe("map/imagery");
    expect(gpuMemoryOwner("imagery-page-table")).toBe("map/imagery");
    expect(gpuMemoryOwner("raster-basemap-tile-usgs-imagery-topo-3/2/1")).toBe("map/terrain");
    expect(gpuMemoryOwner("fallback-globe")).toBe("map/fallback globe");
    expect(gpuMemoryOwner("night-lights")).toBe("sky/night lights");
    expect(gpuMemoryOwner("sky-dome")).toBe("sky/dome");
    expect(gpuMemoryOwner("orbit-compass-label-N-texture")).toBe("interface/compass");
    expect(gpuMemoryOwner("sphere-orb-viewer-1:umn-test-orb")).toBe("panoramas");
    expect(gpuMemoryOwner("umn-single/record-1")).toBe("panoramas");
    expect(gpuMemoryOwner("https://basemap.nationalmap.gov/tile/1/2/3")).toBe("map/imagery");
    expect(gpuMemoryOwner("something else")).toBeNull();
  });
});

describe("map fetch meter", () => {
  function network(measuring: boolean) {
    const received = vi.fn();
    return { received, source: { measuring, received } as unknown as NetworkSource };
  }

  it("is the wrapped fetch while not measuring", () => {
    const response = Promise.resolve(new Response("tile"));
    const fetcher = vi.fn(() => response);
    const { received, source } = network(false);
    const fetched = meterMapFetch(fetcher as unknown as typeof fetch, source, page)("https://tiles.mapterhorn.com/1/0/0.webp");
    expect(fetched).toBe(response);
    expect(received).not.toHaveBeenCalled();
  });

  it("counts a metered owner's body as it streams, and keeps the response's own fields", async () => {
    const original = new Response(new Uint8Array(1500), { status: 200, headers: { "content-type": "image/webp" } });
    Object.defineProperty(original, "url", { value: "https://tiles.mapterhorn.com/1/0/0.webp" });
    const { received, source } = network(true);
    const counted = await meterMapFetch(() => Promise.resolve(original), source, page)("https://tiles.mapterhorn.com/1/0/0.webp");
    expect(counted).not.toBe(original);
    expect(counted.url).toBe("https://tiles.mapterhorn.com/1/0/0.webp");
    expect(counted.headers.get("content-type")).toBe("image/webp");
    expect((await counted.arrayBuffer()).byteLength).toBe(1500);
    const total = received.mock.calls.reduce((sum, [owner, bytes]) => { expect(owner).toBe("map/terrain"); return sum + bytes; }, 0);
    expect(total).toBe(1500);
  });

  it("leaves other owners and failed responses to Resource Timing", async () => {
    const { received, source } = network(true);
    const app = new Response("x");
    expect(await meterMapFetch(() => Promise.resolve(app), source, page)("https://foss-earth.test/app/a.js")).toBe(app);
    const missing = new Response("gone", { status: 404 });
    expect(await meterMapFetch(() => Promise.resolve(missing), source, page)("https://tiles.mapterhorn.com/1/0/0.webp")).toBe(missing);
    expect(received).not.toHaveBeenCalled();
  });
});
