import { describe, expect, it } from "vitest";
import { googlePanoramaEmbedUrl, parseGooglePanoramaSource } from "./googleSource";

describe("Google panorama source", () => {
  const pano = "AF1QipExample_panorama-123";
  it("reads the panorama identity from official Maps URLs and raw IDs", () => {
    for (const source of [pano, `https://www.google.com/maps/@?api=1&map_action=pano&pano=${pano}`,
      `https://www.google.com/maps/@44,-93,3a/data=!3m7!1e1!3m5!1s${pano}!2e10!3e11`]) {
      const result = parseGooglePanoramaSource(source);
      expect(result.kind).toBe("panorama");
      if (result.kind === "panorama") expect(result.panoramaId).toBe(pano);
    }
  });
  it("accepts official embedded HTML without executing it", () => {
    const result = parseGooglePanoramaSource('<iframe src="https://www.google.com/maps/embed?pb=example&amp;mode=streetview" allowfullscreen></iframe>');
    expect(result).toMatchObject({ kind: "embed", embedUrl: "https://www.google.com/maps/embed?pb=example&mode=streetview" });
    expect(googlePanoramaEmbedUrl(result, null)).toBe("https://www.google.com/maps/embed?pb=example&mode=streetview");
  });
  it("refuses arbitrary frames, protocol tricks, Google lookalikes and ambiguous links", () => {
    for (const input of ["javascript:alert(1)", "https://google.com.evil.example/maps/embed?pb=x", "https://www.google.com:8080/maps/embed?pb=x",
      "https://user:pass@www.google.com/maps/embed?pb=x", "https://evil.example/maps/embed?pb=x", "http://www.google.com/maps/embed?pb=x",
      "https://maps.app.goo.gl/short", "https://www.google.com/maps/place/Anderson+Labs", "https://www.google.com/search?q=panorama"]) {
      expect(() => parseGooglePanoramaSource(input)).toThrow();
    }
  });
  it("uses a configured key only in the ephemeral embed URL", () => {
    const source = parseGooglePanoramaSource(pano);
    expect(() => googlePanoramaEmbedUrl(source, null)).toThrow(/configured Google Maps key/);
    const url = new URL(googlePanoramaEmbedUrl(source, "test-key"));
    expect(url.origin).toBe("https://www.google.com");
    expect(url.pathname).toBe("/maps/embed/v1/streetview");
    expect(url.searchParams.get("pano")).toBe(pano);
    expect(url.searchParams.get("key")).toBe("test-key");
    expect(source.sourceUrl).not.toContain("test-key");
  });
  it("does not retain keys in the fallback source link", () => {
    const source = parseGooglePanoramaSource(`https://www.google.com/maps/embed/v1/streetview?key=private-key&pano=${pano}`);
    expect(source.sourceUrl).not.toContain("private-key");
    expect(source.sourceUrl).not.toContain("key=");
  });
});
