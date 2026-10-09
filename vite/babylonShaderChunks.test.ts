import { describe, expect, it } from "vitest";
import { BABYLON_SHADER_GROUPS, babylonShaderChunks } from "./babylonShaderChunks";

const groupOf = (id: string): string | null => BABYLON_SHADER_GROUPS.find(group => group.test.test(id))?.name ?? null;

describe("babylonShaderChunks", () => {
  it("puts each language's shaders in its own chunk and leaves the rest of Babylon and the app alone", () => {
    expect(groupOf("/app/node_modules/@babylonjs/core/Shaders/pbr.fragment.js")).toBe("babylon-shaders-glsl");
    expect(groupOf("/app/node_modules/@babylonjs/core/Shaders/ShadersInclude/pbrUboDeclaration.js")).toBe("babylon-shaders-glsl");
    expect(groupOf("/app/node_modules/@babylonjs/core/ShadersWGSL/pbr.fragment.js")).toBe("babylon-shaders-wgsl");
    expect(groupOf("C:\\app\\node_modules\\@babylonjs\\core\\ShadersWGSL\\default.vertex.js")).toBe("babylon-shaders-wgsl");
    expect(groupOf("/app/node_modules/@babylonjs/core/Materials/PBR/pbrMaterial.js")).toBeNull();
    expect(groupOf("/app/node_modules/@babylonjs/core/Engines/shaderStore.js")).toBeNull();
    expect(groupOf("/app/src/shaders/terrain.fragment.ts")).toBeNull();
  });

  it("gives Vite the groups as the bundler's code splitting", () => {
    const config = (babylonShaderChunks().config as () => unknown)();
    expect(config).toEqual({ build: { rolldownOptions: { output: { codeSplitting: { groups: BABYLON_SHADER_GROUPS } } } } });
  });
});
