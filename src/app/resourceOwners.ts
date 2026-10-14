/**
 * Who owns what, for the frame budget's streamgraphs: requests by host and
 * path, GPU textures and meshes by name. A part of an owner is named
 * "owner/part", so "map/imagery" and "map/terrain" share the map's colour.
 */
import type { NetworkSource } from "@foss-earth/renderer/profiling";

const REQUEST_HOSTS: readonly (readonly [RegExp, string])[] = [
  [/^tile\.googleapis\.com$/, "map/3D tiles"],
  [/^(nominatim\.openstreetmap\.org|api\.freeairportdb\.com|overpass-api\.de)$/, "search"],
  [/(^|\.)(nationalmap\.gov|openstreetmap\.org|cartocdn\.com|opentopomap\.org)$/, "map/imagery"],
  [/^tiles\.mapterhorn\.com$/, "map/terrain"],
  [/^gibs\.earthdata\.nasa\.gov$/, "sky/night lights"],
];

/** The owner of a request, from its URL; null for one nobody here makes. */
export function requestOwner(url: string, page: string): string | null {
  let parsed: URL;
  try { parsed = new URL(url, page); } catch { return null; }
  if (parsed.hostname === "s3.amazonaws.com" && parsed.pathname.startsWith("/elevation-tiles-prod/")) return "map/terrain";
  for (const [host, owner] of REQUEST_HOSTS) if (host.test(parsed.hostname)) return owner;
  if (parsed.origin !== new URL(page).origin) return null;
  if (parsed.pathname.includes("/panorama-scenes/") || parsed.pathname.includes("/examples/")) return "panoramas";
  return "app files";
}

/**
 * Owners fetched through the map cache, whose servers hide their sizes from
 * Resource Timing: their bodies are counted as they stream in instead.
 */
export const METERED_REQUEST_OWNERS: readonly string[] = ["map/imagery", "map/terrain", "sky/night lights"];

/**
 * The map cache's fetch, counting the bodies of metered owners' responses
 * while the profiler measures. Otherwise it is the fetch it wraps, called
 * directly; nothing is added to global fetch.
 */
export function meterMapFetch(fetcher: typeof fetch, network: NetworkSource, page: string): typeof fetch {
  const counted = async (owner: string, response: Promise<Response>): Promise<Response> => {
    const received = await response;
    if (!received.ok || !received.body) return received;
    const body = received.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        network.received(owner, chunk.byteLength);
        controller.enqueue(chunk);
      },
    }));
    const measured = new Response(body, { status: received.status, statusText: received.statusText, headers: received.headers });
    // Response construction drops these fetch-provided fields, which the map cache reads.
    for (const key of ["url", "redirected", "type"] as const) Object.defineProperty(measured, key, { value: received[key] });
    return measured;
  };
  return (input, init) => {
    if (!network.measuring) return fetcher(input, init);
    const owner = requestOwner(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, page);
    const response = fetcher(input, init);
    return owner && METERED_REQUEST_OWNERS.includes(owner) ? counted(owner, response) : response;
  };
}

/** The owner of a GPU texture or mesh, from the name its creator gave it; null leaves it to the name's first word. */
export function gpuMemoryOwner(name: string): string | null {
  if (name.startsWith("imagery")) return "map/imagery";
  if (name.startsWith("raster-basemap-tile-")) return "map/terrain";
  if (name.startsWith("fallback-globe")) return "map/fallback globe";
  if (name === "night-lights") return "sky/night lights";
  if (name.startsWith("sky-")) return `sky/${name.slice(4).replace(/-/g, " ")}`;
  if (name.startsWith("light-points")) return "sky/light points";
  if (name.startsWith("sphere-") || name.startsWith("preview-sheet")) return "panoramas";
  if (name.startsWith("orbit-compass")) return "interface/compass";
  // Map tiles are uploaded under their URL, sphere images under "asset/record".
  if (/^https?:\/\//.test(name)) return "map/imagery";
  if (/^[\w.-]+\/[\w.-]+/.test(name)) return "panoramas";
  return null;
}
