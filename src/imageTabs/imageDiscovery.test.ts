import { describe, expect, it, vi } from "vitest";
import { createImageSessionBroker, MIB } from "@foss-earth/images";
import { discoverFileImage, discoverUrlImage, type ImageDiscoveryPorts } from "./imageDiscovery";

const be32 = (value: number) => [value >>> 24, (value >> 16) & 255, (value >> 8) & 255, value & 255];
const ascii = (text: string) => [...text].map(c => c.charCodeAt(0));
/** A PNG header and chunks; checksums are not read. Colour type 2 is opaque RGB, 6 has alpha. */
function png(width: number, height: number, colourType = 2): Uint8Array {
  const chunk = (type: string, body: number[]) => [...be32(body.length), ...ascii(type), ...body, 0, 0, 0, 0];
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk("IHDR", [...be32(width), ...be32(height), 8, colourType, 0, 0, 0]), ...chunk("IDAT", [0]), ...chunk("IEND", [])]);
}

function ports(body: Uint8Array | null, extra: Partial<ImageDiscoveryPorts> = {}) {
  const broker = createImageSessionBroker({ pools: { sourceGpu: 256 * MIB, decoded: 256 * MIB, encoded: 64 * MIB, uploadOutstanding: 16 * MIB, overlap: 128 * MIB }, requests: 2, decodes: 1 });
  const fetch = vi.fn(async () => body ? new Response(body.slice(), { headers: { "content-type": "image/png" } }) : new Response(null, { status: 404 }));
  const result: ImageDiscoveryPorts = { broker, limits: () => ({ responseBytes: MIB, timeoutMs: 10_000 }), fetch: fetch as unknown as typeof globalThis.fetch,
    maxTextureSide: () => 4096, baseUrl: "https://earth.example/app/", ...extra };
  return { ports: result, fetch, broker };
}

describe("opening an image by address", () => {
  it("reads the image once to describe it, then lets its bytes go", async () => {
    const { ports: discovery, fetch, broker } = ports(png(640, 480));
    const result = await discoverUrlImage("images/photo%20one.png#frag", discovery);
    expect(result).toEqual({ ok: true, description: {
      assetKey: `url:https://earth.example/app/images/photo%20one.png#640x480:${png(640, 480).byteLength}`,
      revision: `640x480:${png(640, 480).byteLength}`, title: "photo one.png",
      source: { kind: "url", url: "https://earth.example/app/images/photo%20one.png" },
      width: 640, height: 480, mimeType: "image/png", encodedBytes: png(640, 480).byteLength,
    } });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(broker.pools.stats().encoded.reserved).toBe(0);
  });

  it("opens only http and https addresses", async () => {
    const { ports: discovery, fetch } = ports(png(4, 4));
    expect(await discoverUrlImage("file:///photo.png", discovery)).toMatchObject({ ok: false, reason: expect.stringContaining("Only http and https") });
    expect(await discoverUrlImage("data:image/png;base64,AAAA", discovery)).toMatchObject({ ok: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("says why an image cannot be shown as it is stored", async () => {
    expect(await discoverUrlImage("https://x.example/a.png", ports(png(4, 4, 6)).ports)).toMatchObject({ ok: false, reason: expect.stringContaining("a.png cannot be shown as it is stored.") });
    expect(await discoverUrlImage("https://x.example/a.txt", ports(new TextEncoder().encode("hello")).ports)).toMatchObject({ ok: false, reason: "a.txt is not a JPEG or PNG image this viewer can read." });
    expect(await discoverUrlImage("https://x.example/missing.png", ports(null).ports)).toMatchObject({ ok: false, reason: expect.stringContaining("missing.png could not be read") });
  });

  it("refuses an image larger than the device's textures instead of reducing it", async () => {
    const { ports: discovery } = ports(png(8192, 16), { maxTextureSide: () => 4096 });
    expect(await discoverUrlImage("https://x.example/wide.png", discovery)).toMatchObject({ ok: false, reason: expect.stringContaining("never reduced") });
  });
});

describe("opening an image file", () => {
  it("describes each chosen file as its own asset", async () => {
    const { ports: discovery, broker } = ports(null);
    const file = new File([png(32, 16)], "grid.png", { type: "image/png" });
    const first = await discoverFileImage(file, discovery), second = await discoverFileImage(file, discovery);
    expect(first).toMatchObject({ ok: true, description: { title: "grid.png", width: 32, height: 16, source: { kind: "file", file, name: "grid.png" } } });
    if (!first.ok || !second.ok) throw new Error("expected both to open");
    expect(first.description.assetKey).not.toBe(second.description.assetKey);
    expect(broker.pools.stats().encoded.reserved).toBe(0);
  });

  it("refuses a file larger than the Largest image file setting, naming it", async () => {
    const { ports: discovery } = ports(null, { limits: () => ({ responseBytes: 64, timeoutMs: 1000 }) });
    const result = await discoverFileImage(new File([new Uint8Array(100)], "big.png"), discovery);
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining("Largest image file setting allows (Scenes → Loading)") });
  });
});
