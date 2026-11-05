# Google 3D Tiles

Part of [Performance design](README.md).

## The job

Fetch, decode, keep and draw Google's photorealistic mesh tiles at the
detail target. Do it within a memory bound the visitor sets, and without
the main thread paying for any of it but the draw.

## The limit

- **Bytes are set by Google's format.** Each tile is glTF (glb) with float32
  positions and UVs, 8- or 16-bit indices, and JPEG textures. FOSS Earth
  cannot change that. It can only fetch fewer tiles and never fetch one
  twice.
- **Decode** can be entirely off the main thread.
- **GPU memory.** For the visible tiles plus a margin, in the cheapest form
  that draws the same picture:
  - 16-bit positions with a per-tile scale;
  - 16-bit UVs;
  - 16-bit indices;
  - compressed textures.

  That is about 22–24 bytes a vertex instead of 44, and 0.5–1 byte a texel
  instead of 5.3.
- **Draws.** One per batch of tiles that share a material, not one per tile.

## The design today

**Traversal.** 3d-tiles-renderer 0.4.24's Babylon adapter:

- `optimizedLoadStrategy` (skip levels of detail) is on, and the error
  target is 20 px.
- The engine replaces the view-error function with gaze weighting,
  proximity, focus regions and terrain regions
  ([`createTilesRuntime.ts`][e-tiles]).

**Decode.** A worker with a WebAssembly core parses the glb and decodes the
JPEG with `createImageBitmap` ([`google-WASM/worker.js`][r-worker]). It
returns:

- float32 positions and UVs;
- 32-bit indices;
- an `ImageBitmap`.

**Containers.** On the main thread, each tile gets an `AssetContainer`:

- a `Mesh` per primitive;
- an unlit `PBRMaterial` per material;
- a mipmapped RGBA8 texture.

The JPEG is kept for context-loss restoration. Babylon keeps CPU copies of
the vertex and index arrays ([`googleTilePreparation.ts`][r-prep]). A tile
draws only once `whenMeshesReady` resolves.

**Cache.**

- An LRU bounded by count: `map.google.cacheTiles`, 6,000–8,000. Eviction
  starts above 6,000.
- The adapter's `calculateBytesUsed` returns 1, so `map.google.cacheBytes`
  bounds nothing.

**Session.** Each page load asks for `root.json` and gets a new session.
Every tile URL carries it.

## The design that reaches the limit

1. **Count bytes**
   ([L5](../performance-limits.md#l5-count-google-tile-bytes-and-keep-indices-16-bit)).
   - The renderer builds each container, so it knows every buffer's size and
     the texture's: width × height × 4 × 4/3, or its compressed size.
   - Return those from `calculateBytesUsed`, and the LRU obeys MiB.
2. **Keep 16-bit indices.** The source is 8- or 16-bit. Widening to 32 bits
   doubles index memory and bandwidth for nothing.
3. **Quantize in the worker.**
   - Positions as 16-bit integers relative to the tile's box, with the
     box's scale and offset as uniforms.
   - UVs as 16-bit normalized integers.
   - Steps are the box's size ÷ 65,536: 3 cm for a 2 km tile, far under
     each tile's geometric error. This is the closest available to Google
     Earth's own 8-byte vertices.
4. **Compress textures on the GPU**
   ([L13](../performance-limits.md#l13-compress-textures-on-the-gpu)):
   encode each mip level to BC7, BC1, ETC2 or ASTC after decode.
5. **One material for every opaque tile.**
   - One unlit pipeline. Textures in a 2D array, one layer per tile, from a
     free-slot stack.
   - Per-tile data in one storage buffer, indexed by instance: the
     origin-relative transform and the texture layer.
   - Geometry in a few large GPU buffers, allocated with a TLSF or buddy
     allocator. Each tile is then `drawIndexed` with its own offsets, and a
     WebGPU render bundle replays the batch.
   - With multi-draw-indirect, a batch is one call.
6. **Reuse the session for its three hours**
   ([L20](../performance-limits.md#l20-reuse-a-google-session-for-its-three-hours)).
   - The same session makes the same URLs, so the next visit's tiles come
     from the browser's cache under Google's own headers.
   - It also saves one billed root request per visit. Google bills
     Photorealistic 3D Tiles per root request.
7. **Coarse tiles as gap fillers**
   ([L12](../performance-limits.md#l12-coarse-tiles-as-gap-fillers-not-as-blockers)).
   - Push each parent's depth back by its geometric error and draw it under
     its children. Each child then shows as soon as it arrives, and siblings
     off screen need not load.
   - Google Earth's octant masks do the same with geometry.
8. **CPU copies only where read.**
   - Keep compact geometry for tiles near the camera, where ground contact
     and picking need it, in the ground BVH.
   - Call `clearCachedData()` on the rest.
9. **Offer Babylon only the shown tiles**
   ([L8](../performance-limits.md#l8-offer-babylon-only-the-tiles-that-are-shown)).
   A hidden tile is at least two meshes, its root and its node, so 6,000
   retained tiles are 12,000 or more meshes in Babylon's per-frame walk.
10. **Update the traversal**
    ([L9](../performance-limits.md#l9-update-3d-tiles-renderer-to-054)).
    0.5.3 skips recomputing the view error for frame-state-only visits, and
    0.5.2 adds `errorFalloff` for the horizon.

## Why not the alternatives

| Alternative | Why it loses |
| --- | --- |
| Babylon's glTF loader on the main thread | JSON, accessors and materials on the main thread for every tile. Kept only as the fallback for unknown content |
| A material per tile (today) | One bind group and uniform buffer each; no batching; render bundles replay nothing |
| An LRU bounded by count (today) | 6,000 tiles of unknown size can be gigabytes on a phone |
| Loading every sibling with its parent | Downloads tiles off screen while turning. Gap fillers make it unnecessary |

## What others do

- **Google Earth** (rocktree, per [earth-reverse-engineering][rocktree]):
  - bulk metadata packets describing many nodes, so traversal needs fewer
    round trips;
  - 8-byte vertices with an octant mask;
  - JPEG or CRN-DXT1 textures.
- **CesiumJS:** byte-bounded tile cache (`cacheBytes`), decoding in workers,
  KTX2 textures where the data has them.
- **3d-tiles-renderer for three.js** has plugins this design matches:
  - `TileCompressionPlugin`: quantization;
  - `BatchedTilesPlugin`: batching;
  - `UnloadTilesPlugin`: freeing GPU copies of hidden tiles.

## How it is verified

- Bytes per tile on the GPU and in the CPU heap, from the byte accounting.
- Cache bytes after ten minutes of panning (M-2).
- Draws and `writeBuffer` calls per frame (M-3, M-5).
- Warm-visit bytes in keyed mode within three hours: near zero with session
  reuse.
- Pixels against today's with the tolerance test, for quantization and
  compression.

[e-tiles]: https://github.com/foss-earth/engine/blob/f77da98e85b1a4ae32dd9024b14342817600684f/src/babylon/createTilesRuntime.ts
[r-worker]: https://github.com/foss-earth/renderer/blob/63984f44225f07af070f41764202213e9040177e/google-WASM/worker.js#L58-L72
[r-prep]: https://github.com/foss-earth/renderer/blob/63984f44225f07af070f41764202213e9040177e/src/babylon/googleTilePreparation.ts
[rocktree]: https://github.com/retroplasma/earth-reverse-engineering
