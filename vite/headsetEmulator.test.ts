import path from "node:path";
import type { IndexHtmlTransformContext, Plugin, ResolvedConfig } from "vite";
import { describe, expect, it } from "vitest";
import { headsetEmulator, headsetEmulatorDependency, headsetEmulatorRequested, headsetEmulatorTag } from "./headsetEmulator";

type Hook = (this: unknown, ...args: never[]) => unknown;
const call = (hook: Plugin[keyof Plugin], ...args: unknown[]): unknown =>
  (typeof hook === "function" ? hook : (hook as { handler: Hook }).handler).call(undefined, ...(args as never[]));

describe("headsetEmulator", () => {
  it("is part of the dev server only", () => {
    expect(headsetEmulator().apply).toBe("serve");
  });

  it("adds the emulated headset, ahead of the page's scripts, only to a page that asks for it", () => {
    const plugin = headsetEmulator();
    call(plugin.configResolved, { base: "/app/" } as ResolvedConfig);
    const transform = (originalUrl: string) => call(plugin.transformIndexHtml, "<html></html>", { path: "/index.html", filename: "index.html", originalUrl } as IndexHtmlTransformContext);
    expect(transform("/app/")).toBeUndefined();
    expect(transform("/app/?bench=1")).toBeUndefined();
    const [tag] = transform("/app/?headsetEmulator=quest3&bench=1") as ReturnType<typeof headsetEmulatorTag>[];
    expect(tag).toMatchObject({ tag: "script", injectTo: "head-prepend", attrs: { type: "module" } });
    expect(String(tag.attrs!.src)).toMatch(/^\/app\/@fs\/.*\/src\/dev\/headsetEmulator\.ts$/);
  });

  it("prepares the emulator with the dev server's other dependencies where it is installed", () => {
    const plugin = headsetEmulator();
    expect(call(plugin.config, { root: path.resolve(import.meta.dirname, "..") })).toEqual({ optimizeDeps: { include: ["iwer"] } });
    expect(call(plugin.config, { root: path.parse(import.meta.dirname).root })).toBeUndefined();
  });

  it("reaches it through FOSS Earth for an app that does not have it", () => {
    const has = (...ids: string[]) => (id: string) => ids.includes(id);
    expect(headsetEmulatorDependency({ fromApp: has("foss-earth"), fromEmulator: has("iwer") })).toBe("foss-earth > iwer");
    expect(headsetEmulatorDependency({ fromApp: has("iwer", "foss-earth"), fromEmulator: has("iwer") })).toBe("iwer");
    expect(headsetEmulatorDependency({ fromApp: has(), fromEmulator: has("iwer") })).toBeNull();
  });

  it("reads the request, whatever else it asks", () => {
    expect(headsetEmulatorRequested("/tour/minneapolis/?headsetEmulator")).toBe(true);
    expect(headsetEmulatorRequested("/app/?headset=1")).toBe(false);
    expect(headsetEmulatorRequested(undefined)).toBe(false);
  });

  it("serves the script under any base", () => {
    expect(headsetEmulatorTag("/", "/a/b.ts").attrs).toEqual({ type: "module", src: "/@fs/a/b.ts" });
    expect(headsetEmulatorTag("/tour", "/a/b.ts").attrs).toEqual({ type: "module", src: "/tour/@fs/a/b.ts" });
  });
});
