import { describe, expect, it, vi } from "vitest";
import { crossOriginIsolation, deployedIsolation, isolationHeaders, isolationPolicy } from "./crossOriginIsolation";

describe("cross-origin isolation", () => {
  it("is off unless asked, so no default page changes", () => {
    expect(isolationPolicy({}, {})).toEqual({ mode: "off", embedder: "credentialless" });
    expect(isolationHeaders(isolationPolicy({}, {}))).toEqual({});
  });

  it("isolates, or only reports, with credentialless embedding unless require-corp is asked", () => {
    expect(isolationHeaders(isolationPolicy({}, { FOSS_EARTH_ISOLATION: "enforce" }))).toEqual({
      "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "credentialless" });
    expect(isolationHeaders(isolationPolicy({}, { FOSS_EARTH_ISOLATION: "report-only", FOSS_EARTH_COEP: "require-corp" }))).toEqual({
      "Cross-Origin-Opener-Policy-Report-Only": "same-origin", "Cross-Origin-Embedder-Policy-Report-Only": "require-corp" });
    expect(isolationPolicy({ mode: "off" }, { FOSS_EARTH_ISOLATION: "enforce" }).mode).toBe("off");
  });

  it("refuses unknown values rather than guessing", () => {
    expect(() => isolationPolicy({}, { FOSS_EARTH_ISOLATION: "on" })).toThrow("FOSS_EARTH_ISOLATION");
    expect(() => isolationPolicy({}, { FOSS_EARTH_COEP: "unsafe-none" })).toThrow("FOSS_EARTH_COEP");
  });

  it("lets a build's worker isolate unless the build asks otherwise", () => {
    expect(deployedIsolation({})).toBe("enforce");
    expect(deployedIsolation({ FOSS_EARTH_ISOLATION: " report-only " })).toBe("report-only");
    expect(deployedIsolation({ FOSS_EARTH_ISOLATION: "off" })).toBe("off");
    expect(() => deployedIsolation({ FOSS_EARTH_ISOLATION: "on" })).toThrow("FOSS_EARTH_ISOLATION");
  });

  it("adds the headers to every dev and preview response, and no middleware when off", () => {
    for (const hook of ["configureServer", "configurePreviewServer"] as const) {
      const use = vi.fn();
      const plugin = crossOriginIsolation({ mode: "enforce" });
      (plugin[hook] as (server: unknown) => void)({ middlewares: { use } });
      const response = { setHeader: vi.fn() }, next = vi.fn();
      use.mock.calls[0][0]({}, response, next);
      expect(response.setHeader).toHaveBeenCalledWith("Cross-Origin-Opener-Policy", "same-origin");
      expect(response.setHeader).toHaveBeenCalledWith("Cross-Origin-Embedder-Policy", "credentialless");
      expect(next).toHaveBeenCalledOnce();
      const unused = vi.fn();
      (crossOriginIsolation({ mode: "off" })[hook] as (server: unknown) => void)({ middlewares: { use: unused } });
      expect(unused).not.toHaveBeenCalled();
    }
  });
});
