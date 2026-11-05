# Terrain

Part of [Performance design](README.md).

## The job

- A surface under the imagery whose relief is within the detail target on
  screen.
- Exact CPU height queries wherever the program asks: ground contact,
  picking, the camera's eye contact, imagery selection.

## The limit

- **Heights a view needs.** One per vertex. A screen needs a vertex for every
  4 × 4 to 8 × 8 pixels, so tens of thousands of heights. A 64-segment tile
  has 65² = 4,225.
- **Bytes.** Terrain is smooth, so a height predicted from its neighbours and
  entropy-coded costs about a byte. A view's heights are a few hundred KiB.
- **Memory.** 4 bytes a height in float32, 2 in a 16-bit form scaled per
  tile: 17 KB or 8 KB per tile.
- **CPU per frame.** Zero. A height read on the GPU costs nothing on the CPU.

## The design today

`createRasterTilesRuntime.ts`, `terrainLoader.ts`, `terrainImageDecoder.ts`:

1. **Fetch.** A terrain tile at level L downloads the 512 × 512 elevation
   tile at level min(L − `coarserElevation`, 15).
   - That is a lossless Terrarium WebP from Mapterhorn, 59–86 KB.
   - `coarserElevation` is 0 by default.
2. **Decode.** In a worker: `createImageBitmap`, then a canvas, then
   `getImageData`, then Terrarium to float32. The result is a 1 MiB
   `Float32Array`, kept in an LRU of 256 grids.
3. **Mesh.** 65² vertices, each a pixel-centre bilinear sample. Positions
   are float32 and a tile's own buffers are uploaded once. Edge vertices
   read neighbouring grids, and seams are stitched on the CPU.
4. **Draw.** One mesh and one `StandardMaterial` per tile, with three
   plugins (lighting, region highlight, imagery atlas)
   ([`createRasterTilesRuntime.ts:329–333`][e-raster-mat]).

## The design that reaches the limit

**1. Sample at the mesh's rate** ([L1](../performance-limits.md#l1-elevation-at-the-meshs-own-sampling-rate)).

- Take heights from the elevation level whose pixels match the vertices:
  level L − log2(512 ÷ segments), which is L − 3 for 64 segments.
- Measured over downtown Minneapolis, that moves vertex heights by 0.22 m on
  average and 1.66 m at the 99th percentile. Zoom 12 is within 0.32 m of the
  zoom-15 data averaged over 8 × 8 pixels: the same surface, correctly
  filtered.
- One elevation tile then serves 64 terrain tiles.
  - Elevation downloads fell 75% on the tour.
  - On the live app's opening view they fell about 60%, and the complete
    view came 64% sooner
    ([measured](../performance-limits.md#measured-for-this-report)).

**2. One grid for every tile (CDLOD).** Strugar's Continuous
Distance-Dependent Level of Detail (2009).

- **One mesh for all tiles.** A single 65 × 65 grid with 16-bit indices,
  instanced once per selected tile. Each instance carries the tile's origin,
  size, level and texture slot.
- **Heights in the vertex shader.** Each vertex reads its height from a
  texture array. It then morphs toward the parent level's position as its
  distance approaches the level's limit. Neighbouring levels therefore meet
  without cracks, without stitching and without popping.
- **Storage.** Each tile's heights live in one layer of a texture array.
  Slots come from a free-list stack, O(1) to take and return. A map from the
  tile's numeric key to its slot finds a layer.
- **Decode.**
  - Upload the provider's RGBA bytes into an integer texture (`rgba8uint`),
    so the shader reads exact bytes, and decode Terrarium there:
    R × 256 + G + B ÷ 256 − 32768 needs 24 significant bits, which fits a
    float32 exactly.
  - Encoded values cannot be filtered, so read the four neighbours with
    `textureLoad` and interpolate in the shader.
  - Upload with `writeTexture` from decoded bytes, not
    `copyExternalImageToTexture`, so no colour conversion can touch the
    heights.
- **CPU heights.** Keep a 65² float32 copy (17 KB) of each tile near the
  camera, or near a query, for contact and picking. The rest stay on the
  GPU.

**3. Decode without copies.** Where WebCodecs exists, `ImageDecoder` and
`VideoFrame.copyTo` write pixels straight into a buffer, with no canvas and
no readback ([L6](../performance-limits.md#l6-keep-elevation-compressed-decode-only-what-meshes-read)).

**4. Keep encoded bytes, not decoded ones.**

- A grid no shown mesh uses goes back to its 86 KB WebP form.
- The cache is bounded in bytes.
- Today's cache is both too small and too large. Its 256 entries (256 MiB)
  overflow on one first view, which caused 98 re-downloads in 631 on the tour
  ([performance notes][en-notes]), while it holds 62 times the heights its
  meshes read.

**What it removes.**

- mesh building and its workers;
- the terrain commit and seam stitching;
- neighbour downloads for edge vertices;
- per-tile materials;
- almost all of the 256 MiB of float grids.

All terrain becomes one instanced draw.

## Why not the alternatives

| Alternative | Why it loses here |
| --- | --- |
| Point-sampling the finest elevation (today) | 15–60 times the bytes and memory, and aliased |
| A TIN per tile (Cesium quantized-mesh) | Fewest vertices on flat ground and the fewest bytes, but needs a server-side data set we do not have. Each tile needs its own index buffer, and morphing is harder |
| Geometry clipmaps (Losasso and Hoppe) | Ideal for a flat heightmap. On a globe the nested rings must follow curvature and do not line up with Web Mercator tiles. CDLOD's quadtree does, and its selection already exists |
| Skirts instead of stitching (backlog R4) | Simpler, but they draw hidden geometry and still pop. Morphing fixes both |
| Heights uploaded per tile as meshes (today) | CPU builds, CPU stitches and uploads 133 KB per tile, against 17 KB of heights |

## What others do

- **MapLibre:** one shared terrain grid; heights from a DEM texture in the
  vertex shader; DEM tiles coarser than imagery.
- **CesiumJS:** quantized-mesh TIN tiles, decoded in workers; it upsamples a
  parent where a child is missing.
- **Google Earth:** meshes in its own format, with vertices packed into
  8 bytes.
- **Game engines** (Unreal's and Unity's terrains): a quadtree of instanced
  grid patches, heights in textures, distance morphing.

## Where the code is

| Part | Status |
| --- | --- |
| Sampling at the mesh's rate | Built as `coarserElevation`, off by default (L1) |
| Shared CPU indices and UVs | Done on the CPU; GPU buffers still one per tile (backlog R1) |
| Float32 positions | Done (R2) |
| Meshes built in workers | Partial, opt-in (R3) |
| One grid with heights in textures | Open (R5, [L10](../performance-limits.md#l10-one-terrain-grid-heights-in-textures)) |
| A byte-bounded, encoded cache | Open (L6) |

## How it is verified

- Elevation bytes and requests per reference view (M-1).
- Decoded bytes held (M-2).
- Terrain milliseconds per second on the main thread: zero for meshes once
  R5 lands.
- Heights against today's: mean, 99th percentile and largest difference,
  with this page's method, in several regions.
- Pixels against today's with the tolerance test.

[e-raster-mat]: https://github.com/foss-earth/engine/blob/f77da98e85b1a4ae32dd9024b14342817600684f/src/babylon/createRasterTilesRuntime.ts#L329-L333
[en-notes]: https://github.com/foss-earth/engine/blob/main/docs/performance-notes.md
