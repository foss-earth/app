/**
 * An emulated VR headset for `npm run dev`: a page opened with
 * `?headsetEmulator=quest3` (or `quest2`, `questPro`) gets
 * src/dev/headsetEmulator.ts ahead of its own scripts, so VR can be tried and
 * tested without a headset. The dev server only: a build never holds it.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { HtmlTagDescriptor, Plugin } from "vite";

export const HEADSET_EMULATOR_PARAMETER = "headsetEmulator";

const CLIENT = fileURLToPath(new URL("../src/dev/headsetEmulator.ts", import.meta.url));

/** Whether a page request asks for the emulated headset. */
export function headsetEmulatorRequested(url: string | undefined): boolean {
  if (!url) return false;
  try { return new URL(url, "http://localhost").searchParams.has(HEADSET_EMULATOR_PARAMETER); } catch { return false; }
}

/** The script that installs the emulated headset, before the page's own, under the dev server's `base`. */
export function headsetEmulatorTag(base: string, client = CLIENT): HtmlTagDescriptor {
  const src = `${base.endsWith("/") ? base : `${base}/`}@fs${client.split(path.sep).join("/")}`;
  return { tag: "script", attrs: { type: "module", src }, injectTo: "head-prepend" };
}

export function headsetEmulator(): Plugin {
  let base = "/";
  return {
    name: "foss-earth-headset-emulator",
    apply: "serve",
    config(config) {
      // Prepared with the other dependencies, so a first emulated page does not reload the dev server's.
      const root = path.resolve(config.root ?? process.cwd());
      try { createRequire(path.join(root, "package.json")).resolve("iwer"); } catch { return; }
      return { optimizeDeps: { include: ["iwer"] } };
    },
    configResolved(config) { base = config.base; },
    transformIndexHtml(_html, context) {
      return headsetEmulatorRequested(context.originalUrl) ? [headsetEmulatorTag(base)] : undefined;
    },
  };
}
