import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { build as viteBuild, createServer, defaultClientConditions, normalizePath } from "vite";
import { expect, it } from "vitest";
import { localSource } from "./localSource";

const write = (file: string, contents: string | object) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, typeof contents === "string" ? contents : JSON.stringify(contents));
};
const link = (from: string, to: string) => {
  mkdirSync(path.dirname(to), { recursive: true });
  symlinkSync(from, to, "dir");
};
const scratchFolder = () => {
  const build = path.resolve(import.meta.dirname, "../build");
  mkdirSync(build, { recursive: true });
  return realpathSync(mkdtempSync(path.join(build, "local-source-")));
};

it("serves linked source live across hosts and resolves its dependencies from Earth", async () => {
  const scratch = scratchFolder();
  const host = path.join(scratch, "host");
  const earth = path.join(scratch, "earth");
  const ui = path.join(scratch, "ui");
  write(path.join(host, "package.json"), { name: "tour-fixture", type: "module" });
  write(path.join(host, "src/main.ts"), 'import "./style.css"; export * from "foss-earth";');
  write(path.join(host, "src/style.css"), '@import "foss-earth/style.css";');
  write(path.join(earth, "package.json"), {
    name: "foss-earth", type: "module", exports: { ".": "./src/index.ts", "./style.css": "./src/style.css" },
    dependencies: { "@foss-earth/ui": "file:../ui", "jpeg-js": "1.0.0" },
  });
  write(path.join(earth, "src/index.ts"), 'export * from "@foss-earth/ui";');
  write(path.join(ui, "package.json"), {
    name: "@foss-earth/ui", type: "module", exports: {
      ".": { source: "./src/index.ts", import: "./dist/index.js" },
      "./details": { source: "./src/details.ts", import: "./dist/details.js" },
      "./styles.css": { source: "./src/styles/ui.css", default: "./dist/styles/ui.css" },
      "./log.css": "./styles/log.css",
    },
  });
  const uiFile = normalizePath(path.join(ui, "src/index.ts"));
  const source = (mode: string) => `export const mode: string = ${JSON.stringify(mode)}; export { decode } from "jpeg-js"; export { identity } from "react";`;
  write(uiFile, source("before"));
  write(path.join(ui, "src/details.ts"), 'export const details = "source";');
  write(path.join(ui, "dist/index.js"), 'export const mode = "stale-build";');
  write(path.join(ui, "dist/details.js"), 'export const details = "stale-build";');
  write(path.join(earth, "src/style.css"), '@import "@foss-earth/ui/styles.css"; @import "@foss-earth/ui/log.css";');
  write(path.join(ui, "src/styles/ui.css"), '@import "./nested.css"; .ui { --fixture-ui-source: live; }');
  write(path.join(ui, "dist/styles/ui.css"), '.ui { --fixture-ui-stale-build: stale; }');
  write(path.join(ui, "styles/log.css"), '.log { --fixture-log-source: live; }');
  const nestedCssFile = normalizePath(path.join(ui, "src/styles/nested.css"));
  const nestedCss = (mode: string) => `.nested { --fixture-nested-source: ${mode}; }`;
  write(nestedCssFile, nestedCss("before"));
  for (const [folder, name, body] of [
    [path.join(earth, "node_modules/jpeg-js"), "jpeg-js", 'export const decode = "earth-jpeg";'],
    [path.join(earth, "node_modules/react"), "react", 'export const identity = "earth-react";'],
    [path.join(host, "node_modules/react"), "react", 'export const identity = "host-react";'],
  ]) {
    write(path.join(folder, "package.json"), { name, type: "module", exports: "./index.js" });
    write(path.join(folder, "index.js"), body);
  }
  link(earth, path.join(host, "node_modules/foss-earth"));
  link(ui, path.join(earth, "node_modules/@foss-earth/ui"));

  const server = await createServer({
    configFile: false,
    root: host,
    logLevel: "silent",
    resolve: { conditions: ["source", ...defaultClientConditions], preserveSymlinks: true, dedupe: ["react"] },
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false, fs: { allow: [host] }, watch: { usePolling: true, interval: 40 } },
    plugins: [
      localSource({ root: earth }),
      { name: "pending-optimizer-file", resolveId(id) {
        if (id !== "pending-dep") return null;
        return path.join(host, "node_modules/.vite/deps/pending-dep.js");
      } },
    ],
  });
  try {
    const resolve = (id: string, importer: string) => server.environments.client.pluginContainer.resolveId(id, importer);
    expect((await resolve("foss-earth", path.join(host, "src/main.ts")))?.id).toBe(normalizePath(path.join(earth, "src/index.ts")));
    expect((await resolve("@foss-earth/ui", path.join(earth, "src/index.ts")))?.id).toBe(uiFile);
    expect((await resolve("@foss-earth/ui/details?raw", path.join(host, "src/main.ts")))?.id)
      .toBe(normalizePath(path.join(ui, "src/details.ts")) + "?raw");
    expect((await resolve("jpeg-js", uiFile))?.id).toBe(normalizePath(path.join(earth, "node_modules/jpeg-js/index.js")));
    expect((await resolve("react", uiFile))?.id).toBe(normalizePath(path.join(host, "node_modules/react/index.js")));
    // A dependency the optimizer has named but not written yet must not throw.
    const pending = await resolve("pending-dep", uiFile);
    expect(pending?.id).toBe(normalizePath(path.join(host, "node_modules/.vite/deps/pending-dep.js")));
    expect(server.config.optimizeDeps.exclude).toEqual(expect.arrayContaining(["foss-earth", "@foss-earth/ui"]));
    expect(server.config.optimizeDeps.exclude).not.toContain("react");
    expect(server.config.server.fs.allow).toEqual(expect.arrayContaining([host, earth, ui]));

    // CSS @imports use Vite's separate resolver, whose conditions omit "source".
    // Both conditional and string CSS exports must reach watched checkout files.
    const cssUrl = "/src/style.css";
    const css = (await server.transformRequest(cssUrl))?.code;
    expect(css).toContain("--fixture-ui-source: live");
    expect(css).toContain("--fixture-log-source: live");
    expect(css).toContain("--fixture-nested-source: before");
    expect(css).not.toContain("--fixture-ui-stale-build");
    expect((await resolve("@foss-earth/ui/styles.css?raw", path.join(host, "src/main.ts")))?.id)
      .toBe(normalizePath(path.join(ui, "src/styles/ui.css")) + "?raw");
    await expect.poll(() => server.watcher.getWatched()[path.dirname(nestedCssFile)]).toContain("nested.css");
    write(nestedCssFile, nestedCss("after"));
    await expect.poll(async () => (await server.transformRequest(cssUrl))?.code, { timeout: 5000 })
      .toContain("--fixture-nested-source: after");

    const url = `/@fs/${uiFile}`;
    expect((await server.transformRequest(url))?.code).toContain('"before"');
    // The real checkout path is watchable; node_modules symlink paths are ignored by Vite.
    await expect.poll(() => server.watcher.getWatched()[path.dirname(uiFile)]).toContain("index.ts");
    write(uiFile, source("after"));
    await expect.poll(async () => (await server.transformRequest(url))?.code, { timeout: 5000 }).toContain('"after"');

    // Production must compile the same CSS as development without rebuilding UI.
    const result = await viteBuild({
      configFile: false,
      root: host,
      logLevel: "silent",
      resolve: { conditions: ["source", ...defaultClientConditions], preserveSymlinks: true, dedupe: ["react"] },
      build: { write: false, rolldownOptions: { input: path.join(host, "src/main.ts") } },
      plugins: [localSource({ root: earth })],
    });
    if (Array.isArray(result) || !("output" in result)) throw new Error("Expected a single completed build");
    const stylesheets = result.output.flatMap(output => output.type === "asset" && output.fileName.endsWith(".css") ? [String(output.source)] : []);
    expect(stylesheets).toHaveLength(1);
    expect(stylesheets[0]).toContain("--fixture-ui-source:live");
    expect(stylesheets[0]).toContain("--fixture-log-source:live");
    expect(stylesheets[0]).toContain("--fixture-nested-source:after");
    expect(stylesheets[0]).not.toContain("--fixture-ui-stale-build");
  } finally {
    await server.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}, 10_000);

