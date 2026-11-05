# GPU

Part of [Performance design](README.md). How many pixels are shaded is in
[Pixels](pixels.md).

## The job

Each frame, submit the visible geometry with its uniforms. Put the draws in
an order that shades each visible fragment once and changes state rarely.
Keep enough precision for a planet 12,742 km across, seen from centimetres
away.

## The limit

- **CPU per frame:** O(1) when nothing but the camera changed. Only the
  camera's uniform buffer changes; every other buffer and every recorded
  command can be reused.
- **GPU per frame:** each visible fragment shaded about once. That needs
  depth testing that rejects hidden fragments before shading, so draws must
  run near to far.
- **Draw calls:** one per batch of meshes sharing a pipeline, or one in all
  with multi-draw-indirect.
- **Precision:** a float32 has 24 significant bits, so positions within
  4,096 m of the origin are exact to a quarter of a millimetre.

## Precision: where the origin is

**Today.**

- Both engines start with `useLargeWorldRendering: true`
  ([`createRendererMode.ts:64–79`][r-mode]). That gives 64-bit matrices on
  the CPU and Babylon's floating origin: each frame, the eye becomes the
  origin.
- Babylon then subtracts the eye from every mesh's world matrix as it is
  bound. Its override compares each uniform's name against strings and marks
  the result as new, so the uniform cache never hits.
- On every frame the eye moves, every drawn mesh pays four things:
  - a matrix copy;
  - 16 comparisons;
  - a whole-buffer comparison;
  - an upload.

  That work is O(meshes) per frame.

**The design: move the origin rarely**
([L3](../performance-limits.md#l3-move-the-origin-only-when-the-eye-has-moved-far)).

- Keep the origin fixed until the eye is more than R = 4 km from it, then
  move it once. Between moves, nothing but the camera's buffer changes.
- At 4 km, float32 positions are exact to 2⁻¹² m, a quarter of a
  millimetre.
- Error grows with distance from the origin, and so does the ground's
  distance from the eye. So the error in pixels is greatest near the eye,
  where it is smallest in metres.

**Alternatives.**

| Alternative | Why it loses |
| --- | --- |
| Floating origin every frame (today) | Every mesh's uniforms change every moving frame |
| Positions relative to the eye in the shader, with high and low float32 halves (CesiumJS's `czm_translateRelativeToEye`) | Exact everywhere, but every vertex shader of every material needs the double-float subtraction. More work than a rebase every few kilometres |
| Relative-to-centre positions per tile with a float32 world matrix | The matrix's translation, the tile's centre, rounds to 0.5 m steps at Earth's radius |
| Logarithmic depth | Not needed: reverse-Z depth with a float depth buffer is already on and gives near-constant relative precision |

## Submission

**Today.** Babylon 8.56 draws each mesh with its own material:

- a `StandardMaterial` with three plugins per terrain tile;
- an unlit `PBRMaterial` per Google tile material.

Babylon walks every mesh in the scene each frame. Opaque meshes are sorted
by material id (`PainterSortCompare`), not by depth. The whole frame is one
render pass (renderer `24b6a6d`).

**The design.**

1. **Static uniforms**, from the origin above. Then record each batch once
   into a WebGPU render bundle (Babylon's snapshot rendering, backlog B1) and
   replay it until its contents change. CPU work per frame falls toward
   O(1).
2. **Shared materials.**
   - Terrain becomes one instanced draw ([Terrain](terrain.md)).
   - Opaque Google tiles share one pipeline. Their textures sit in an array,
     their geometry in pooled buffers ([Google 3D Tiles](google-3d-tiles.md)).
3. **Only shown meshes as candidates**
   ([L8](../performance-limits.md#l8-offer-babylon-only-the-tiles-that-are-shown)):
   Babylon's walk becomes O(shown), not O(retained).
4. **Near to far for opaque draws**
   ([L24](../performance-limits.md#l24-draw-opaque-meshes-near-to-far)).
   - `RenderingGroup.frontToBackSortCompare`, or a radix sort on a 16-bit
     depth key, O(n).
   - Apple's GPUs hide overdraw on their own, which is why the M5 profiles
     do not show it. Desktop and many Android GPUs do not.
5. **Pipelines compiled before they are needed** (backlog S3 and B2):
   `createRenderPipelineAsync` on WebGPU, and `KHR_parallel_shader_compile`
   on WebGL, during the loading screen.

## Why not the alternatives

| Alternative | Why it loses |
| --- | --- |
| A material per tile (today) | A bind group and uniform buffer each; no batching |
| Sorting by material only (today) | Saves state changes that WebGPU pipelines already make cheap, and costs overdraw |
| Frustum culling twice | The tile selectors cull by frustum; Babylon culls every candidate again. Offer it only the shown ones |

## What others do

- **CesiumJS:** positions relative to the eye on the GPU; draw commands
  batched by pass.
- **Unreal Engine:** large-world coordinates, doubles on the CPU and
  tile-relative floats on the GPU.
- **Google Earth:** WebGL2, per the case study; its submission is not
  documented.

## How it is verified

- `writeBuffer` calls and draws per moving frame (M-5).
- CPU milliseconds of Babylon's render, from the frame profiler.
- GPU milliseconds per pass, from timestamp queries, on an Apple and a
  non-Apple GPU.

[r-mode]: https://github.com/foss-earth/renderer/blob/63984f44225f07af070f41764202213e9040177e/src/babylon/createRendererMode.ts#L64-L79
