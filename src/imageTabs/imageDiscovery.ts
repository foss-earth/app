/**
 * Opening an image: its bytes read once, within the response limit and
 * charged to the shared encoded-bytes budget, only to learn what it is and
 * whether it can be shown as it is stored
 * (docs/proposals/shared-image-viewer-implementation.md §9). The bytes are
 * let go afterwards; loading reads them again through the same budget.
 */
import { MIB, readEncodedImageFacts, staticOpaqueSrgbProblem, type ImageSessionBroker } from "@foss-earth/images";
import { fetchImageFile, type ImageTransferLimits } from "@foss-earth/images/browser";
import type { ImageDocumentDescription } from "./imageDocuments";

export interface ImageDiscoveryPorts {
  broker: ImageSessionBroker;
  limits(): ImageTransferLimits;
  fetch: typeof fetch;
  maxTextureSide(): number;
  /** Relative addresses resolve against it. */
  baseUrl: string;
}

export type ImageDiscovery =
  | { readonly ok: true; readonly description: ImageDocumentDescription }
  | { readonly ok: false; readonly reason: string };

const message = (error: unknown): string => error instanceof Error ? error.message : String(error);
const mebibytes = (bytes: number): string => `${Number((bytes / MIB).toFixed(2))} MiB`;

/** The last path segment, or the host when there is none. */
function urlTitle(url: URL): string {
  const segment = url.pathname.split("/").filter(Boolean).pop();
  try { return segment ? decodeURIComponent(segment) : url.host; } catch { return segment ?? url.host; }
}

async function describe(bytes: Uint8Array, name: string, maxTextureSide: number,
  identity: (revision: string) => Pick<ImageDocumentDescription, "assetKey" | "source">): Promise<ImageDiscovery> {
  const facts = await readEncodedImageFacts(bytes);
  if (!facts) return { ok: false, reason: `${name} is not a JPEG or PNG image this viewer can read.` };
  const problem = staticOpaqueSrgbProblem(facts);
  if (problem) return { ok: false, reason: `${name} cannot be shown as it is stored. ${problem}` };
  const { width, height, kind } = facts.header;
  if (width > maxTextureSide || height > maxTextureSide) {
    return { ok: false, reason: `${name} is ${width} × ${height} pixels, and this device's textures are at most ${maxTextureSide} pixels on a side. Images are shown at their own size, never reduced.` };
  }
  const revision = `${width}x${height}:${bytes.byteLength}`;
  return { ok: true, description: { ...identity(revision), revision, title: name, width, height, mimeType: kind, encodedBytes: bytes.byteLength } };
}

/** An http or https address, absolute or relative to the page. */
export async function discoverUrlImage(input: string, ports: ImageDiscoveryPorts): Promise<ImageDiscovery> {
  let url: URL;
  try { url = new URL(input.trim(), ports.baseUrl); } catch { return { ok: false, reason: `${input.trim() || "An empty address"} is not an address.` }; }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "Only http and https addresses can be opened. Use Choose file for an image on this device." };
  }
  url.hash = "";
  const href = url.href, name = urlTitle(url);
  const scope = ports.broker.scope();
  try {
    const file = await fetchImageFile({ url: href, declaredBytes: 0, priority: 20, broker: ports.broker, scope, limits: ports.limits(), fetch: ports.fetch });
    try {
      return await describe(file.bytes, name, ports.maxTextureSide(), revision => ({ assetKey: `url:${href}#${revision}`, source: { kind: "url", url: href } }));
    } finally { file.release(); }
  } catch (error) {
    return { ok: false, reason: `${name} could not be read: ${message(error)}` };
  } finally { scope.dispose(); }
}

let fileTokens = 0;

/** A file chosen on this device. It stays this session's; a reload asks for it again. */
export async function discoverFileImage(file: Blob & { readonly name: string }, ports: ImageDiscoveryPorts): Promise<ImageDiscovery> {
  const limit = ports.limits().responseBytes;
  if (file.size > limit) {
    return { ok: false, reason: `${file.name} is ${mebibytes(file.size)}, larger than the ${mebibytes(limit)} the Largest image file setting allows (Scenes → Loading).` };
  }
  const scope = ports.broker.scope();
  try {
    scope.reserve("encoded", file.size, `${file.name} opening`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    scope.signal.throwIfAborted();
    // Each choice is its own asset: two files alike in name and size may still differ.
    const token = `file:${++fileTokens}`;
    return await describe(bytes, file.name, ports.maxTextureSide(), () => ({ assetKey: token, source: { kind: "file", file, name: file.name } }));
  } catch (error) {
    return { ok: false, reason: `${file.name} could not be read: ${message(error)}` };
  } finally { scope.dispose(); }
}