it("leaves the optimizer's version off linked source, which changes under one version", async () => {
  // Vite versions an excluded package's files with the optimizer's hash and the
  // browser keeps them for a year. A checkout changes under the same hash: on
  // 2026-10-14 a browser ran the app's new createGlobeApp with its old compass.
  const scratch = scratchFolder();
  const host = path.join(scratch, "host");
  const earth = path.join(scratch, "earth");
  const ui = path.join(scratch, "ui");
  write(path.join(host, "package.json"), { name: "tour-fixture", type: "module" });
  write(path.join(earth, "package.json"), {
    name: "foss-earth", type: "module", exports: { ".": "./src/index.ts" }, dependencies: { "@foss-earth/ui": "file:../ui" },
  });
  write(path.join(earth, "src/index.ts"), 'export * from "@foss-earth/ui"; export * from "./more";');
  write(path.join(earth, "src/more.ts"), "export const more = 1;");
  write(path.join(ui, "package.json"), {
    name: "@foss-earth/ui", type: "module", exports: {
      ".": { source: "./src/index.ts", import: "./dist/index.js" },
      "./details": { source: "./src/details.ts", import: "./dist/details.js" },
    },
  });
  const uiFile = normalizePath(path.join(ui, "src/index.ts"));
  write(uiFile, 'export const mode = "source";');
  write(path.join(ui, "src/details.ts"), 'export const details = "source";');
  link(earth, path.join(host, "node_modules/foss-earth"));
  link(ui, path.join(earth, "node_modules/@foss-earth/ui"));

  const server = await createServer({
    configFile: false,
    root: host,
    logLevel: "silent",
    resolve: { conditions: ["source", ...defaultClientConditions], preserveSymlinks: true },
    server: { middlewareMode: true, hmr: false, fs: { allow: [host] } },
    plugins: [localSource({ root: earth })],
  });
  try {
    const optimizer = server.environments.client.depsOptimizer;
    await optimizer?.scanProcessing;
    expect(optimizer?.metadata.browserHash).toMatch(/^\w+$/);
    const earthFile = normalizePath(path.join(earth, "src/index.ts"));
    const resolve = (id: string) => server.environments.client.pluginContainer.resolveId(id, earthFile);
    expect((await resolve("@foss-earth/ui"))?.id).toBe(uiFile);
    expect((await resolve("@foss-earth/ui/details?raw"))?.id).toBe(normalizePath(path.join(ui, "src/details.ts")) + "?raw");
    const code = (await server.transformRequest(`/@fs${earthFile}`))?.code ?? "";
    expect(code).toContain(`/@fs${uiFile}"`);
    expect(code).toMatch(/\/more\.ts"/);
    expect(code).not.toMatch(/[?&]v=/);
  } finally {
    await server.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}, 10_000);
