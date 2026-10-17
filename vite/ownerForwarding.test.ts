import path from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BABYLON_BARREL as ownerBarrel, BABYLON_SHADER_GROUPS as ownerGroups, babylonBarrels as ownerBarrels, babylonShaderChunks as ownerShaderChunks } from "@foss-earth/renderer/vite";
import { buildStamp as ownerBuildStamp, definedString as ownerDefinedString, type BuildReader } from "@foss-earth/about/vite";
import { BABYLON_BARREL, BABYLON_SHADER_GROUPS, babylonBarrels, babylonShaderChunks } from "./babylonShaderChunks";
import { buildStamp, definedString } from "./appFiles";
import { describeBuild } from "./builtFrom";

const siteRoot = path.resolve(import.meta.dirname, "..");
const head = "a".repeat(40);
function changedCheckout(changed: string): BuildReader {
  return {
    // An injected reader can preserve the supplied path exactly. This catches
    // the directory URL's trailing slash dropping the host source policy.
    real: dir => dir,
    manifest: dir => dir === siteRoot ? { name: "host", version: "0.1.0" } : null,
    lock: () => null,
    exists: () => false,
    modified: () => null,
    git(dir, args) {
      if (dir !== siteRoot) return null;
      if (args[0] === "rev-parse") return args[1] === "--show-toplevel" ? siteRoot : head;
      if (args[0] === "remote") return "https://github.com/example/host.git";
      if (args[0] === "branch") return "  origin/main";
      if (args[0] === "log") return `${head}\x1f2026-10-10T00:00:00Z\x1f2026-10-10\x1fSynthetic source fixture`;
      if (args[0] === "status") {
        const paths = args.slice(args.indexOf("--") + 1);
        return paths.some(scope => scope === "." || changed === scope || changed.startsWith(scope + "/")) ? ` M ${changed}` : "";
      }
      return null;
    },
  };
}

describe("site Node build compatibility forwards public owners", () => {
  it("uses the same shader and build-stamp functions as the owner packages", () => {
    expect(BABYLON_SHADER_GROUPS).toBe(ownerGroups);
    expect(babylonShaderChunks).toBe(ownerShaderChunks);
    expect(BABYLON_BARREL).toBe(ownerBarrel);
    expect(babylonBarrels).toBe(ownerBarrels);
    expect(buildStamp).toBe(ownerBuildStamp);
    expect(definedString).toBe(ownerDefinedString);
  });

  it("keeps documentation-only changes outside the site's descriptive runtime dirty scope", () => {
    const tree = describeBuild({ root: siteRoot, built: "fixture", bundled: new Set(), reader: changedCheckout("docs/example.md") });
    expect(tree.app.dirty).toBeUndefined();
  });

  it("reports changed source from an injected reader that preserves path spelling", () => {
    const tree = describeBuild({ root: siteRoot, built: "fixture", bundled: new Set(), reader: changedCheckout("src/example.ts") });
    expect(tree.app.dirty).toBe(true);
  });

  it("lets an explicit host source scope and source stamp retain their precedence", () => {
    const input = { root: siteRoot, built: "fixture", bundled: new Set<string>(), reader: changedCheckout("docs/example.md"), sourceFiles: () => ["docs"] };
    expect(describeBuild(input).app.dirty).toBe(true);
    expect(describeBuild({ ...input, appSource: head }).app.dirty).toBeUndefined();
    expect(describeBuild({ ...input, appSource: `${head}-dirty` }).app.dirty).toBe(true);
  });
});

it("forwards worker production to UI while preserving explicit Earth cache and stamp policy", () => {
  const source = readFileSync(new URL("./appFiles.ts", import.meta.url), "utf8");
  expect(source).toContain('from "@foss-earth/ui/vite"');
  expect(source).toContain('retention: "current-only"');
  expect(source).not.toContain('readFileSync');
});
