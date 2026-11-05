# Frame scheduling

Part of [Performance design](README.md). The rules a contributor follows are
in [Render on demand][rod]. This page explains why they are the right rules
and where the code still falls short of them.

## The job

Show every change of the scene once, as soon as the display can show it.
Between changes, run the work that loading needs (traversal, decoding,
uploads) without drawing.

## The limit

- **Frames drawn** equal the number of distinct pictures. While nothing
  changes, that is zero.
- **The scheduler's own cost** is constant per request. A request is
  recorded, and requests between two display frames collapse into one.
- **Latency.** A change made in a task is drawn at the next display frame:
  one display interval, at most, after the change.

## The design

`renderScheduler.ts` in the renderer, wired by the engine:

- **One pending frame.** All requests between two `requestAnimationFrame`
  callbacks collapse into one frame. There is one flag for "draw" and one
  for "work".
- **Work without drawing.** `requestWork()` runs `work(time)` in the next
  frame callback without rendering. Loading pumps, traversal and uploads
  belong here.
- **Holds.** A reference count (`beginContinuous` / `endContinuous`) keeps
  frames coming while something moves on its own: camera inertia, a running
  simulation, the field-of-view return.
- **Readiness without drawing.** A mesh that could not draw yet, because its
  material is compiling or its texture loading, is checked without drawing.
  The checks start one frame apart and spread out to four a second
  ([`sceneUpdates.ts`][rod]).
- **A cap,** `renderer.frameRateCap`, skips presentation when frames would
  come sooner than the interval.

Every operation is O(1): a counter, two flags and one handle.

## Why not the alternatives

| Alternative | Why it loses |
| --- | --- |
| Babylon's `runRenderLoop` | Draws every display frame forever. A still globe costs as much as a moving one |
| A timer at a fixed rate | Drifts against the display's vsync, so motion judders, and it still draws when nothing changed |
| Drawing on every input event | Pointers report at 120–240 Hz on some devices: frames the display never shows |
| Drawing whenever data arrives | One frame per tile. Arrivals between two display frames should share one frame |

## What others do

- **CesiumJS** `requestRenderMode` draws when something requests it, with
  `maximumRenderTimeChange` for time-driven scenes.
- **MapLibre** repaints on change and on tile arrival.
- **Google Earth**'s frame policy is not documented. Measure it with the W0
  harness: frames drawn while still, and while loading.

## Where the code is

- Done: the scheduler, holds, readiness checks and cap; still pages use about
  1% of the main thread ([audit][audit-19]).
- **Gap: loading holds the frame loop open.** Both map runtimes call
  `beginStreaming`, and with it `beginContinuous`, on load start, and end it
  on load end ([`createGlobeRuntime.ts:862–875`][e-stream]). Google's startup
  holds continuous drawing until its first tiles show, so that `tiles.update()`
  runs every frame ([`:1426–1436`][e-stream-google]). That is work, not
  drawing.
  - A cold 60 s load at 60 Hz draws about 3,600 frames with a still camera.
  - The fix is [L19](../performance-limits.md#l19-draw-only-what-changed-while-maps-stream):
    run traversal and upload pumps through `requestWork`, and ask for a frame
    only when a tile or page becomes visible.
- **Decision: 120 Hz displays** draw twice as many frames while moving, so a
  drag costs twice as much. A cap of 60 on battery, aligned to the display's
  intervals, is backlog P4.

## How it is verified

- **While still:** zero frames and zero script after the view settles. Count
  `GPUQueue.submit` or WebGL draw calls per animation frame (document timeline
  time) over 10 s.
- **While loading with a still camera:** frames drawn should equal the frames
  in which something became visible. Today the two differ by the length of the
  load times the display rate.

[rod]: https://github.com/foss-earth/docs/blob/main/docs/render-on-demand.md
[audit-19]: https://github.com/foss-earth/docs/blob/main/docs/performance-audit.md#19-october-2026
[e-stream]: https://github.com/foss-earth/engine/blob/f77da98e85b1a4ae32dd9024b14342817600684f/src/babylon/createGlobeRuntime.ts#L862-L875
[e-stream-google]: https://github.com/foss-earth/engine/blob/f77da98e85b1a4ae32dd9024b14342817600684f/src/babylon/createGlobeRuntime.ts#L1426-L1436
