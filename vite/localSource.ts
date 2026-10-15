import { readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { normalizePath, searchForWorkspaceRoot, type Plugin } from "vite";

interface Manifest {
  name: string;
  dependencies?: Record<string, string>;
  exports?: Record<string, string | { source?: string }>;
}

/**
 * The query without the optimizer's `v=` version. Vite gives it to the files of
 * an excluded package and the browser keeps those for a year, which suits an
 * installed build. A checkout changes under the same version, so a browser that
 * kept a module ran it beside newer ones that need what it lacks.
 */
function withoutVersion(suffix: string): string {
  if (!suffix.startsWith("?")) return suffix;
  const hashAt = suffix.indexOf("#");
  const query = suffix.slice(1, hashAt < 0 ? undefined : hashAt);
  const kept = query.split("&").filter(part => !/^v=[\w.-]+$/.test(part)).join("&");
  return (kept ? `?${kept}` : "") + (hashAt < 0 ? "" : suffix.slice(hashAt));
}

/** Use linked CSS source and serve watched scripts with Earth's installed dependencies. */
export function localSource(options: { root?: string } = {}): Plugin {
  const root = realpathSync(options.root ?? path.resolve(import.meta.dirname, ".."));
  const packageFile = path.join(root, "package.json");
  const manifest = JSON.parse(readFileSync(packageFile, "utf8")) as Manifest;
  const packages = new Map([[manifest.name, normalizePath(root)]]);
  for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
    if (!version.startsWith("file:")) continue;
    const folder = path.resolve(root, version.slice(5));
    // A packed file dependency is an installed build, not a source checkout.
    if (statSync(folder).isDirectory()) packages.set(name, normalizePath(realpathSync(folder)));
  }
  const roots = [...packages.values()];
  const sourceFile = (file: string) => !file.includes("/node_modules/")
    && roots.some(folder => file === folder || file.startsWith(`${folder}/`));
  const stylesheetAliases = [...packages].flatMap(([name, folder]) => {
    const { exports = {} } = JSON.parse(readFileSync(path.join(folder, "package.json"), "utf8")) as Manifest;
    return Object.entries(exports).flatMap(([subpath, entry]) => {
      if (!subpath.endsWith(".css") || subpath.includes("*")) return [];
      const target = typeof entry === "string" ? entry : entry.source;
      if (!target) return [];
      const id = name + subpath.slice(1);
      const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return [{
        find: new RegExp(`^${escaped}(?=[?#]|$)`),
        replacement: normalizePath(realpathSync(path.resolve(folder, target))),
      }];
    });
  });
  let serving = false;

  return {
    name: "foss-earth-local-source",
    enforce: "pre",
    config(config, { command }) {
      serving = command === "serve";
      // CSS @imports use Vite's separate resolver, which ignores the source
      // condition and this plugin's resolveId hook. Aliases reach that resolver
      // in development and builds, selecting current CSS from the checkout.
      const resolve = { alias: stylesheetAliases };
      if (!serving) return { resolve };
      return {
        resolve,
        // Preserved symlink paths otherwise look like installed dependencies to the optimizer.
        optimizeDeps: { exclude: [...packages.keys()] },
        server: { fs: { allow: [
          ...(config.server?.fs?.allow ? [] : [searchForWorkspaceRoot(path.resolve(config.root ?? "."))]),
          ...roots,
        ] } },
      };
    },
    async resolveId(id, importer, resolveOptions) {
      if (!serving) return null;
      if (!/^(?![a-zA-Z]:)[\w@](?!.*:\/\/)/.test(id)) return null;
      const name = id.match(/^(?:@[^/]+\/)?[^/?#]+/)?.[0];
      const importedFromSource = importer && sourceFile(normalizePath(importer.split(/[?#]/, 1)[0]));
      if (!packages.has(name ?? "") && !importedFromSource) return null;

      // Once source paths are canonical, a library has no node_modules of its own.
      // Resolving from Earth's package keeps those imports working; Vite's dedupe
      // still selects the host's shared React and Babylon copies.
      const resolved = await this.resolve(id, packageFile, { ...resolveOptions, skipSelf: true });
      if (!resolved || resolved.external || !path.isAbsolute(resolved.id)) return resolved;
      const [file] = resolved.id.split(/[?#]/, 1);
      // The optimizer names a dependency before it writes the file. realpath on
      // that path throws, and Vite prints it once for every importing module.
      let canonical: string;
      try {
        canonical = normalizePath(realpathSync(file));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        return resolved;
      }
      if (!sourceFile(canonical)) return resolved;
      return { ...resolved, id: canonical + withoutVersion(resolved.id.slice(file.length)) };
    },
  };
}
