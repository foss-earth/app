/**
 * `babylonShaderChunks()`: Babylon's shaders in one chunk per language, for an app that loads
 * the globe lazily, as 0sfs's flight does.
 *
 * Babylon's root module, which FOSS Earth imports, registers every shader as it loads, so such an
 * app loads nearly all of them, GLSL and WGSL alike. When the globe is not in the entry chunk,
 * Vite 8.3's bundler gives each shader, and each part that shaders share, a chunk of its own: 350
 * in 0sfs's build on 2026-10-08, of which its flight fetched 335, one request each. Grouped, the
 * flight fetched 151 files instead of 485, and 105 KB less JavaScript, with the same code in them.
 * An app whose entry chunk holds the globe has its shaders there already and gains nothing.
 */
import type { Plugin } from "vite";

/** The groups, by module path, for an app that sets its own `codeSplitting` groups. */
export const BABYLON_SHADER_GROUPS = [
  { name: "babylon-shaders-glsl", test: /[\\/]@babylonjs[\\/]core[\\/]Shaders[\\/]/ },
  { name: "babylon-shaders-wgsl", test: /[\\/]@babylonjs[\\/]core[\\/]ShadersWGSL[\\/]/ },
];

export function babylonShaderChunks(): Plugin {
  return {
    name: "foss-earth-babylon-shader-chunks",
    config: () => ({ build: { rolldownOptions: { output: { codeSplitting: { groups: BABYLON_SHADER_GROUPS } } } } }),
  };
}
