import { realpathSync, existsSync } from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { appFiles, builtFrom, babylonShaderChunks } from "foss-earth/vite";

const root = realpathSync(process.cwd());
function publicResolutionProof(): Plugin {
  let plugins: string[] = [];
  let groups: string[] = [];
  return {
    name: "earth-installed-public-resolution-proof",
    configResolved(config) {
      plugins = config.plugins.map(plugin => plugin.name);
      const splitting = config.build.rolldownOptions.output;
      const output = Array.isArray(splitting) ? splitting[0] : splitting;
      const policy = output?.codeSplitting;
      groups = policy && typeof policy === "object"
        ? (policy.groups ?? []).flatMap(group => typeof group.name === "string" ? [group.name] : []) : [];
    },
    generateBundle() {
      const modules = [...this.getModuleIds()].map(id => {
        const file = id.split("?")[0];
        if (!path.isAbsolute(file) || !existsSync(file)) return { id, virtual: true };
        const resolved = realpathSync(file);
        if (!resolved.startsWith(root + path.sep)) throw new Error(`OUTSIDE_ISOLATED_BUILD: ${id}`);
        return { id, file: path.relative(root, resolved) };
      });
      this.emitFile({ type: "asset", fileName: "public-resolution-proof.json", source: JSON.stringify({ plugins, groups, modules }, null, 2) + "\n" });
    },
  };
}
export default defineConfig({
  publicDir: false,
  resolve: { dedupe: ["@babylonjs/core", "@babylonjs/loaders", "3d-tiles-renderer", "react", "react-dom"] },
  define: {
    __BUILD_TIME__: JSON.stringify("2026-10-09T00:00:00.000Z"),
    __SOURCE_VERSION__: JSON.stringify("installed-public-consumer"),
    __REPOSITORY_SLUG__: JSON.stringify("foss-earth/foss-earth.github.io"),
  },
  plugins: [react(), appFiles(), builtFrom(), babylonShaderChunks(), publicResolutionProof()],
  build: { outDir: "dist", emptyOutDir: false, manifest: true },
});
