# Imagery

Part of [Performance design](README.md).

## The job

Every pixel of ground samples a photograph at about one image pixel per
screen pixel, filtered, from the right zoom level. Where that level has not
arrived, a coarser one draws instead of nothing.

## The limit

- **Texels resident.** About the screen's pixels times 4/3 for mip levels,
  times a margin for tiles that overhang the view. That is roughly 10–20 MiB
  of RGBA8 on the desktop, and a quarter to an eighth of it compressed.
- **Bytes.** The provider's JPEGs for those texels: USGS sends 33–35 KB per
  256-pixel tile, about 4.3 bits a pixel.
- **Choosing.** What each pixel needs is known exactly to the GPU as it
  draws: the derivative of the imagery coordinate. Reading that costs
  microseconds; computing it on the CPU costs milliseconds.

## The design today: a virtual texture with a CPU selector

**Physical storage.**

- One large RGBA8 texture, the atlas, holds pages of 256 × 256 pixels. Each
  page sits in a 288-pixel slot with a 16-pixel gutter, so trilinear
  filtering down to mip level 4 never reads a neighbour
  ([`imageryAtlasLayout.ts:10–14`][e-atlas-plan]).
- Mips are written for the sampled levels only.

**Indirection.**

- Each terrain patch owns a block of a page-table texture. Each cell of the
  block names the slot and level that covers it.
- The terrain shader looks the cell up, then samples the atlas with explicit
  gradients ([`imageryMaterialPlugin.ts`][e-imat]).

**Selection.**

- A budgeted quadtree on the CPU measures each tile's projected texel
  footprint over sampled terrain heights: a 65 × 65 lattice per tile
  ([`imagerySelector.ts`][e-sel]).
- Residency keeps a demand order and an LRU of pages. Uploads go at most
  `map.imagery.uploadPerFrame` (2 MiB) a frame.

**Budget.** The atlas is planned as the largest that fits
`map.imagery.gpuBudget` and allocated whole at start. The default is 1/32 of
the memory the browser reports. Chrome reports at most 8 GiB, so that is
256 MiB on a desktop ([`loading.ts:31–41`][e-gpubudget]).

This is the design id Software's MegaTexture and Unreal's virtual textures
use. One part is missing: feedback from the GPU.

## The design that reaches the limit

**1. The GPU names the pages it needs** ([L4](../performance-limits.md#l4-let-the-gpu-say-which-imagery-it-needs)).

- **A small feedback pass.** Draw the terrain into a target about an eighth
  of the screen a side, 160 × 100 on the desktop. Each pixel writes the page
  it wants, packed in 32 bits: level, x and y. The level comes from
  log2 of the larger of `fwidth(uv) × pageSize`, as the hardware's own
  mip selection does, clamped to what the source offers.
- **Read it late.** Read it back asynchronously, a frame late: `mapAsync` on
  WebGPU, or a pixel buffer and a fence on WebGL2.
- **Count the pages.** Count distinct pages with a radix sort or a small open
  hash. That is about 16,000 entries, tens of microseconds. Each count is the
  page's area on screen, which is exactly the priority a loader needs
  ([Network and caches](network-and-caches.md)).
- **What it removes.** The CPU's lattice heights, footprints and
  measurements, the largest block of main-thread time left. Hidden ground
  asks for nothing, because only visible pixels write.
- **What stays on the CPU.** The CPU selector stays for the first frames,
  before terrain exists, and for WebGL1.

**2. Pages without wide gutters.**

- A 2D texture array holds one page per layer with its own mip chain, so
  filtering cannot bleed between pages.
- A 1–2 pixel border is enough for bilinear and anisotropic sampling at
  level 0.
- Today's 16-pixel gutters are 21% of the atlas.

**3. Compressed pages** ([L13](../performance-limits.md#l13-compress-textures-on-the-gpu)).

- After decode, encode each page and each of its mip levels to BC1 or BC7 on
  desktops and ETC2 or ASTC on phones, with a compute shader.
- Memory and sampling bandwidth fall by four to eight times.

**4. Grow, do not reserve** ([L22](../performance-limits.md#l22-let-the-imagery-atlas-grow)).

- Start with the working set and add layers as residency needs them, up to
  the budget.
- Growing an array is a GPU copy into a larger one.

**5. Evict by value, not only by age.**

- An LRU (a hash map and a doubly linked list, O(1)) drops the page used
  longest ago.
- For a moving camera, a better victim is the page with the least screen
  area per byte that is also farthest from the predicted view.
- Keep the LRU as the tie-break.

**6. Selection follows the drawn density.** The selector already measures
pixels in the drawing buffer, after hardware scaling. So the render-scale cap
in [Pixels](pixels.md) lowers imagery to what the eye resolves without more
work.

## Why not the alternatives

| Alternative | Why it loses |
| --- | --- |
| A texture per terrain tile (CesiumJS's imagery layers) | One bind per tile, no sharing between tiles, uploads tied to tiles |
| Render-to-texture draping per tile (MapLibre) | Redraws imagery into each tile's texture when it changes: fine for vector maps, costly for photographs |
| Only a CPU selector (today) | Cannot know what hills hide; costs the main thread milliseconds per update |
| One global page table | Web Mercator at zoom 19 has 2³⁸ pages. A sparse table works: a GPU hash table in a storage buffer, or per-patch blocks as today |

## What others do

- **Unreal Engine:** a feedback buffer read back asynchronously
  (`FVirtualTextureFeedbackBuffer`).
- **Unity:** the same idea (`VirtualTexturing.Resolver`).
- **id Tech 5:** the same feedback-driven design.
- **Google Earth:** sends textures as JPEG or in a GPU format, chosen per
  request ([earth-reverse-engineering][rocktree]).

## Where the code is

| Part | Status |
| --- | --- |
| Atlas, page table and gradient sampling | Done |
| Budgeted CPU selector with hysteresis | Done; heavily optimised and exact |
| GPU feedback | Open (L4) |
| Texture array pages, compressed pages, growth | Open (L13, L22) |
| Selection follows the render scale | Done: the drawing buffer's pixels |

## How it is verified

- Selection milliseconds per second while moving: near zero with feedback.
- Pages resident against pages the feedback asked for.
- Imagery bytes per reference view.
- Atlas bytes at settle (M-8).
- Pixels against today's with the tolerance test.

[e-sel]: https://github.com/foss-earth/engine/blob/f77da98e85b1a4ae32dd9024b14342817600684f/src/terrain/imagery/imagerySelector.ts
[e-imat]: https://github.com/foss-earth/engine/blob/f77da98e85b1a4ae32dd9024b14342817600684f/src/babylon/imagery/imageryMaterialPlugin.ts
[e-atlas-plan]: https://github.com/foss-earth/engine/blob/f77da98e85b1a4ae32dd9024b14342817600684f/src/terrain/imagery/imageryAtlasLayout.ts#L10-L14
[e-gpubudget]: https://github.com/foss-earth/engine/blob/f77da98e85b1a4ae32dd9024b14342817600684f/src/settings/catalogue/loading.ts#L31-L41
[rocktree]: https://github.com/retroplasma/earth-reverse-engineering
