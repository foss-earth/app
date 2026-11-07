# Performance limits

Status: proposal, 5 November 2026, revised the same day after a red-team pass
([Revisions](#revisions) lists what changed). An audit of the code deployed
now (the checkouts in [`deployed-from.json`](../../deployed-from.json), app
`7e97aaa`). For each cost it asks two questions: what is the least the job
could physically cost, and what would close the gap. Nothing here is built.
Measurements are marked as such; everything else is an estimate.

Read it with the [optimization backlog][backlog], the
[performance ledger][ledger] and the [performance audit][audit]. Items those
documents already hold keep their IDs (T2, R5, P1, P-092 and so on). New items
are numbered L1, L2 and so on.

Why each algorithm and data structure is the right one, subsystem by
subsystem, is in [Performance design](performance-design/README.md).

## In short

- **Startup code and the still page are near their floors.**
  - The JavaScript a page needs before its first frame fell from 1.43 to
    0.68 MiB brotli.
  - A cold first 3D frame takes about 2.8 s on Fast 4G with a 4× CPU
    slowdown. The floor is near 2 s.
  - A still page draws on demand and uses about 1% of the main thread.
- **The exact track is spent.** The work so far kept every pixel and output
  bit the same.
  - The 21 October audit put every target within 2–4% of its same-behaviour
    floor.
  - The 27 October session could not separate a frame-rate change.
  - What remains needs a different way of doing the work, or a decision.
- **Data is where the large gaps are.**
  - A keyless first view downloads tens of MiB: 41 MiB for the tour on a
    phone, 55 MiB for the app in October. In both views measured by kind,
    78–90% of that is elevation; the second was measured on the live app for
    this report. The floor is about 2–3 MiB.
  - The page's renderer process holds 5–7 times its floor in memory.
  - A moving frame costs its main thread about 8 times its floor.
- **The cheapest wins are already measured.** Three changes in the
  [ledger][ledger] wait only on a decision. Together they save about
  110 ms/s at the phone drag at 4×, about a seventh of its main thread. They
  come first below.

## What to do, in order

### 1. Measured, waiting on a decision

| Item | Change | Measured gain | Cost |
| --- | --- | --- | --- |
| P-071 | The Still Activity outline as the default. The setting exists | About 47 ms/s of style and paint at the phone drag at 4×; 50.5 → 52.7 frames/s | A default |
| P-074 | Re-measure the loaded-detail readout at the selector's 100 ms cadence, not on every publish | About 45 of its 53.6 ms/s at the phone drag at 4× | S |
| P-077 | Skip Google tiles wholly below the horizon, behind a setting | About 15 ms/s at the phone drag at 4× | S |
| [L1](#l1-elevation-at-the-meshs-own-sampling-rate) | `map.terrain.coarserElevation` follows the mesh: 3 for 64 segments | Elevation −75% on the tour and about −60% on the live app's opening view, whose complete view came 64% sooner. Vertex heights move 0.22 m on average, 1.66 m at the 99th percentile (measured for this report) | A default |
| [L7](#l7-phone-pixel-defaults) (P-075) | Phone pixel defaults: a device-pixel cap, upscaling, dynamic resolution, an opaque canvas, no MSAA. All built | Fragment work −50–70% on a 2.6× phone (estimate) | Defaults |

P-073 (check imagery heights only at admission) and P-072 (one raster update
a frame in 0SFS) also wait on decisions; re-measure them first.

### 2. Exact and small: no decision needed

| Item | Change | Gain (estimate) | Cost |
| --- | --- | --- | --- |
| [L23](#l23-open-the-tile-connections-from-the-html) | Open the tile hosts' connections from the HTML (`preconnect`). **Done 6 November** (P-107) | About three round trips, ~0.5 s on Fast 4G, off the first tiles of a cold visit | S |
| [L20](#l20-reuse-a-google-session-for-its-three-hours) | Reuse a Google 3D Tiles session for its three-hour life | A keyed visitor's next visit reads its tiles from the browser cache instead of downloading them again, and makes one billed root request less | S |
| [L21](#l21-remember-elevation-that-does-not-exist) | Remember elevation tiles that do not exist. **Done 6 November** (P-108) | Outside Mapterhorn's regional coverage, no failed request for each fine tile | S |
| [L19](#l19-draw-only-what-changed-while-maps-stream) | Draw only what changed while maps stream | Most of the ~3,600 frames a 60 s cold load draws with a still camera | S–M |
| [L8](#l8-offer-babylon-only-the-tiles-that-are-shown) | Offer Babylon only the tiles that are shown | Babylon's per-frame walk scales with shown tiles, not with up to ~16,000 retained meshes | S |
| [L5](#l5-count-google-tile-bytes-and-keep-indices-16-bit) | Count Google tile bytes; keep their indices 16-bit | The cache obeys its 307–410 MiB setting, not 6,000–8,000 tiles; index memory −50% | S |
| [L24](#l24-draw-opaque-meshes-near-to-far) | Draw opaque meshes near to far | Less overdraw on GPUs without hidden-surface removal | S |
| [L6](#l6-keep-elevation-compressed-decode-only-what-meshes-read) | Keep elevation compressed; decode only what meshes read | Up to ~200 MiB, and no re-downloads from a cache that overflows | S–M |
| [L22](#l22-let-the-imagery-atlas-grow) | Let the imagery atlas grow as needed | Most of the 256 MiB of GPU memory it commits at start on a desktop | M |
| [L26](#l26-send-cross-origin-requests-past-the-service-worker) | Send tile requests past the service worker (static routes) | A hop through the worker's thread for each of hundreds of tiles | S |

### 3. Larger changes

| Item | Change | Gain (estimate) | Cost | Kind |
| --- | --- | --- | --- | --- |
| [L2](#l2-bake-the-opening-view) | Bake the opening view, which every new visitor sees, into one prepared file | A complete opening view in about 3–7 s on Fast 4G instead of about 60 s | M | Build-time data |
| [L3](#l3-move-the-origin-only-when-the-eye-has-moved-far) | Move the world's origin only when the eye has moved far, not every frame | No uniform rewrite and upload per drawn mesh per moving frame; render bundles (B1) pay off | M | Sub-millimetre rounding |
| [L4](#l4-let-the-gpu-say-which-imagery-it-needs) | Let the GPU say which imagery each pixel needs | Most of selection, measurement and the readout: about 2–3 ms of a 13 ms frame at the phone drag at 4× | L | Different imagery choice |
| [L10](#l10-one-terrain-grid-heights-in-textures) | One shared terrain grid, heights in textures (backlog R5) | No mesh building, stitching, neighbour downloads or float grids in JavaScript | L | Edge vertices change |
| [L9](#l9-update-3d-tiles-renderer-to-054) | 3d-tiles-renderer 0.4.24 → 0.5.4 | Cheaper traversal; `errorFalloff` is backlog T1 | M | Adapter work |

Then, with smaller or less certain gains:

- [L11](#l11-one-request-queue-ordered-by-benefit-per-byte): one request queue
  for all map data, ordered by benefit per byte.
- [L12](#l12-coarse-tiles-as-gap-fillers-not-as-blockers): coarse Google
  tiles as gap fillers, so children need not wait for their siblings.
- [L13](#l13-compress-textures-on-the-gpu): GPU texture compression, for
  texture memory ÷4 to ÷8.
- [L14](#l14-the-sky-on-the-gpu): the sky from small GPU tables, with haze.
- [L15](#l15-one-worker-pool): one worker pool instead of seven kinds of
  worker.
- [L16](#l16-vr-draw-both-eyes-at-once): VR multiview and fixed foveation.
- [L17](#l17-show-the-last-frame-at-once): show the last frame at once on a
  warm start.
- [L18](#l18-hosting-that-sends-headers): hosting that sends headers, so a
  first visit needs no isolation reload.

Most items in sections 1 and 3 change pixels a little, and the project
accepts only bit-identical changes today. [L25](#l25-a-tolerance-test-for-changes-that-are-not-bit-identical)
proposes the test that would let them land.

The L numbers are IDs, not ranks. The sections below group the items by what
they save.

## How the floors were found

The [performance audit][audit] defines a floor as what is left once every
known waste is removed. That is an upper bound on the floor. This document
asks a different question: what does the job require? The arithmetic is
given, so each figure can be checked.

These floors are for a still, settled view. Motion needs headroom: tiles
just outside the view, and detail fetched ahead of the camera. Public
providers also cannot send heights at a mesh's resolution. So a practical
target sits two to three times above each floor. The ratios below show where
the room is, not what any one change will win.

- **Reference views.**
  - Desktop: 1280 × 800 CSS pixels at one device pixel per CSS pixel,
    1.02 million pixels. This is the audit's own view.
  - Phone: 412 × 915 CSS pixels at 2.625, which is 1081 × 2402 = 2.6 million
    device pixels.
- **Fast 4G** is DevTools' preset: 1,012,500 B/s (0.97 MiB/s) and 165 ms of
  latency.
- **Measured figures** come from the [performance audit][audit], the
  [startup proposal][startup] and the engine's [performance notes][en-notes],
  each as dated there. Code facts are from the deployed commits, with links.
- **Not measured in this session.** The app could not be built here, so
  there is no new measurement. Typecheck stopped on
  `@felipegalind0/gamepad-tools`, whose package exports only an uncommitted
  `dist/`, and on sky's `@photostructure/tz-lookup`, which the app's
  `package.json` does not install. Building the first or installing the
  second was not permitted in this sandbox.

## Where each cost stands

| Cost | Now | Floor | Gap | How the floor is reached |
| --- | --- | --- | --- | --- |
| Bytes to complete a keyless first view | Phone tour view: 41.3 MiB (37.1 elevation, 4.2 imagery). App desktop view: 55 MiB on 19 October; the deployed build had fetched 26.6 MiB in 300 s of software rendering and was still loading | 2–3 MiB | 15–25× | Imagery at one texel per pixel is about 0.55 MiB on the desktop: USGS's 256-pixel JPEGs measure 33–35 KB, about 4.3 bits a pixel. A height per mesh vertex, after prediction and entropy coding, is about 1 byte. Allow 3× for tiles that overhang the screen and for coarse levels |
| Of that, elevation | 37.1 MiB, 442 tiles of 86 KiB | 0.2–1 MiB | 40–150× | A screen needs a height for every 4 × 4 to 8 × 8 pixels: tens of thousands of heights. Each terrain tile downloads 262,144 heights, of which its 64-segment mesh reads about 17,000 |
| Time to complete it, cold, Fast 4G | About 60 s (app) | About 4–6 s | 10–15× | The link is busy the whole time, so time ≈ bytes ÷ 0.97 MiB/s. Add a few round trips and startup |
| Main thread per moving frame | 4.3 ms at 1× on the M5 (app drag); about 13 ms at 4× | About 0.5 ms; about 2 ms at 4× | About 8× | Input and camera take microseconds. Draw submission is O(1) with static uniforms and render bundles. Selection reads a small GPU feedback image |
| Renderer process memory | 1,529 MiB (app) | 200–300 MiB | 5–7× | About 1 MP of texels with mips, compressed. Geometry in 16-bit attributes. One copy of each thing |
| GPU graphics memory | 562 MiB (macOS count) | 100–150 MiB | 4–5× | Compressed textures, 16-bit geometry, one MSAA target |
| Fragment work, phone | 2.6 MP × 4 MSAA samples | Pixels at about 1.5 per CSS pixel, upscaled | 2.2–3× | Past about 300 pixels per inch at arm's length the eye resolves no more |
| Warm start to globe | 1.59 s (app, Fast 4G, 4×) | About 0.3–0.5 s, and about 0.06 s to a convincing picture | 3–5× | Startup code from the code cache, tiles from disk cache, a picture of the last frame shown at once ([L17](#l17-show-the-last-frame-at-once)) |
| Cold start to first 3D frame | 2.77 s (Fast 4G, 4×, 1.09 MiB) | About 2 s | About 1.4× | 1.09 MiB ÷ 0.97 MiB/s, plus three round trips and compilation |
| Still page | About 1% of the main thread | 0 | — | Already drawn on demand |

The largest gaps are data (L1, L2, L6, L19–L21), then the moving frame's main
thread (L3, L4, L8), then memory and phones (L5, L7, L22).

## Data: bytes, time to a complete view, memory

A visitor who has neither saved a Google key nor signed in sees the raster
globe: Mapterhorn elevation and USGS imagery
([`createGlobeRuntime.ts:450`][e-globe-450]). The 55 MiB, 60 s cold view in
the [19 October audit][audit-19] is most likely that path:

- the audit starts each cold visit on an empty profile;
- it points the terrain proximity LOD at "the terrain share" of the bytes.

The engine's notes split the tour's phone view: 37.1 MiB of elevation and
4.2 MiB of imagery ([performance notes][en-notes]). Elevation is nine tenths
of what a new visitor waits for.

### L1. Elevation at the mesh's own sampling rate

**What happens now.**

- A terrain tile has 64 segments a side, so 65² = 4,225 vertices
  ([`loading.ts:394`][e-load-394]).
- Up to level 15, it takes its heights from its own 512 × 512 elevation tile
  ([`loading.ts:264`][e-load-264]: `coarserElevation` falls back to 0).
  Mapterhorn is capped at zoom 15 ([`terrainGrid.ts:18`][e-src-18]), so a
  level-16 tile already reads its parent's.
- That tile is a lossless WebP of about 86 KiB (59–80 KB for the downtown
  tiles fetched for this report). It decodes to a 1 MiB `Float32Array`
  ([`terrainImageDecoder.ts:23–38`][e-dec]).
- Each vertex is a bilinear sample at a pixel centre
  ([`terrainGrid.ts:46–55`][e-grid]). So on each axis a vertex reads 2 of
  the 8 pixels in its span, and the mesh reads about 17,000 of the tile's
  262,144 pixels (6%).
- An edge vertex reads past the tile's edge, so its neighbours must
  download too. Before the queue fixes, that was 212 of 631 downloads
  ([performance notes][en-notes]).

**Why the default is not the accurate choice.**

- At terrain level 15 the elevation pixels are about 2.4 m apart at the
  equator, and the vertices about 19 m. Sampling every eighth pixel with a
  two-pixel filter aliases. The heights that reach the mesh depend on where
  each vertex falls among the pixels, and they jump when a tile changes
  level.
- Three levels up, each pixel of the coarser tile covers exactly one span of
  the 64-segment mesh: one pixel per vertex, the sampling rate the mesh can
  show. The setting's own description says so: "even 3 levels keep about one
  pixel per vertex".

**What a coarser level changes, measured for this report.**

- **Method.** A 4 × 4 block of level-15 tiles over downtown Minneapolis (x
  7892–7895, y 11788–11791), with their zoom 14, 13 and 12 ancestors, fetched
  from Mapterhorn on 5 November 2026. Heights were decoded as Terrarium and
  sampled as `sampleOwnGrid` does, at the 63,504 interior vertices of the
  16 meshes (edge vertices left out, since they read neighbours).
- **Results.**

  | `coarserElevation` | Mean change | 95th percentile | 99th percentile | Largest | Largest gap to a box filter of the level-15 data |
  | --- | --- | --- | --- | --- | --- |
  | 1 | 0.03 m | 0.09 m | 0.27 m | 3.4 m | 0.06 m |
  | 2 | 0.10 m | 0.33 m | 0.81 m | 7.5 m | 0.15 m |
  | 3 | 0.22 m | 0.78 m | 1.66 m | 11.8 m | 0.32 m |

- **What it shows.**
  - Here the coarser tiles are the same data, filtered: zoom 12 is within
    0.32 m of the zoom-15 heights averaged over 8 × 8 pixels.
  - The few large changes are aliasing: a point sample that lands on a sharp
    edge, such as a bank or a building, that a 19 m mesh cannot show anyway.
- **Where it may not hold.** Mapterhorn's planet archive stops at zoom 12,
  and zoom 13 and up come from regional archives. Where those use different
  sources, the coarser level is different data, not just filtered data, so
  repeat the measurement in a few regions before relying on it. Outside
  regional coverage, zoom 12 is the finest tile anyway (L21).

**Proposal.**

- Default `map.terrain.coarserElevation` to log2(512 ÷ segments), not 0: 3
  for 64 segments, 2 for 128, 1 for 256. A host's saved value still wins.
- Keep 0 as a choice for anyone who wants the old point samples.

**Gain.**

- Measured on the Minneapolis tour: about 75% less elevation downloaded and
  decoded at 3 levels, 60% at 1 level ([`loading.ts:265`][e-load-264]).
- Measured on the live app's opening view for this report
  ([Measured for this report](#measured-for-this-report)):
  - about 60% less elevation;
  - the complete view 64% sooner, at the same render scale;
  - at full scale, the only setting that completed the view within 300 s.
- One decoded grid serves 64 terrain tiles instead of one. Decode work and
  memory per tile fall by up to 64×, so the 256-entry cache covers 64 times
  the ground.
- Seven in eight terrain-tile edges now fall inside one elevation tile, so
  most neighbour downloads go.

**Cost and risk.**

- It is a change of default. In the measured block, heights move by 0.22 m
  on average and by up to 12 m at sharp edges, toward the filtered value.
  Ground contact, imagery draping and the camera's eye contact all read the
  same surface, so they stay consistent with each other.
- Photo placement heights are prepared at build time
  ([agent reference][agent-ref]), so they do not follow this setting.

### L2. Bake the opening view

**What happens now.** Every visitor without a saved view opens at the same
camera: 600 m above downtown Minneapolis
([`cameraDefaults.ts:3`][e-camdef]). Each of them downloads the same
hundreds of tiles from third-party servers, 16 requests at a time per kind,
finest last. In the 19 October audit that took 59.6 s on Fast 4G.

**Proposal.** Prepare the opening view at build time. This is the rule the
org already follows: [prefer build-time work][agent-ref].

- A build script loads the opening view to completion and records every
  elevation and imagery tile it used.
- It writes them into one file: the imagery as JPEG or AVIF, and the
  elevation either as the provider's tiles at L1's level or reduced to the
  heights the meshes read, delta-coded.
- The page fetches that file in parallel with its modules. It fills the
  terrain loader's cache and the imagery residency from it, then asks the
  live servers only for what the file lacks.
- Do the same for each tour stop and each scene's opening camera.

**Floor arithmetic.**

- Imagery for 1 MP at about 4.3 bits per pixel, the rate USGS's 33–35 KB
  tiles have, is about 0.55 MiB. Coarse levels and overhang bring it to
  about 1.5 MiB.
- Elevation is about 2–4 MiB as the provider's tiles at L1's level. Reduced
  to the heights the view's meshes read (about 100 tiles × 4,225 heights, at
  about a byte each), it is a few hundred KiB.
- So the pack is about 2–5.5 MiB. It shares the link with the modules'
  1.1 MiB, so the complete opening view should arrive in about 3–7 s on Fast
  4G, not 60 s.

**Licences.** USGS imagery is a work of the U.S. government. Mapterhorn
publishes open elevation with attribution. Check both before
redistributing. Google 3D Tiles may not be stored this way, so this is for
the keyless globe only.

**Cost.** M. It needs a preparation script, a pack format, and a test that
the packed view draws the same pixels as the live one.

### L6. Keep elevation compressed, decode only what meshes read

**What happens now.**

- The terrain loader keeps up to 256 decoded grids
  ([`terrainLoader.ts:6`][e-loader-6]; the app's `map.loader.cacheEntries`,
  [`browserPolicy.ts:46`](../../src/app/browserPolicy.ts)).
- Each grid is a 512² `Float32Array` of 1 MiB, so the cache alone can hold
  256 MiB.
- Decoding makes an `ImageBitmap`, draws it on a canvas, reads it back with
  `getImageData`, then converts it to floats. That is about 3 MiB of
  transient arrays per tile ([`terrainImageDecoder.ts:23–38`][e-dec]).
- The 19 October audit could name only 210–330 MiB of the app's 1,529 MiB.
  This cache is a likely part of the rest.
- It is too small as well as too large. One first view needs more than 256
  grids, so grids are evicted and downloaded again: 98 of 631 downloads on
  the tour before the queue fixes ([performance notes][en-notes]). Kept
  encoded, the same memory holds twelve times as many tiles.

**Proposal.**

- Bound the cache by bytes, not entries.
- Keep the encoded WebP (86 KiB) for tiles that no shown mesh uses, and
  decode it again on demand.
- Keep decoded floats only for the tiles shown. With L1, that is one grid
  per 64 terrain tiles.
- In workers, decode with WebCodecs `ImageDecoder` where it exists. Its
  `VideoFrame.copyTo` writes the pixels straight into a buffer, without the
  canvas and its readback copy.

**Gain.** About 200 MiB of the renderer's memory at a full cache (estimate),
and one 1 MiB copy less per decode.

**Exactness.** Heights stay identical for every reader. Only where the
pixels live changes.

### L5. Count Google tile bytes, and keep indices 16-bit

**What happens now.**

- 3d-tiles-renderer's Babylon adapter returns 1 from `calculateBytesUsed`
  (`3d-tiles-renderer@0.4.24`, `src/babylonjs/renderer/tiles/TilesRenderer.js:285`).
  So `map.google.cacheBytes` (307–410 MiB) limits a count of tiles. The real
  limit is `map.google.cacheTiles`, 6,000–8,000 tiles, and nothing is freed
  until 6,000 are kept ([`loading.ts:269–297`][e-load-269]). At even a
  quarter of a megabyte a tile, that is 1.5 GB before eviction starts.
  Upstream's current master still returns 1.
- The Google worker widens every index buffer to `Uint32Array`
  ([`worker.js:70`][r-worker-70]). The tile stored them as 8- or 16-bit
  (`sourceIndexComponentType` 5121 or 5123).
- Positions and UVs stay `Float32`.
- Each tile keeps its JPEG on the CPU for context-loss restoration
  ([`googleTilePreparation.ts:142`][r-prep-142]). Babylon keeps CPU copies
  of vertex and index data as well.

**Proposal.**

1. **Count bytes now, without waiting for upstream.** The renderer builds
   each tile's container itself (`installGoogleTilePreparation`), so it
   knows every size: positions, UVs and indices, the texture at
   width × height × 4 × 4/3, and the JPEG it keeps. Install a
   `calculateBytesUsed` that adds them up. `map.google.cacheBytes` then
   means what its label says, and the count limit becomes a safety net
   (backlog T2).
2. **Keep 16-bit indices** when a primitive has fewer than 65,536 vertices.
   That is every source with 8- or 16-bit indices. The drawing is exact.
3. **Quantize in the worker,** where precision allows. Store positions as
   16-bit integers with a scale and offset per tile, and UVs as 16-bit
   normalized integers. Sixteen bits across a tile's box gives steps of its
   size ÷ 65,536: 3 cm for a 2 km tile, far below each tile's own geometric
   error. That is the closest to Google Earth's own 8-byte vertices
   (see [Competitors](#what-competitors-do-that-this-does-not)). It needs
   a material plugin for the scale. It changes positions within their
   error, so it is a decision (backlog T7).

**Gain.**

- Memory obeys its setting, so a phone is less likely to lose its GPU
  context or the tab.
- Index memory and upload fall by half.
- Quantization takes geometry from about 44 to about 22–24 bytes a vertex.
  That figure counts positions, UVs and six 32-bit indices per vertex,
  before Babylon's CPU copies.

### L9. Update 3d-tiles-renderer to 0.5.4

0.4.24 is from April 2026; 0.5.4 came out on 3 November 2026. Since then
upstream has added:

- **0.5.3:** traversal skips recomputing the view error for tiles visited
  only to update their frame state, "significantly reducing traversal time".
- **0.5.2:** `errorFalloff` and `errorFalloffDensity`, a distance falloff of
  the error target that mirrors CesiumJS's `dynamicScreenSpaceError`. That
  is backlog T1, horizon detail, already written. 0.5.2 also gives each host
  its own download queue.
- **0.5.0:** a fix for "unconditional traversal behavior" and for tiles
  stuck visible.
- **0.5.4:** a Babylon `TilesFadePlugin` (backlog T16).

The engine wraps adapter internals and checks the adapter by name
(`nativeViewSnapshot.adapter === "babylonjs-0.4.24"`,
[`createTilesRuntime.ts:29`][e-tiles-29]). So the update is M, not S. Rerun
the selector digests after it.

One change in 0.5.0 needs care: all renderers now share one LRU cache and one
set of download and parse queues by default. The engine sets those limits on
its own renderer (`applyLoadingParameters`), so give it its own cache and
queues again, or set the limits once for all.

## Network

The design behind these is in
[Network and caches](performance-design/network-and-caches.md).

### L20. Reuse a Google session for its three hours

**What happens now.**

- Every Google request carries `key=` and `session=`. The session comes from
  that page load's own `root.json` response
  (`3d-tiles-renderer@0.4.24`, `core/plugins/auth/GoogleCloudAuth.js:56–99`).
- Nothing in the engine or the app reuses it
  ([`createTilesRuntime.ts`][e-tiles-29]).
- The map cache skips `tile.googleapis.com` and leaves Google tiles to the
  browser's cache ([`mapCache.ts:54`][e-mapcache]).
- So each visit's tile URLs differ from the last visit's, and the browser's
  cache cannot match them. A keyed visitor probably downloads the whole view
  again on every visit. That is not measured yet (M-7).

**Google's terms of use.**

- A root tileset request allows "up to three hours of renderer tile requests"
  ([Map Tiles API usage and billing][g-billing]).
- Photorealistic 3D Tiles are billed per root request. Every page load is
  one.

**Proposal.**

- Keep the session token, its key and its start time in `sessionStorage` or
  `localStorage`, and reuse it until shortly before three hours.
- On a 4xx, the auth plugin already refreshes the token.

**Gain.** A revisit within three hours reads its tiles from the browser's
cache, under Google's own cache headers, and saves one billed root request.

**Exactness.** Exact.

### L21. Remember elevation that does not exist

**What happens now.**

- Mapterhorn's planet archive covers zooms 0–12. Zooms 13 and up exist only
  in its regional archives.
- Probed for this report: at latitude 0°, longitude 20° (central Africa),
  zooms 15, 14 and 13 answer 404, and zoom 12 answers 200 (95 KB). Downtown
  Minneapolis answers 200 at zooms 14 and 15.
- The loader turns a 404 into a request for the parent
  ([`terrainLoader.ts:100–117`][e-loader-100]). The parent is cached, but
  every child tile still makes its own failing request first.
- So outside regional coverage, which is most of the planet, each terrain
  tile at level 13 or finer costs one failed round trip. Its parents cost up
  to two more, shared with their siblings.

**Proposal.** Keep a set of missing keys (numeric). Before a request, walk
up the tile's ancestors, at most 15 steps, and stop at the first missing one.
Then use its nearest existing ancestor without asking the network. A 404 is
cacheable for seven days (Mapterhorn's `max-age=604800`), so a second visit
only repeats it from the disk cache.

**Gain.** Hundreds of failed requests, and their round trips and request
slots, on a first view outside coverage. Not measured; count them in one
uncovered view.

**Exactness.** Exact: the same grids are used.

**Status.** Done 6 November (P-108). The loader also checks again when a
queued tile gets its download slot. 2 km above 0°, 20°E, the first view's
404s fell from 46 to 30 (median of three pairs). The rest are the first
wave, sent before any 404 came back, not hundreds. After the camera moved
5 km, the control made 15 failed requests and the change none. A
differential harness over 20,193 loader calls gave the same grids, with 51%
fewer requests and 95% fewer 404s. It rests on Mapterhorn keeping no tile
without its parent, which held in every probe.
[Note](https://github.com/foss-earth/engine/blob/main/docs/performance/2026-11-06/missing-elevation.md).

### L23. Open the tile connections from the HTML

**What happens now.** The page has no `preconnect` or `dns-prefetch`
([`index.html`](../../index.html), and the published page). The first
elevation and imagery requests start after the modules run, about 2 s into a
cold visit. Each then pays DNS, TCP and TLS first: about three round trips,
0.5 s on Fast 4G.

**Proposal.**

```html
<link rel="preconnect" href="https://tiles.mapterhorn.com" crossorigin>
<link rel="preconnect" href="https://basemap.nationalmap.gov" crossorigin>
```

- `crossorigin` matches the tile fetches' CORS mode.
- Add `tile.googleapis.com` from the boot script when a key is saved, and
  each scene's own hosts.

**Gain.** About 0.5 s off the first tiles of a cold visit (estimate).

**Cost.** S. **Exactness.** Exact.

**Status.** Done 6 November (P-107): the two hints come first in `<head>`,
before the inline isolation script, at bytes 83 and 159 of the built page. On
cold visits under DevTools' Fast 4G, neither host's first tile paid for its
connection. The control paid 88 ms (median) for USGS, and USGS's first tile
answered about 90 ms sooner. DevTools throttling does not slow connection
setup, so the 0.5 s estimate for a real 4G radio is still unmeasured. Google's
host and other scenes' hosts are not hinted yet.
[Note](../performance/2026-11-06/preconnect.md).

### L26. Send cross-origin requests past the service worker

**What happens now.** The app's service worker answers same-origin files
and navigations; navigations use navigation preload. Every cross-origin tile
request still goes through its `fetch` handler, which then declines to answer
it. That is one hop through the worker's thread for each of hundreds of
tiles.

**Proposal.**

- In the worker's `install` event, register Chrome's static routing rules
  for the tile hosts, so their requests go to the network without waking the
  worker:

  ```js
  event.addRoutes?.(["tiles.mapterhorn.com", "basemap.nationalmap.gov", "tile.googleapis.com"]
    .map(hostname => ({ condition: { urlPattern: new URLPattern({ hostname }) }, source: "network" })));
  ```

- Browsers without the API skip it.

**Gain.** Small per request, and the worker can sleep through a tile load.
Not measured.

**Exactness.** Exact.

## Frames while loading

### L19. Draw only what changed while maps stream

**What happens now.**

- When a map starts loading, the runtime calls `beginStreaming`, which holds
  continuous rendering, and releases it when loading ends
  ([`createGlobeRuntime.ts:862–875`][e-stream]).
- Google's startup holds continuous rendering until its first tiles show, so
  that `tiles.update()` runs every frame ([`:1426–1436`][e-stream-google]).
- So a still camera draws every display frame for as long as anything loads.

**Measured for this report** (the live app, see
[Measured for this report](#measured-for-this-report)):

- With the camera still, the page drew frames back to back for the whole
  load, and for the 31–32 s after the view was complete, while 129–138 more
  imagery tiles arrived.
- On a 60 Hz display, that tail alone is about 1,900 frames for at most 138
  arrivals.
- In the software-rendered runs, where a frame took about a second, loading
  also slowed to about 70 KB/s. That fits loading being paced by drawn
  frames, but the software rendering's CPU use is another possible cause.

**Proposal.**

- Run traversal, upload pumps and readiness through the scheduler's
  `requestWork`, which does work without drawing.
- Ask for a frame only when a tile, a page or a mesh becomes visible.
- Arrivals within one display frame share it, as requests already do.
- Keep continuous drawing for what moves on its own: inertia, simulations
  and the field-of-view return.

**Gain.**

- Most frames of every load, which is most of a first visit's GPU and CPU
  work after startup.
- On slow GPUs, loading no longer waits for frames it does not need.
- Not measured on real hardware; count frames against visible changes
  (M-6).

**Exactness.** The frames that remain draw the same pictures; frames that
would repeat the previous picture are not drawn.

## The moving frame's main thread

In the app's drag at 1× on the M5, a frame costs 4.3 ms of main thread
([21 October audit][audit-21]). About half is the raster update: imagery
selection, measurement, the loaded-detail readout and publication. About a
quarter is Babylon's render. The rest is input, HUD and the browser.

### L3. Move the origin only when the eye has moved far

**What happens now.**

- Both engines start with `useLargeWorldRendering: true`
  ([`createRendererMode.ts:67`][r-mode-64] for WebGL,
  [`:185`][r-mode-185] for WebGPU). That gives 64-bit matrices and Babylon's
  floating origin.
- Floating origin overrides every `world` matrix write so that each mesh's
  matrix is relative to the eye
  (`@babylonjs/core@8.56.2`, `Materials/floatingOriginMatrixOverrides.js:15–25, 98–108, 152–162`).
  It also compares each uniform's name against strings.
- `OffsetWorldToRef` calls `markAsUpdated`, so the uniform buffer's matrix
  cache never hits (`uniformBuffer.js:561–570`).
- So on every frame the eye moves, every drawn mesh pays four things:
  - a 16-value copy and subtraction;
  - 16 `Math.fround` comparisons;
  - a whole-buffer `_buffersEqual`;
  - a `writeBuffer`.
- Without floating origin, a still mesh would skip all four.
- These are the kind of costs P-092 records: `writeBuffer` 22.3 ms/s and
  Babylon's uniform-buffer file 41.2 ms/s, 4× still flight on 27 October.
  How much of P-092 floating origin explains is not measured. Other uniforms
  change too, and that profile was 0SFS's flight, not the app. Count the
  writes first (M-5).

**Proposal.** Rebase the origin only when the eye has moved more than a
radius R from it. With R = 4 km, a float32 coordinate under 4,096 m has steps
of 2⁻¹² m, a quarter of a millimetre, so ground near the eye rounds by less
than that. Two routes:

1. **Smallest change.** Keep Babylon's floating origin, but make the
   scene's `floatingOriginOffset` sticky: it moves only on a rebase. Mark the
   view as not at the eye (`FloatingOriginCurrentScene.eyeAtCamera = false`),
   so Babylon builds the full offset view once per camera. Babylon's shadow
   generators set that flag back to true after their pass
   (`shadowGenerator.js:766`), so set it again after them. Mesh uniforms then
   stop changing between rebases. The per-mesh comparison stays. The write
   and the buffer comparison go, because `UniformBuffer.update` returns early
   when nothing changed (`uniformBuffer.js:420–423`). This relies on Babylon
   internals.
2. **Cleaner.** Turn off floating origin and keep 64-bit matrices
   (`useHighPrecisionMatrix`). Hang the world under one root node placed at
   minus the origin, and keep cameras relative to it. 3d-tiles-renderer
   already reads its group's world matrix, so tile traversal follows. It is
   a larger change to camera code.

**Why it matters beyond its own cost.**

- With uniforms static between rebases, WebGPU render bundles (backlog B1,
  Babylon's snapshot rendering) can replay the whole frame's draws.
- Today every bundle would be invalid on every moving frame, because every
  mesh's uniforms change.
- Together the two take draw submission from O(meshes) toward O(1) a frame.

**Exactness.** Not bit-identical: vertices round relative to a different
origin. The difference is below a millimetre near the eye. Prove it with a
pixel tolerance of 0 or 1 in the render check.

### L4. Let the GPU say which imagery it needs

**What happens now.**

- Imagery is chosen on the CPU. A budgeted quadtree measures each tile's
  projected pixels over sampled terrain heights: `evaluateView`,
  `surfaceSamples`, `footprintFrom`, `heightsAt` and a 65 × 65 height lattice
  per tile ([`imagerySelector.ts`][e-sel]).
- The loaded-detail readout measures the view again.
- At the phone drag at 4×, after the October work, these cost:
  - selection 42–44 ms/s;
  - `evaluateView` 62 ms/s;
  - the readout 54 ms/s;
  - publication 24–29 ms/s.

  The rows overlap, because `evaluateView` runs inside selection and the
  readout. Together they are the largest block of main-thread time left,
  and the ledger's open items P-086, P-087 and P-089 are all inside it.
- The atlas side is already a virtual texture: a page table, a mipmapped
  RGBA atlas and `textureGrad` sampling
  ([`imageryMaterialPlugin.ts`][e-imat], [`imageryAtlas.ts:92`][e-atlas-92]).
  Only the feedback that real virtual-texture engines use is missing (Unreal's
  `FVirtualTextureFeedbackBuffer`, Unity's `VirtualTexturing.Resolver`).

**Proposal.**

- Draw the terrain into a small target, about 1/8 of the screen a side
  (160 × 100 on the desktop), with a shader that writes the imagery tile
  each pixel would need. It derives the level from `fwidth` of the imagery
  coordinate and the page table's limits.
- Read it back asynchronously: `mapAsync` on WebGPU, a pixel buffer and a
  fence on WebGL2. Use it a frame late.
- On the CPU, count the distinct tiles in those 16,000 texels. The count is
  each tile's area on screen, which gives the loader its priority for free
  (L11).
- Keep the CPU selector for WebGL1, for the first frame, and as the
  fallback while the camera moves faster than feedback can follow. The
  atlas always holds coarse levels, so a missed tile draws coarse, not
  empty.

**Gain.**

- Most of the 120–190 ms/s above, at the phone drag at 4×. About 2–3 ms of
  a 13 ms frame (estimate).
- Ground hidden by hills or buildings stops asking for imagery, because
  feedback sees only visible pixels. The CPU selector does not model what
  terrain hides.

**Cost.** L. It changes which imagery is chosen, toward exactly what each
pixel shows, so it is a decision.

- **The selector's pinned digests no longer apply.** Derivatives differ in
  their last bits between GPUs, so the choice can differ by a level at a
  threshold. It needs the tolerance test
  ([L25](#l25-a-tolerance-test-for-changes-that-are-not-bit-identical)).

### L8. Offer Babylon only the tiles that are shown

**What happens now.**

- Babylon's `_evaluateActiveMeshes` walks every mesh in the scene each
  frame. The renderer's own note on the 360 view counts two visits a frame
  for every retained map mesh ([`presentationCandidates.ts:1–8`][r-pc]).
- For each mesh it looks up the camera's LOD in a `Map`, calls
  `getTotalVertices()`, and calls `isReady()`, all before it asks
  `isEnabled()` (`@babylonjs/core@8.56.2`, `scene.js:3817–3835`).
- Hidden Google tiles stay in the scene, disabled, until the cache drops
  them. The cache is bounded only by count (L5), up to 8,000 tiles.

**Proposal.** The tiles runtimes already know the shown set: Google's
`visibleTiles` and the raster runtime's selected tiles. Install a
`getActiveMeshCandidates` that returns those meshes plus the scene's other
meshes. The renderer's `presentationCandidates` experiment already does this
for the 360 view. Alternatively, take a hidden tile's container out of the
scene (`removeAllFromScene`) and put it back when shown.

**Gain.** Active-mesh evaluation costs in proportion to shown tiles, not
retained ones. At the phone drag at 4× it costs 29–32 ms/s; measure the
share that hidden tiles take.

**Exactness.** Exact: Babylon would have skipped those meshes anyway.

### L10. One terrain grid, heights in textures

Backlog R5 describes this. It is worth more than its tier-4 placing
suggests, because it removes whole subsystems:

- **Geometry.** Draw every terrain tile with one shared 65 × 65 grid, as
  instances. Read heights in the vertex shader from a texture array, and
  morph between levels from the camera distance (CDLOD, Strugar 2009).
  MapLibre draws its terrain from one shared grid with heights from a DEM
  texture in the same way.
- **Heights.** Upload elevation as the provider's RGBA bytes into an integer
  texture (`rgba8uint`) and decode Terrarium in the shader, reading the four
  neighbours with `textureLoad`. Encoded values cannot be filtered by the
  hardware, and normalized reads would need rounding. No float grid and no
  `getImageData`. [Terrain](performance-design/terrain.md) has the design.
- **What goes away:**
  - mesh building and its workers;
  - the terrain commit and seam stitching (backlog R4);
  - the neighbour downloads for edge vertices;
  - most of the elevation decode workers (nine on the M5) and their
    70–260 MiB of buffers ([19 October audit][audit-19]).
- **What stays.** Ground contact, picking and imagery need CPU heights.
  Decode those at mesh resolution, only for tiles near the camera or a
  query.
- **Draws.** All terrain becomes one instanced draw.
- **Cost.** L. Edge vertices change, so it is a decision.

### L11. One request queue, ordered by benefit per byte

Elevation, imagery and Google tiles each have their own queue and policy
(`map.loader.requests`, `map.imagery.concurrentRequests`,
`map.google.downloads`).

- **Proposal.** Order all of them in one priority queue by the screen error
  a request removes, times its area on screen (L4 gives the area), divided
  by its bytes.
- **Why.** This is the rate-distortion answer. At every moment of loading,
  the picture is as close to complete as those bytes allow. The whole
  screen sharpens together, centre first, instead of finishing one region
  while another is blank.
- **Backlog items it covers.** T4 (centre first), T5 (fewer requests while
  turning) and T15 (low-resolution first).
- **Browser hint.** Pass the order to the browser too: `fetch` with
  `priority: "high"` for the first few.

### L12. Coarse tiles as gap fillers, not as blockers

In REPLACE refinement, a parent stays drawn until all of its children are
loaded. That is why siblings must load together (`loadSiblings`), and why a
coarse stand-in can sit kilometres above the ground (backlog T17).

- **What Google Earth does.** Its own format marks which octants of a node
  its children cover. The node's mesh draws only the uncovered parts, so
  each child shows as soon as it arrives
  ([earth-reverse-engineering][rocktree]).
- **What Google 3D Tiles allow.** They carry no octant data. The same effect
  is possible with depth: push each parent's vertices away from the eye by
  its geometric error in the vertex shader, and draw it with its children.
  Where a child exists, the child wins the depth test. Where it does not,
  the parent fills the gap.
- **Gain.** Children show independently. Siblings off screen need not load
  (`loadSiblings: false`), which saves downloads while turning.
- **Cost.** M–L. It is experimental: the boxes overlap, which is the T17
  lesson. Test it against the coarse stand-in views first.

## Memory, GPU and phones

### L7. Phone pixel defaults

All of this is built and off:

| Setting | Default | What it would do |
| --- | --- | --- |
| `renderer.resolutionScale` | 1 × the device ratio ([`catalogue.ts:26`][r-cat]) | A cap of about 1.5–1.8 device pixels per CSS pixel, where the eye's resolution ends at 30–40 cm: −53% to −67% of pixels on a 2.6× phone |
| `renderer.antialias` | On, 4× MSAA (`:44`) | Off on phones, with the upscaler's edge reconstruction in its place (backlog P3) |
| `renderer.upscaling` | Off (`:73`) | EASU + RCAS (FSR 1) to restore edges after a lower scale |
| `renderer.dynamicResolution` | Off (`:105`) | Holds the frame time on any GPU |
| Opaque canvas | Not set. WebGPU uses `premultiplied` | `alphaMode: "opaque"` saves the compositor a full-screen blend (backlog P7) |

- **The cap also cuts bytes.**
  - Raster terrain and imagery already choose detail from the drawing
    buffer's pixels, after hardware scaling ([`imageryView.ts`][e-imageryview]).
  - At 2.625 a phone takes 6.9 times the texels a desktop takes per CSS pixel
    ([performance notes][en-notes]). With a 1.5 cap, its imagery bytes and
    GPU memory fall by about two thirds, with nothing more to build.
  - Google tiles choose by CSS pixels and do not change.
- These are the user's decision, P-075.

### L22. Let the imagery atlas grow

**What happens now.**

- The atlas is planned as "the largest atlas that fits the byte budget" and
  allocated whole when imagery starts ([`imageryAtlas.ts:92`][e-atlas-92]).
- The budget, `map.imagery.gpuBudget`, defaults to 1/32 of the memory the
  browser reports ([`loading.ts:31–41`][e-gpubudget]). Chrome reports at
  most 8 GiB, so a desktop commits 256 MiB of GPU memory at start, whatever
  the view needs. That is probably about half of the 562 MiB of graphics
  memory the 19 October audit counted.
- Each 256-pixel page sits in a 288-pixel slot, so that trilinear filtering
  to mip level 4 never reads a neighbour
  ([`imageryAtlasLayout.ts:10–14`][e-atlas-plan]). That makes 21% of the
  atlas gutter.

**Proposal.**

- Allocate for the working set and grow, by a GPU copy into a larger
  texture, as residency needs pages, up to the budget.
- With a 2D texture array, each page has its own mip chain, so a 1–2 pixel
  border replaces the 16-pixel gutter.

**Gain.** Most of 256 MiB while the view needs less, and 21% of what
remains (estimate; count it, M-8).

**Exactness.** Exact while growth happens before a page is needed. Thinner
borders need the tolerance test at page edges.

### L24. Draw opaque meshes near to far

**What happens now.**

- Babylon's default opaque order, `RenderingGroup.PainterSortCompare`,
  sorts by material id to save state changes, not by depth
  (`@babylonjs/core@8.56.2`, `Rendering/renderingGroup.js:283–290`).
- Every terrain tile and every Google tile has its own material, so the
  order is roughly the order tiles loaded, coarse first. That is close to
  far first, the most overdraw.
- Apple's GPUs remove hidden surfaces before shading, which is why the M5
  profiles show no cost. Desktop GPUs, and many Android ones, shade each
  overlapping fragment that passes the depth test at that moment.

**Proposal.** `scene.setRenderingOrder(0, RenderingGroup.frontToBackSortCompare)`
for the main group. Or, with shared materials, a radix sort on a 16-bit depth
key, O(n).

**Gain.** Fragment work on non-Apple GPUs, in proportion to the depth
complexity of the view, highest in cities and hills. Measure it on one such
GPU.

**Exactness.** Exact for opaque surfaces, except where two coincide exactly
in depth. There the draw order picks the winner.

### L13. Compress textures on the GPU

**What happens now.**

- Google tile textures and the imagery atlas are RGBA8: 4 bytes a texel, 5.3
  with mips ([`imageryAtlas.ts:92`][e-atlas-92],
  [`googleTilePreparation.ts:48`][r-prep-48]).
- Google Earth's own tiles come as JPEG or as CRN-DXT1, a GPU format
  ([earth-reverse-engineering][rocktree]).

**Proposal.**

- On WebGPU, encode each tile after decode with a compute shader:
  - BC1 or BC7 where `texture-compression-bc` exists;
  - ETC2 or ASTC on phones.
- Copy the blocks into a compressed texture with `copyBufferToTexture`.
- Nothing can render into a compressed texture, so mips cannot be generated
  there. Build the mip chain in RGBA first, then encode each level.

**Gain.** Texture memory ÷4 (BC7, ASTC 4×4) to ÷8 (BC1, ETC2 RGB). Sampling
bandwidth and power fall with it.

**Libraries.**

- [spark.js][spark] has WGSL encoders for BC7, ASTC and ETC2, but is free
  only for non-commercial use, which conflicts with
  [COMMERCIAL_LICENSE.md](../../COMMERCIAL_LICENSE.md).
- [gputex][gputex] is an open alternative. It notes a black-texture bug in
  `copyExternalImageToTexture` on one PowerVR GPU.
- A BC1 encoder of our own in WGSL is a few hundred lines.

This is backlog B3 and X6, made concrete.

### L14. The sky on the GPU

**What happens now.**

- The sky is a 32 × 32 dome with a colour per vertex, computed in a worker
  by marching each line of sight (16 steps). It is drawn with a
  `StandardMaterial` ([`createSkyRuntime.ts:476–488`][s-sky]).
- Its positions and colours are uploaded again on each update
  (`:834–835`).
- One evaluation (illumination and the dome) costs about 2.5 ms in
  daylight after the October speedups ([Performance][perf]).

**Proposal.** Hillaire's method (EGSR 2020):

- a transmittance table and a multiple-scattering table, the second of
  which already ships precomputed;
- a sky-view table of about 192 × 108, rendered each frame on the GPU;
- an aerial-perspective volume of 32³.

The paper reports it scaling down to an iPhone 6s.

**Gain.**

- No CPU or worker time for the sky.
- A per-pixel sky instead of 1,024 interpolated colours.
- Haze on the terrain, which makes fog culling and coarser fogged tiles
  possible (backlog T3).
- Illuminance for the lights is one direction. Keep it on the CPU.

**Cost.** L. Pixels change, so it is a decision.

### L15. One worker pool

On the 10-thread M5 a page ran 17 workers ([19 October audit][audit-19]):

- nine elevation decoders: one per hardware thread but one, at most 16
  ([`browserPolicy.ts:22–25`](../../src/app/browserPolicy.ts));
- terrain mesh builders;
- a heights worker;
- an atlas imagery worker;
- a Google preparation worker;
- a ground BVH worker;
- a sky worker and three sky helpers.

Each is its own JavaScript realm with its own heap, WebAssembly instance and
startup.

**Proposal.** One pool of `hardwareConcurrency − 1` workers that can each run
every kernel, with jobs dispatched by priority. The pool's pull design
([`workerPool.ts`][e-pool]) and compute admission (C13) already point this
way.

**Gain.** Memory (each realm costs megabytes), start time, and fewer idle
threads woken.

### L16. VR: draw both eyes at once

**What happens now.** A headset session uses WebGL and a plain
`XRWebGLLayer` ([`headsetSession.ts:129, 158`](../../src/app/immersive/headsetSession.ts)).
Each eye draws every mesh again.

**Proposal.**

- Use multiview through WebXR layers (`OVR_multiview2`). Babylon supports
  it, and each draw then serves both eyes.
- Set `fixedFoveation` on the layer for Quest browsers.
- Tune `framebufferScaleFactor`.

**Gain.** Draw submission −50% in VR, and peripheral fragment work −30–40%
at a moderate foveation level (estimate).

## Start

### L17. Show the last frame at once

**What happens now.** A warm visit paints the boot terminal at about 0.06 s
and the globe at about 1.6 s ([startup proposal][startup]).

**Proposal.**

- When the page is hidden or closed, store the last frame (a small WebP or
  AVIF) and its camera in Cache Storage. Read the canvas in the same task
  as a render, since the drawing buffer is not preserved
  ([scene screenshot capture](scene-screenshot-capture.md) already captures
  a settled frame).
- On the next visit, the inline boot script shows that picture behind the
  terminal at once.
- When the globe's first complete frame from the same camera is drawn, fade
  the picture out.

**Gain.** About 0.06 s to a picture of the place the visitor left. That is
what people perceive as the start.

**Cost.** S–M. A saved camera that differs from the opening camera must
skip the picture.

**Privacy.** The picture shows where the visitor last was. Keep it on the
device only, and have **+ → Browser data** list and clear it with the rest.

### L18. Hosting that sends headers

GitHub Pages cannot send headers. That costs two things today:

- **The isolation reload.** A cold direct visit registers the service
  worker, waits for it, and reloads: about 0.2–0.6 s on the published pages
  ([startup proposal][startup]).
- **Updates.** A returning visitor downloads every changed chunk whole after
  a deploy.

**Proposal.** A host that sends headers (Cloudflare Pages and Netlify both
take a `_headers` file) fixes both:

- it serves COOP and COEP, or Chrome 137's `Document-Isolation-Policy`, on
  the first response, so there is no reload;
- where the host supports it, the next build's chunks can be served with
  Compression Dictionary Transport (`Use-As-Dictionary`, RFC 9842), so a
  returning visitor downloads only the difference from the build already
  cached.

This is a decision about hosting, not code.

## Unblocking the decisions

### L25. A tolerance test for changes that are not bit-identical

The project accepts a speedup only when every output bit is unchanged
([Performance][perf-exact]). That rule found and proved dozens of exact
speedups, and it is why the remaining large gains wait.

L1, L3, L4, L7, L10, L12, L13 and L14 each change pixels slightly, toward a
more correct or equally good picture. None can pass a digest. Without an
agreed test for "the same picture, within what a person can see", each stays
a decision forever.

**Proposal: one tolerance test, agreed once, applied to each change.**

- **Views.** A fixed set captured with the
  [scene capture harness](scene-screenshot-capture.md): the opening view, a
  tour stop, an oblique city, mountains, the horizon from altitude, dusk.
  Each is settled, with the same camera and time.
- **Picture measure.** NVIDIA's FLIP, which models what the eye notices, or
  SSIM where FLIP is not available, between the shipped build and the
  candidate. Set limits once for a mean and for the 99th percentile.
- **Geometry measure.** For terrain changes, height differences at the
  vertices: mean, 99th percentile and largest. L1 has the method and the
  first numbers.
- **Record it.** Each decision's figures go into the ledger beside its
  speed and memory figures, so the trade is visible.

Exact changes keep their digests. The tolerance test is for the changes that
cannot have one.

## Smaller findings

- **Panel blur that barely shows.** Dock panels are 94% opaque, and the
  compositor still re-blurs the moving globe behind them every frame
  (`backdrop-filter: blur(14px)`, [`windowing.css:82–92`][ui-panel-blur]).
  The blur contributes about 6% of the colour, so a flat fill is very nearly
  the same picture. Toolbar chips are 76% opaque
  ([`toolbar.css:138–145`][tb-chip-blur]); decide those by eye. This
  sharpens backlog P12.
- **Imagery revalidation.** USGS sends `Cache-Control: max-age=86400` with
  an ETag, and Mapterhorn `max-age=604800`. A visit after a day therefore
  costs one revalidation round trip per USGS tile. The map cache cannot
  help, because the cross-origin responses expose no `Age` header. Backlog
  R7's fixed lifetime per provider is the fix.
- **Startup blocking.** Before the globe, 365–754 ms of the main thread is
  in long tasks, the longest about 0.3 s ([audit][audit-19]). The scenes
  panel and the settings sections are the largest. Yield between startup
  steps, and build a closed panel's DOM when it first opens (backlog S2).
- **A closer benchmark for the keyed globe.** W0 compares with Google Earth,
  which streams its own format. Google's own renderer for the same
  photorealistic data is Maps JavaScript's 3D maps (`Map3DElement`, in its
  alpha and beta channels; [release notes][map3d]). Add it as a second
  comparison for keyed mode.

## What competitors do that this does not

| Product | Technique | Here | Item |
| --- | --- | --- | --- |
| Google Earth (web) | C++ in WebAssembly with threads; streaming and decode off the main thread | Decode is in workers. Selection, measurement and draw submission are on the main thread | L3, L4, C3 |
| Google Earth | Vertices packed in 8 bytes (position, octant mask, UV); textures as JPEG or CRN-DXT1 | About 44 bytes a vertex (float32 and 32-bit indices); textures RGBA8 | L5, L13 |
| Google Earth | Octant masks: a parent draws only where its children are missing | Parents wait for all their children | L12 |
| Google Earth | Bulk metadata: one request describes a subtree of nodes | Google 3D Tiles nest JSON; not ours to change | — |
| CesiumJS | `dynamicScreenSpaceError`; foveated error; `cullRequestsWhileMoving` | Gaze weighting exists; horizon falloff is now upstream as `errorFalloff` | L9 (T1), L11 (T5) |
| CesiumJS | Quantized-mesh terrain: vertices only where the relief needs them | 65² regular vertices fed by 512² samples | L1, L10 |
| CesiumJS | Skip levels of detail | Have (`optimizedLoadStrategy`, [`createTilesRuntime.ts:930`][e-tiles-930]) | — |
| MapLibre GL | One shared terrain grid, heights from a DEM texture in the vertex shader | A mesh built and stitched per tile | L10 |
| Unreal, Unity | Virtual-texture feedback buffer read back asynchronously | Atlas and page table exist; the selector is on the CPU | L4 |
| Unreal (Hillaire 2020) | Sky and aerial perspective from small GPU tables | A CPU-evaluated vertex-colour dome | L14 |

The backlog's [competitor precedent][backlog-cp] lists the rest.

## Measured for this report

**Method.**

- Cold visits of the published app, https://foss-earth.github.io/app/, on
  5 November 2026. It was built from exactly the audited commits: app
  `7e97aaa` and engine `f77da98`, per the page's own build record.
- Headless Chromium at 1280 × 800, one device pixel per CSS pixel, a new
  profile per visit, and the opening camera.
- Every visit ended cross-origin isolated, and drew with WebGL2 on
  SwiftShader, so these runs say nothing about frame times on a GPU.
- The network was a data-centre link, not Fast 4G.
- Bytes are response bodies as received, counted with Playwright.
- Draws were counted per animation frame, by wrapping the WebGL draw calls.

**Full render scale: absolute numbers.**

| | `coarserElevation` 0 (today) | 3 |
| --- | --- | --- |
| Complete view (`boot:content`) | Not reached in 300 s | 115 s |
| Fetched in the run | 26.6 MiB, still arriving at about 2 MiB per 30 s: elevation 22.4 (320 requests), imagery 2.9, app 1.3 | 17.3 MiB: elevation 13.1 (134 requests), imagery 2.9, app 1.3 |

- Frames took about a second each in software, so both runs were slow.
- Elevation was 84% of what today's default had fetched by 300 s.

**A quarter of the render scale, with no MSAA: the two settings side by
side, both to completion.**

These runs use `?set.renderer.resolutionScale=0.25&set.renderer.antialias=0`.
Raster terrain and imagery choose their detail from the drawing buffer's
pixels ([`imageryView.ts`][e-imageryview], [`terrainSelector.ts:581`][e-tsel-581]).
So a quarter scale chooses coarser tiles than a real visit, and these
figures compare the settings with each other, not with a real visit.

| | `coarserElevation` 0 (today) | 3 |
| --- | --- | --- |
| Complete view (`boot:content`) | 30.9 s | 11.3 s |
| Bytes until then | 30.8 MiB: elevation 26.7, imagery 2.8, app 1.3 | 13.4 MiB: elevation 10.9, imagery 1.1, app 1.3 |
| Elevation in all | 299 requests, 27.3 MiB | 104 requests, 10.9 MiB |

**What the runs show.**

- **Elevation dominates the app's own view too:** 78–84% of bytes with
  today's default.
- **L1, measured.** It cuts elevation by about 60%, and the time to a
  complete view by 64% at the same scale. At full scale it was the only
  setting that completed the view within the run.
- **Frames while loading (L19).** With the camera still, frames kept coming
  back to back after the view was complete. They ran at the renderer's
  limit, about 12 a second at a quarter scale, for the run's last 31–32 s,
  while 129–138 imagery tiles arrived.
- **The render scale already moves detail.** A device-pixel cap (L7) lowers
  raster terrain and imagery bytes too.

**Raw numbers** are reproducible with the method above. Count the bytes per
host and zoom, and the draws per `document.timeline.currentTime`.

## Measure first

Each estimate above needs a number before its decision. These are cheap:

- **M-1. The app's opening view by kind.** Done in this environment
  ([Measured for this report](#measured-for-this-report)). Repeat it on the
  M5 under Fast 4G, and on a phone.
- **M-2. Memory by owner.** Measure the elevation cache's decoded bytes, the
  Google LRU's tile count after ten minutes of panning, and Babylon's
  retained CPU copies. That checks L5 and L6 against the unattributed
  ~1.2 GiB.
- **M-3. Hidden tiles' share of active-mesh evaluation.** Count candidates
  against shown meshes per frame in Google mode (L8).
- **M-4. GPU time per pass on a real phone,** at the device ratio and at 1.5
  (L7). The M5 profile cannot show a phone's fragment cost.
- **M-5. Uniform writes per frame.** Count `writeBuffer` calls while
  orbiting, with and without a sticky origin (L3).
- **M-6. Frames against changes while loading,** on a GPU at 60 Hz: frames
  drawn during a cold load with a still camera, against frames in which
  something became visible (L19).
- **M-7. A keyed visitor's second visit.** Bytes from the network within
  three hours of the first, today and with session reuse (L20).
- **M-8. GPU memory by owner.** The imagery atlas, Google textures and
  buffers, terrain buffers and render targets, against the 562 MiB
  (L22, L5).

## Checked and not recommended

- **Caching compiled WebAssembly.** Every core is 16–63 KB, below V8's
  128 kB threshold for its code cache, and compiles in milliseconds.
- **SIMD in the WebAssembly cores.** Already on: every core builds with
  `-C target-feature=+simd128`, `opt-level = 3` and fat LTO.
- **CORS preflights on tile requests.** None: tile fetches are plain `GET`s
  with `credentials: "omit"` and no custom headers.
- **The geoid tables (up to 1 MB).** They load only when the position
  readout is switched to another height datum.
- **Navigation preload.** Already on in the service worker.
- **Lazy WebGPU import.** Rejected in P-058, and still right: it delays the
  renderer.
- **More bit-identical micro work** in the imagery selector and residency
  (P-086, P-087, P-089, P-105). L4 replaces most of that code, so a fraction
  of a percent there is not worth the proof it needs.
- **Every item in the ledger's "Rejected or no gain"** stays rejected; none
  of the above retries one.

## Revisions

**5 November 2026, red-team pass.** What changed from the first version:

- **Corrected.**
  - **L1.** The claim that a coarser Mapterhorn level is the same data,
    filtered, was an assumption. It is now measured for downtown
    Minneapolis, with the caveat that Mapterhorn's zooms 13 and up come from
    regional archives.
  - **L1.** Level-16 terrain already reads zoom 15.
  - **L2.** The opening view's tiles do not load one at a time but 16 at a
    time per kind. Imagery is 4.3 bits a pixel, not 2.4. The arrival
    estimate is now 3–7 s, since the code and the pack share one link.
  - **L3.** It no longer says floating origin causes P-092's costs; how much
    it explains is unmeasured.
  - **L5.** Eviction starts only above 6,000 tiles. A tile is at least two
    meshes. "Context loss becomes rare" overstated it.
  - **L7.** The eye's limit is 1.5–1.8 device pixels per CSS pixel,
    depending on viewing distance. Raster terrain and imagery already follow
    the render scale, so the cap cuts their bytes with nothing more to build.
  - **L13.** Compressed textures need each mip level encoded.
  - **L17.** Added the privacy of the saved picture.
- **Added.**
  - **Measured decisions first.** P-071, P-074 and P-077 are measured and
    wait only on a decision. They now lead the order of work.
  - **New items:** L19 (frames while loading), L20 (Google session reuse),
    L21 (missing elevation), L22 (the atlas commits 256 MiB at start), L23
    (preconnect), L24 (opaque draw order), L25 (a tolerance test) and L26
    (service worker routes).
  - **Smaller findings:** panel blur, imagery revalidation, startup
    blocking, and a second benchmark.
  - **Measurements** of the live app ([Measured for this
    report](#measured-for-this-report)), and the design pages in
    [Performance design](performance-design/README.md).

## Sources

- [How we're bringing Google Earth to the web][web-dev], web.dev: Earth's
  C++ compiled to WebAssembly, streaming and decompression on background
  threads over SharedArrayBuffer, WebGL2, and SIMD and OffscreenCanvas named
  as hopes.
- [Map Tiles API usage and billing][g-billing], Google: three hours of
  requests per root tileset request; billing per root request.
- Mapterhorn's zoom structure, from [OpenGlobus's source][openglobus] and
  [Protomaps' notes][mapterhorn-zooms]: a planet archive to zoom 12, regional
  archives above.
- [earth-reverse-engineering][rocktree]: Google Earth's rocktree format,
  with packed vertices, octant masks and JPEG or CRN-DXT1 textures.
- [3DTilesRendererJS changelog][3dtr-changelog], releases 0.4.25 to 0.5.4.
- [CesiumJS `Cesium3DTileset`][cesium-tileset]: dynamic and foveated error,
  culling requests while moving, skipping levels of detail.
- [A Scalable and Production Ready Sky and Atmosphere Rendering
  Technique][hillaire], Hillaire, EGSR 2020.
- Virtual-texture feedback: [Unreal `FVirtualTextureFeedbackBuffer`][ue-vt],
  [Unity `VirtualTexturing.Resolver`][unity-vt].
- [Code caching for WebAssembly developers][v8-wasm], V8.
- [Document Isolation Policy][dip], Chrome 137.
- [Compression Dictionary Transport][cdt], MDN.
- [spark.js][spark] and [gputex][gputex]: texture encoders for WebGPU.

[backlog]: https://github.com/foss-earth/docs/blob/main/docs/optimization-backlog.md
[backlog-cp]: https://github.com/foss-earth/docs/blob/main/docs/optimization-backlog.md#competitor-precedent
[ledger]: https://github.com/foss-earth/docs/blob/main/docs/performance-ledger.md
[audit]: https://github.com/foss-earth/docs/blob/main/docs/performance-audit.md
[audit-19]: https://github.com/foss-earth/docs/blob/main/docs/performance-audit.md#19-october-2026
[audit-21]: https://github.com/foss-earth/docs/blob/main/docs/performance-audit.md#21-october-2026
[perf]: https://github.com/foss-earth/docs/blob/main/docs/performance.md#sky
[perf-exact]: https://github.com/foss-earth/docs/blob/main/docs/performance.md#bit-identical-javascript
[startup]: https://github.com/foss-earth/docs/blob/main/docs/proposals/startup-loading.md
[agent-ref]: https://github.com/foss-earth/.github/blob/main/agent-reference.md#maps-and-prepared-data
[en-notes]: https://github.com/foss-earth/engine/blob/main/docs/performance-notes.md
[e-globe-450]: https://github.com/foss-earth/engine/blob/f77da98e85b1a4ae32dd9024b14342817600684f/src/babylon/createGlobeRuntime.ts#L450
[e-load-264]: https://github.com/foss-earth/engine/blob/f77da98e85b1a4ae32dd9024b14342817600684f/src/settings/catalogue/loading.ts#L264-L267
[e-load-269]: https://github.com/foss-earth/engine/blob/f77da98e85b1a4ae32dd9024b14342817600684f/src/settings/catalogue/loading.ts#L269-L297
[e-load-394]: https://github.com/foss-earth/engine/blob/f77da98e85b1a4ae32dd9024b14342817600684f/src/settings/catalogue/loading.ts#L394
[e-dec]: https://github.com/foss-earth/engine/blob/f77da98e85b1a4ae32dd9024b14342817600684f/src/browser/terrainImageDecoder.ts#L23-L38
[e-grid]: https://github.com/foss-earth/engine/blob/f77da98e85b1a4ae32dd9024b14342817600684f/src/terrain/terrainGrid.ts#L46-L55
[e-loader-6]: https://github.com/foss-earth/engine/blob/f77da98e85b1a4ae32dd9024b14342817600684f/src/terrain/terrainLoader.ts#L6
[e-loader-100]: https://github.com/foss-earth/engine/blob/f77da98e85b1a4ae32dd9024b14342817600684f/src/terrain/terrainLoader.ts#L100-L117
[e-src-18]: https://github.com/foss-earth/engine/blob/f77da98e85b1a4ae32dd9024b14342817600684f/src/terrain/terrainGrid.ts#L13-L20
[e-mapcache]: https://github.com/foss-earth/engine/blob/f77da98e85b1a4ae32dd9024b14342817600684f/src/browser/mapCache.ts#L50-L56
[g-billing]: https://developers.google.com/maps/documentation/tile/usage-and-billing
[mapterhorn-zooms]: https://protomaps.com/blog/index.xml
[map3d]: https://developers.google.com/maps/documentation/javascript/releases
[openglobus]: https://openglobus.github.io/docs/source/terrain/mapterhornterrain-ts/
[e-imageryview]: https://github.com/foss-earth/engine/blob/f77da98e85b1a4ae32dd9024b14342817600684f/src/babylon/imagery/imageryView.ts#L8-L20
[e-tsel-581]: https://github.com/foss-earth/engine/blob/f77da98e85b1a4ae32dd9024b14342817600684f/src/terrain/terrainSelector.ts#L581
[e-stream]: https://github.com/foss-earth/engine/blob/f77da98e85b1a4ae32dd9024b14342817600684f/src/babylon/createGlobeRuntime.ts#L862-L875
[e-stream-google]: https://github.com/foss-earth/engine/blob/f77da98e85b1a4ae32dd9024b14342817600684f/src/babylon/createGlobeRuntime.ts#L1426-L1436
[e-raster-mat]: https://github.com/foss-earth/engine/blob/f77da98e85b1a4ae32dd9024b14342817600684f/src/babylon/createRasterTilesRuntime.ts#L329-L333
[e-atlas-plan]: https://github.com/foss-earth/engine/blob/f77da98e85b1a4ae32dd9024b14342817600684f/src/terrain/imagery/imageryAtlasLayout.ts#L10-L14
[e-gpubudget]: https://github.com/foss-earth/engine/blob/f77da98e85b1a4ae32dd9024b14342817600684f/src/settings/catalogue/loading.ts#L31-L41
[ui-panel-blur]: https://github.com/foss-earth/ui/blob/6bd0212e76c6b613f2326746162bdfb1d4fca6d4/src/windowing/styles/windowing.css#L82-L92
[tb-chip-blur]: https://github.com/foss-earth/toolbar/blob/9d292fbe1c2aea1038488a9c523895ca95a3ae32/src/styles/toolbar.css#L138-L145
[e-camdef]: https://github.com/foss-earth/engine/blob/f77da98e85b1a4ae32dd9024b14342817600684f/src/camera/cameraDefaults.ts#L3
[e-tiles-29]: https://github.com/foss-earth/engine/blob/f77da98e85b1a4ae32dd9024b14342817600684f/src/babylon/createTilesRuntime.ts#L29
[e-tiles-930]: https://github.com/foss-earth/engine/blob/f77da98e85b1a4ae32dd9024b14342817600684f/src/babylon/createTilesRuntime.ts#L930
[e-sel]: https://github.com/foss-earth/engine/blob/f77da98e85b1a4ae32dd9024b14342817600684f/src/terrain/imagery/imagerySelector.ts
[e-imat]: https://github.com/foss-earth/engine/blob/f77da98e85b1a4ae32dd9024b14342817600684f/src/babylon/imagery/imageryMaterialPlugin.ts
[e-atlas-92]: https://github.com/foss-earth/engine/blob/f77da98e85b1a4ae32dd9024b14342817600684f/src/babylon/imagery/imageryAtlas.ts#L92
[e-pool]: https://github.com/foss-earth/engine/blob/f77da98e85b1a4ae32dd9024b14342817600684f/src/browser/workerPool.ts
[r-worker-70]: https://github.com/foss-earth/renderer/blob/63984f44225f07af070f41764202213e9040177e/google-WASM/worker.js#L58-L72
[r-prep-48]: https://github.com/foss-earth/renderer/blob/63984f44225f07af070f41764202213e9040177e/src/babylon/googleTilePreparation.ts#L48
[r-prep-142]: https://github.com/foss-earth/renderer/blob/63984f44225f07af070f41764202213e9040177e/src/babylon/googleTilePreparation.ts#L139-L143
[r-mode-64]: https://github.com/foss-earth/renderer/blob/63984f44225f07af070f41764202213e9040177e/src/babylon/createRendererMode.ts#L64-L79
[r-mode-185]: https://github.com/foss-earth/renderer/blob/63984f44225f07af070f41764202213e9040177e/src/babylon/createRendererMode.ts#L181-L189
[r-cat]: https://github.com/foss-earth/renderer/blob/63984f44225f07af070f41764202213e9040177e/src/settings/catalogue.ts#L26-L111
[r-pc]: https://github.com/foss-earth/renderer/blob/63984f44225f07af070f41764202213e9040177e/src/babylon/presentationCandidates.ts#L1-L8
[s-sky]: https://github.com/foss-earth/sky/blob/6dabf1889f8929082388564b1d241bd4290cf51f/src/babylon/createSkyRuntime.ts#L476-L488
[web-dev]: https://web.dev/case-studies/earth-webassembly
[rocktree]: https://github.com/retroplasma/earth-reverse-engineering
[3dtr-changelog]: https://github.com/NASA-AMMOS/3DTilesRendererJS/blob/master/CHANGELOG.md
[cesium-tileset]: https://cesium.com/downloads/cesiumjs/releases/1.70.1/Build/Documentation/Cesium3DTileset.html
[hillaire]: https://diglib.eg.org/handle/10.1111/cgf14050
[ue-vt]: https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/Renderer/VT/FVirtualTextureFeedbackBuffer?application_version=5.3
[unity-vt]: https://docs.unity3d.com/ru/2020.1/ScriptReference/Rendering.VirtualTexturing.Resolver.html
[v8-wasm]: https://v8.dev/blog/wasm-code-caching
[dip]: https://developer.chrome.com/blog/document-isolation-policy
[cdt]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Compression_dictionary_transport
[spark]: https://github.com/Ludicon/spark.js
[gputex]: https://github.com/verekia/gputex
