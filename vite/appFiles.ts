/**
 * Keeps an app's own files on the visitor's device (docs/app-files.md): a
 * Vite plugin that writes FOSS Earth's service worker (appFilesWorker.js)
 * into a build, with the build's file list, and tells the app where it is.
 * An app built on FOSS Earth adds it to its vite.config.ts:
 *
 *   import { appFiles } from "foss-earth/vite";
 *   export default defineConfig({ plugins: [appFiles()] });
 *
 * The app registers the worker itself (src/app/appFiles.ts), as Settings →
 * App files asks. Without the plugin, nothing is kept and the browser's own
 * cache applies.
 *
 * It also stamps each page of a build with the time it was built, which is
 * how the app tells a browser's own copy of an older page from the page the
 * site publishes (src/app/publishedVersion.ts), and with the commits it was
 * built from: the app's own, and FOSS Earth's in an app of another
 * repository, which the app shows too (src/app/appIdentity.ts). The page's
 * source then says which version a site publishes, and the app which one a
 * device runs.
 */
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { appFiles as sharedAppFiles, appFilesWorker as sharedAppFilesWorker } from "@foss-earth/ui/vite";
import { definedString, buildStamp } from "@foss-earth/about/vite";
export { definedString, buildStamp } from "@foss-earth/about/vite";
import { BUILD_STAMP_META } from "../src/app/buildStamp.ts";

/** The worker's file, at the build's root beside its pages. */
export const APP_FILES_WORKER = "foss-earth-sw.js";
/** Earth explicitly retains its original current-only activation policy. */
export function appFilesWorker(fileNames: readonly string[]) {
  return sharedAppFilesWorker(fileNames, { retention: "current-only", cacheNamespace: "foss-earth-app-files" });
}

/** The names of the page's other two stamps: the app's own commit, and FOSS Earth's. */
export const APP_SOURCE_META = "foss-earth-app-source";
export const FOSS_EARTH_SOURCE_META = "foss-earth-source";
/** FOSS Earth's checkout: the folder above this one. */
const FOSS_EARTH_ROOT = fileURLToPath(new URL("..", import.meta.url));
/** What of FOSS Earth an app is built from: a change to anything else, as its docs, does not change the app. */
const BUILT_FROM = ["src", "vite", "package.json", "package-lock.json"];

/** A folder's own path, whatever link it was reached through; as given where it does not exist. */
function real(folder: string): string {
  try {
    return realpathSync(folder);
  } catch {
    return path.resolve(folder);
  }
}

/**
 * The commit of the FOSS Earth checkout at `root`, as "35ad0e3f1c2a", with
 * "-dirty" where what an app is built from has changes not committed; "" where
 * `root` is not a git checkout, as a copy installed from a package.
 */
export function fossEarthSource(root: string = FOSS_EARTH_ROOT): string {
  const git = (...args: string[]): string => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  try {
    // Only where `root` is the checkout itself: inside another repository's folder, git would answer with that one's commit.
    if (real(git("rev-parse", "--show-toplevel")) !== real(root)) return "";
    const commit = git("rev-parse", "--short=12", "HEAD");
    return commit ? `${commit}${git("status", "--short", "--", ...BUILT_FROM) ? "-dirty" : ""}` : "";
  } catch {
    return "";
  }
}

export function appFiles(): Plugin {
  let fossEarth = "";
  const producer = sharedAppFiles({ retention: "current-only", cacheNamespace: "foss-earth-app-files",
    stamps(config, env) {
      const stamp = env.command === "build" ? buildStamp(config.define) : "";
      const own = real(typeof config.root === "string" ? config.root : process.cwd()) === real(FOSS_EARTH_ROOT);
      fossEarth = own ? "" : fossEarthSource();
      return { [BUILD_STAMP_META]: stamp, [APP_SOURCE_META]: definedString(config.define, "__SOURCE_VERSION__"), [FOSS_EARTH_SOURCE_META]: fossEarth };
    },
  });
  return { ...producer,
    config(config, env) {
      const result = producer.config({ base: config.base, define: config.define, root: config.root }, env);
      return { define: { ...result.define, __FOSS_EARTH_SOURCE__: JSON.stringify(fossEarth) } };
    },
  } as Plugin;
}
