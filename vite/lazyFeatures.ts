/**
 * Names each lazy feature's chunks in a built page, so the page can fetch them early without running them
 * (src/app/lazyFeature.ts; docs/proposals/startup-loading.md, section 1). The features are the
 * `defineLazyFeature({ id: "…", …, load: () => import("…") })` calls in the code the build transforms; each
 * page lists the ones it can load, with the chunks it does not load already. Development pages have no list.
 */
import type { IndexHtmlTransformContext, Plugin, Rolldown } from "vite";
import { LAZY_FEATURES_ELEMENT_ID, type LazyFeatureChunks } from "../src/app/lazyFeatureChunks.ts";

const CALL = /\bdefineLazyFeature\s*(?:<[^>]*>)?\s*\(\s*\{/g;
const ID = /\bid\s*:\s*(["'`])([^"'`]+)\1/;
const IMPORT = /\bimport\s*\(\s*(["'`])([^"'`]+)\1\s*\)/;

/** Each call's id and import specifier, in a module's source. Comments are left out. */
export function findLazyFeatures(code: string): { id: string; specifier: string }[] {
  const source = code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const found: { id: string; specifier: string }[] = [];
  const starts = [...source.matchAll(CALL)].map(match => match.index!);
  starts.forEach((start, index) => {
    const body = source.slice(start, starts[index + 1] ?? start + 2000);
    const id = body.match(ID)?.[2];
    const specifier = body.match(IMPORT)?.[2];
    if (id && specifier) found.push({ id, specifier });
  });
  return found;
}

/** A page's base for its files, as Vite writes it into the page: absolute, or relative to the page. */
function pageBase(base: string, pagePath: string): string {
  if (/^(?:[a-z][\w+.-]*:)?\//i.test(base)) return base.endsWith("/") ? base : `${base}/`;
  const depth = pagePath.split("/").filter(Boolean).length - 1;
  return "../".repeat(depth) || "./";
}

type Bundle = NonNullable<IndexHtmlTransformContext["bundle"]>;
const chunkOf = (bundle: Bundle, fileName: string): Rolldown.OutputChunk | undefined => {
  const output = bundle[fileName];
  return output?.type === "chunk" ? output : undefined;
};
/** The chunks a page reaches from its entry: following static imports only, or dynamic ones too. */
function reach(bundle: Bundle, entry: string, dynamic: boolean): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const chunk = chunkOf(bundle, queue.shift()!);
    if (!chunk || seen.has(chunk.fileName)) continue;
    seen.add(chunk.fileName);
    queue.push(...chunk.imports, ...(dynamic ? chunk.dynamicImports : []));
  }
  return seen;
}

/** Each feature the page can load, by the module its import() names, with the chunks the page does not load. */
export function lazyFeatureChunks(bundle: Bundle, entry: string, features: ReadonlyMap<string, string>, prefix: string): Record<string, LazyFeatureChunks> {
  const loaded = reach(bundle, entry, false);
  const reachable = reach(bundle, entry, true);
  const result: Record<string, LazyFeatureChunks> = {};
  for (const [id, moduleId] of features) {
    const candidates = [...reachable].map(name => chunkOf(bundle, name)!);
    const home = candidates.find(chunk => chunk.facadeModuleId === moduleId) ?? candidates.find(chunk => chunk.moduleIds.includes(moduleId));
    if (!home) continue;
    const files = [...reach(bundle, home.fileName, false)].filter(name => !loaded.has(name));
    result[id] = { urls: files.map(name => prefix + name), bytes: files.reduce((total, name) => total + chunkOf(bundle, name)!.code.length, 0) };
  }
  return result;
}

export function lazyFeatures(): Plugin {
  let base = "/";
  // Feature id to the module its import() names, as resolved.
  const features = new Map<string, string>();
  return {
    name: "foss-earth-lazy-features",
    enforce: "pre",
    apply: "build",
    configResolved(config) { base = config.base; },
    buildStart() { features.clear(); },
    async transform(code, id) {
      if (!code.includes("defineLazyFeature")) return null;
      for (const { id: feature, specifier } of findLazyFeatures(code)) {
        const resolved = await this.resolve(specifier, id);
        if (!resolved || resolved.external) { this.warn(`Lazy feature ${feature}: cannot resolve ${specifier}`); continue; }
        const known = features.get(feature);
        if (known && known !== resolved.id) this.warn(`Lazy feature ${feature} is defined twice, for ${known} and ${resolved.id}`);
        features.set(feature, resolved.id);
      }
      return null;
    },
    transformIndexHtml(_html, ctx) {
      if (!ctx.bundle || !ctx.chunk || features.size === 0) return;
      const chunks = lazyFeatureChunks(ctx.bundle, ctx.chunk.fileName, features, pageBase(base, ctx.path));
      if (Object.keys(chunks).length === 0) return;
      return [{ tag: "script", attrs: { type: "application/json", id: LAZY_FEATURES_ELEMENT_ID }, children: JSON.stringify(chunks).replace(/</g, "\\u003c"), injectTo: "head" }];
    },
  };
}
