# Level of detail

Part of [Performance design](README.md).

## The job

For each region of the view, choose the coarsest data whose error on screen
stays under a target, measured in pixels. There are three kinds:

- terrain meshes;
- imagery pages;
- Google's mesh tiles.

Do it again only when the view, the settings or what is loaded has changed.

## The limit

- **What to load.** The smallest set of tiles that covers what the view
  shows, each within the target. Nothing hidden, behind the horizon or under
  haze needs detail at all.
- **What choosing costs.** Proportional to the tiles chosen, not to the
  tiles that exist. While the view is still, nothing, because the choice
  cannot have changed.

## The design

**The measure is screen-space error.** A tile's geometric error ε, in metres,
seen from distance d with a vertical field of view θ on a screen h pixels
tall, spans

> SSE = ε · h ÷ (2 · d · tan(θ / 2)) pixels.

A tile is good enough when its SSE is under the target. The measure folds
distance, field of view and resolution into one number, which is why every
streaming globe uses it.

- Google tiles use 20 px, the Google plugin's recommended target
  ([`createTilesRuntime.ts:822`][e-tiles-822]).
- Imagery uses texels per pixel instead: how many image pixels fall on one
  screen pixel.

**The hierarchy.**

- Raster terrain and imagery are an implicit quadtree over Web Mercator,
  `z/x/y`.
- Google's tiles are an explicit tree of oriented boxes.
- A traversal starts at the root, culls what is outside the frustum or below
  the horizon, and refines while a tile's error exceeds the target.

**Budgeted refinement, best first.** A traversal has a node budget
(`map.imagery.maxNodes`). Refinements are taken from a priority queue (a
binary heap, O(log n) a step) in order of projected footprint. So a budget
that runs out has spent itself on the error that shows most: the greedy
answer to "the least error for the work allowed". The imagery selector
already works this way ([`imagerySelector.ts`][e-sel]).

**Hysteresis.** Refine at the target and coarsen only at a multiple of it,
so a camera jittering around a threshold does not reload. Imagery holds
this only while moving, and refines to the target at rest
(`map.imagery.refineAtRest`).

**Skip levels.** Load the target level directly, not every ancestor on the
way down. 3d-tiles-renderer's `optimizedLoadStrategy`, based on Cesium
Native's selection, does this and is on
([`createTilesRuntime.ts:930`][e-tiles-930]).

**Cadence.** Terrain and imagery reselect at most every 100 ms while moving,
and once more where the view stops.

**Tile identity.** A tile should be a number, not a string.

- Today the loaders key maps by `` `${z}/${x}/${y}` ``, which builds a string
  on every lookup.
- A packed quadkey avoids that: (4^z − 1) ÷ 3, plus the Morton interleave
  of x and y. It is unique across levels and exact in a double up to z = 24.
- It gives its parent and children by arithmetic, and sorting by it keeps
  neighbours together.

## Where detail can be spent better

These raise the target where the eye cannot use the detail. Each saves bytes
and selection work:

| Where | How | Status |
| --- | --- | --- |
| Toward the horizon | Lower the error with distance: CesiumJS `dynamicScreenSpaceError`; 3d-tiles-renderer `errorFalloff` from 0.5.2 | Backlog T1; [L9](../performance-limits.md#l9-update-3d-tiles-renderer-to-054) |
| Under haze | Where the atmosphere hides the ground, need no detail there | Backlog T3, after [Sky](sky.md) |
| Away from the gaze | Lower detail toward the screen's edge | Built: `losGazeExponent`, `losPeripheralFloor` |
| While moving fast | Raise the target with the ground's speed on screen; refine when it slows | Imagery refines at rest; extend to meshes (backlog P5, T5) |
| On dense screens | No more detail than the eye resolves | Google: CSS pixels. Raster terrain and imagery: the drawing buffer's pixels, so they follow the render scale; a device-pixel cap lowers them too ([L7](../performance-limits.md#l7-phone-pixel-defaults)) |
| Hidden ground | Ground behind hills needs no imagery | GPU feedback sees only visible pixels ([Imagery](imagery.md)) |

## Why not the alternatives

| Alternative | Why it loses |
| --- | --- |
| Rings by distance | Ignores field of view, resolution and relief, so it over-loads in a zoom and under-loads on a wide screen |
| One level for the whole view | An oblique view needs ten levels at once |
| A per-pixel error measured on the CPU | Costs the most where the CPU is weakest. The GPU computes it for free during drawing ([Imagery](imagery.md)) |
| Load every ancestor first | Costs about a third more bytes and a round trip per level |

## What others do

- **CesiumJS:** SSE 16 px by default, dynamic and foveated error, skip
  levels of detail, cull requests while moving.
- **MapLibre:** covers the screen with tiles chosen per zoom, coarser at high
  pitch.
- **Google Earth:** its traversal is not documented. Its metadata comes in
  bulk packets describing many nodes, so it descends several levels per round
  trip ([earth-reverse-engineering][rocktree]).

## How it is verified

- **Bytes and requests per reference view,** cold, against the W0 comparison.
- **Selection milliseconds per second** while moving, from the frame
  profiler. Zero while still.
- **The picture.** The settled error everywhere within the target, checked
  with the tolerance test.

[e-sel]: https://github.com/foss-earth/engine/blob/f77da98e85b1a4ae32dd9024b14342817600684f/src/terrain/imagery/imagerySelector.ts
[e-tiles-822]: https://github.com/foss-earth/engine/blob/f77da98e85b1a4ae32dd9024b14342817600684f/src/babylon/createTilesRuntime.ts#L822
[e-tiles-930]: https://github.com/foss-earth/engine/blob/f77da98e85b1a4ae32dd9024b14342817600684f/src/babylon/createTilesRuntime.ts#L930
[rocktree]: https://github.com/retroplasma/earth-reverse-engineering
