/**
 * Cross-origin isolation for the dev and preview servers: the headers a page
 * needs before the browser lets it share WebAssembly memory with workers, so a
 * threaded core can run. Off unless asked, so nothing changes by default:
 * `FOSS_EARTH_ISOLATION=enforce` isolates the page; `report-only` sends the
 * report-only headers, which block nothing and name what would break.
 * `FOSS_EARTH_COEP=require-corp` asks every cross-origin resource to opt in;
 * the default, `credentialless`, loads them without credentials instead, which
 * the map, terrain and Google tile requests already are.
 *
 * Static hosts such as GitHub Pages cannot send these headers. A build's
 * service worker adds them instead (appFiles(), ui/vite/appFilesWorker.js and
 * ui/src/browser/isolation.ts), as `deployedIsolation()` says: it enforces
 * unless FOSS_EARTH_ISOLATION at build time asks for `report-only` or `off`.
 */
import type { Connect, Plugin } from "vite";

export type IsolationMode = "off" | "report-only" | "enforce";
export type EmbedderPolicy = "credentialless" | "require-corp";
export interface CrossOriginIsolationOptions {
  mode?: IsolationMode;
  embedder?: EmbedderPolicy;
}

const MODES: readonly IsolationMode[] = ["off", "report-only", "enforce"];
const EMBEDDERS: readonly EmbedderPolicy[] = ["credentialless", "require-corp"];

/** The mode and embedder policy from options, then FOSS_EARTH_ISOLATION and FOSS_EARTH_COEP; unknown values are refused. */
export function isolationPolicy(options: CrossOriginIsolationOptions = {}, env: Record<string, string | undefined> = process.env): Required<CrossOriginIsolationOptions> {
  const mode = options.mode ?? (env.FOSS_EARTH_ISOLATION?.trim() || "off");
  const embedder = options.embedder ?? (env.FOSS_EARTH_COEP?.trim() || "credentialless");
  if (!MODES.includes(mode as IsolationMode)) throw new TypeError(`FOSS_EARTH_ISOLATION must be one of ${MODES.join(", ")}.`);
  if (!EMBEDDERS.includes(embedder as EmbedderPolicy)) throw new TypeError(`FOSS_EARTH_COEP must be one of ${EMBEDDERS.join(", ")}.`);
  return { mode: mode as IsolationMode, embedder: embedder as EmbedderPolicy };
}

/**
 * What a build's worker may do for its pages: `enforce` unless
 * FOSS_EARTH_ISOLATION, at build time, says `report-only` or `off`. The worker
 * isolates only pages whose Settings → App files → Cross-origin isolation is on
 * (the default), always with COEP require-corp, which Safari supports.
 */
export function deployedIsolation(env: Record<string, string | undefined> = process.env): IsolationMode {
  const mode = env.FOSS_EARTH_ISOLATION?.trim() || "enforce";
  if (!MODES.includes(mode as IsolationMode)) throw new TypeError(`FOSS_EARTH_ISOLATION must be one of ${MODES.join(", ")}.`);
  return mode as IsolationMode;
}

/** The response headers for a policy: none when off. */
export function isolationHeaders(policy: Required<CrossOriginIsolationOptions>): Record<string, string> {
  if (policy.mode === "off") return {};
  const suffix = policy.mode === "report-only" ? "-Report-Only" : "";
  return { [`Cross-Origin-Opener-Policy${suffix}`]: "same-origin", [`Cross-Origin-Embedder-Policy${suffix}`]: policy.embedder };
}

export function crossOriginIsolation(options: CrossOriginIsolationOptions = {}): Plugin {
  const headers = isolationHeaders(isolationPolicy(options));
  const add: Connect.NextHandleFunction = (_request, response, next) => {
    for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
    next();
  };
  return {
    name: "foss-earth-cross-origin-isolation",
    configureServer: server => { if (Object.keys(headers).length) server.middlewares.use(add); },
    configurePreviewServer: server => { if (Object.keys(headers).length) server.middlewares.use(add); },
  };
}
