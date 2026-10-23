/** Google-hosted viewing stays separate from original-image acquisition. */
export type GooglePanoramaSource =
  | { kind: "embed"; embedUrl: string; sourceUrl: string }
  | { kind: "panorama"; panoramaId: string; sourceUrl: string };

const GOOGLE_MAPS_HOSTS = new Set(["google.com", "www.google.com", "maps.google.com"]);
const PANORAMA_ID = /^[A-Za-z0-9_-]{6,512}$/;

function panoramaSource(id: string): GooglePanoramaSource {
  if (!PANORAMA_ID.test(id)) throw new Error("The panorama ID must contain only letters, digits, hyphens and underscores.");
  const source = new URL("https://www.google.com/maps/@");
  source.searchParams.set("api", "1");
  source.searchParams.set("map_action", "pano");
  source.searchParams.set("pano", id);
  return { kind: "panorama", panoramaId: id, sourceUrl: source.href };
}

/** No fetching, redirect following, HTML execution or credentials are needed to inspect a share link. */
export function parseGooglePanoramaSource(value: string): GooglePanoramaSource {
  let input = value.trim();
  if (!input || input.length > 16384) throw new Error("Paste a Google Maps panorama link, panorama ID or official embed URL.");
  const iframe = /^<iframe\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/i.exec(input);
  if (iframe) input = iframe[2].replaceAll("&amp;", "&");
  if (PANORAMA_ID.test(input)) return panoramaSource(input);
  let url: URL;
  try { url = new URL(input); } catch { throw new Error("Use a full Google Maps panorama link or its panorama ID."); }
  if (url.protocol !== "https:" || url.username || url.password || url.port) throw new Error("Google panorama links must use HTTPS without credentials or a custom port.");
  const maps = GOOGLE_MAPS_HOSTS.has(url.hostname);
  const earth = url.hostname === "earth.google.com";
  if (!maps && !earth) throw new Error("Use an expanded google.com/maps panorama link or an official Google Maps embed URL.");
  if (maps && /^\/maps\/embed(?:\/|$)/.test(url.pathname)) {
    const source = new URL(url);
    source.searchParams.delete("key");
    source.hash = "";
    const pano = url.searchParams.get("pano");
    return { kind: "embed", embedUrl: url.href, sourceUrl: pano && PANORAMA_ID.test(pano) ? panoramaSource(pano).sourceUrl : source.href };
  }
  if (maps && !(url.pathname.startsWith("/maps") || url.hostname === "maps.google.com")) throw new Error("This Google address is not a Maps panorama link.");
  if (earth && !url.pathname.startsWith("/web")) throw new Error("Use the Google Earth's Street View panorama link or open it in Maps.");
  const queryId = url.searchParams.get("pano") ?? url.searchParams.get("panoid");
  if (queryId) return panoramaSource(queryId);
  let decoded = url.pathname;
  try { decoded = decodeURIComponent(`${url.pathname}${url.search}`); } catch { /* The raw path may still contain the panorama token. */ }
  const token = /!1s([A-Za-z0-9_-]{6,512})!2e(?:0|10)(?:!|$)/.exec(decoded);
  if (token) return panoramaSource(token[1]);
  throw new Error("This link does not identify a panorama. Open Street View, then copy its expanded Maps link or Share → Embed URL.");
}

/** Only the official Google Maps embed origin can become a frame address. */
export function googlePanoramaEmbedUrl(source: GooglePanoramaSource, configuredKey: string | null | undefined): string {
  if (source.kind === "embed") {
    const checked = parseGooglePanoramaSource(source.embedUrl);
    if (checked.kind !== "embed") throw new Error("Use an official Google Maps embed URL.");
    return checked.embedUrl;
  }
  if (!configuredKey?.trim()) throw new Error("This panorama ID needs the configured Google Maps key. Set it in Map, or paste Google's Share → Embed URL.");
  const url = new URL("https://www.google.com/maps/embed/v1/streetview");
  url.searchParams.set("key", configuredKey.trim());
  url.searchParams.set("pano", source.panoramaId);
  return url.href;
}
