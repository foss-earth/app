import type { IndexHtmlTransformContext } from "vite";
import { describe, expect, it } from "vitest";
import { findLazyFeatures, lazyFeatureChunks } from "./lazyFeatures";

type Bundle = NonNullable<IndexHtmlTransformContext["bundle"]>;
const chunk = (fileName: string, options: { facade?: string; modules?: string[]; imports?: string[]; dynamic?: string[]; size?: number }) => ({
  type: "chunk", fileName, facadeModuleId: options.facade ?? null, moduleIds: options.modules ?? (options.facade ? [options.facade] : []),
  imports: options.imports ?? [], dynamicImports: options.dynamic ?? [], code: "x".repeat(options.size ?? 10),
});

describe("lazyFeatures", () => {
  it("finds each feature's id and import, and not the ones in comments", () => {
    const code = `
      /** Example: defineLazyFeature({ id: "commented", load: () => import("./nowhere") }) */
      // defineLazyFeature({ id: "also-commented", load: () => import("./nowhere") })
      const editor = defineLazyFeature({
        id: "pose-editor",
        prefetch: "idle",
        load: () => import("./poseEditor/editor"),
      });
      const bindings = defineLazyFeature<typeof import("@felipegalind0/gamepad-tools/ui")>({ id: 'gamepad-editor', prefetch: "intent", load: () => import('@felipegalind0/gamepad-tools/ui') });
      export const defineLazyFeature = registry.define;
    `;
    expect(findLazyFeatures(code)).toEqual([
      { id: "pose-editor", specifier: "./poseEditor/editor" },
      { id: "gamepad-editor", specifier: "@felipegalind0/gamepad-tools/ui" },
    ]);
  });

  it("names the chunks a page can load for each feature, leaving out what the page already loads", () => {
    const bundle = Object.fromEntries([
      chunk("assets/index.js", { facade: "/app/src/main.tsx", imports: ["assets/babylon.js"], dynamic: ["assets/editor.js", "assets/ui.js"] }),
      chunk("assets/babylon.js", { modules: ["/app/node_modules/@babylonjs/core/scene.js"] }),
      chunk("assets/editor.js", { facade: "/app/src/app/poseEditor/editor.ts", imports: ["assets/babylon.js", "assets/shared.js"], size: 30 }),
      chunk("assets/shared.js", { modules: ["/app/src/app/poseEditor/poseStore.ts"], size: 5 }),
      chunk("assets/ui.js", { modules: ["/app/node_modules/gamepad-tools/dist/ui/index.js", "/app/node_modules/gamepad-tools/dist/ui/editor.js"], size: 20 }),
      chunk("assets/other-page.js", { facade: "/app/src/other.ts" }),
    ].map(output => [output.fileName, output])) as unknown as Bundle;
    const features = new Map([
      ["pose-editor", "/app/src/app/poseEditor/editor.ts"],
      ["gamepad-editor", "/app/node_modules/gamepad-tools/dist/ui/index.js"],
      ["in-startup", "/app/node_modules/@babylonjs/core/scene.js"],
      ["another-page", "/app/src/other.ts"],
    ]);
    expect(lazyFeatureChunks(bundle, "assets/index.js", features, "/app/")).toEqual({
      "pose-editor": { urls: ["/app/assets/editor.js", "/app/assets/shared.js"], bytes: 35 },
      "gamepad-editor": { urls: ["/app/assets/ui.js"], bytes: 20 },
      // Imported statically too: nothing left to fetch.
      "in-startup": { urls: [], bytes: 0 },
    });
  });
});
