# Performance design

Status: design record, 5 November 2026. It explains why FOSS Earth uses
each of its central algorithms and data structures, and which ones it should
use, to reach the least each job can physically cost. Where the code already
does that, the page says so. Where it does not, it names the gap and the item
that closes it in [Performance limits](../performance-limits.md) (L1, L2 …)
or in the [optimization backlog][backlog] (T2, R5 …).

The goal is to be faster than Google Earth itself on every measure a
visitor feels:

- time to a complete view;
- smoothness while moving;
- power;
- memory;
- bytes.

## The pages

Each page follows the path of the data, from the network to the pixels:

| Page | The question it answers |
| --- | --- |
| [Frame scheduling](frame-scheduling.md) | When is a frame drawn, and when is work done without drawing? |
| [Level of detail](level-of-detail.md) | Which tiles does a view need, and how is that decided cheaply? |
| [Terrain](terrain.md) | How are heights fetched, stored and turned into a surface? |
| [Imagery](imagery.md) | How do photographs of the ground reach each pixel at the right resolution? |
| [Google 3D Tiles](google-3d-tiles.md) | How are Google's meshes fetched, decoded, kept and drawn? |
| [Network and caches](network-and-caches.md) | In what order are bytes fetched, and where are they kept? |
| [Threads](threads.md) | What runs on the main thread, what in workers, and how they share data? |
| [GPU](gpu.md) | How are draws submitted, in what order, and with what precision? |
| [Pixels](pixels.md) | How many pixels are shaded, and how are they sampled? |
| [Sky](sky.md) | How is the atmosphere computed? |
| [Startup](startup.md) | What must happen before the first frame, and what can wait? |

## Principles

These hold on every page:

1. **Every cost has a floor.** Work out the least the job needs from its
   inputs and outputs: pixels on screen, heights a mesh reads, bytes on the
   wire. Then design toward it. Removing known waste is not the same thing,
   and it stops short.
2. **Do nothing that is not seen.** A frame that shows nothing new, a tile
   no pixel samples, a height no vertex reads and a byte no decoder needs
   are all waste. The cheapest work is work not done.
3. **Do each thing once, at the right time.**
   - Work that does not depend on the visitor is done at build time.
   - Work that depends on the view is done once per change of view, not
     once per frame.
   - Work that depends on the frame is done on the GPU where it is
     parallel.
4. **Keep one copy, in the cheapest form that still serves.** Bytes are kept
   compressed until they are needed, decoded once, uploaded once, and freed
   from the CPU once the GPU holds them, unless a reader still needs them.
5. **Count everything in bytes and milliseconds.** Every cache is bounded by
   bytes, not entries. Every queue is ordered by what it gains per byte or per
   millisecond. Anything that cannot say what it costs cannot be bounded.
6. **Prove it.** A change lands only with a measurement. If its output is
   bit-identical, a digest proves that. Otherwise a tolerance test does
   ([L25](../performance-limits.md#l25-a-tolerance-test-for-changes-that-are-not-bit-identical)).

## The floors, on the reference devices

The derivations are in [Performance limits](../performance-limits.md#where-each-cost-stands).

- **Desktop:** 1280 × 800 CSS pixels at one device pixel each.
- **Phone:** 412 × 915 CSS pixels at 2.625 device pixels each.
- **Network:** Fast 4G, 0.97 MiB/s and 165 ms of latency.

| Resource | Floor | What sets it |
| --- | --- | --- |
| Bytes to complete a view | 2–3 MiB | About one texel and a fraction of a height per pixel, compressed |
| Time to complete a view, cold | 4–6 s | Those bytes, plus the code, at the link's rate, plus a few round trips |
| Main thread per moving frame | ~0.5 ms desktop, ~2 ms phone | Input, camera and one submission of a frame whose uniforms do not change |
| Main thread while still | 0 | Nothing changes, so nothing runs |
| Renderer memory | 200–300 MiB | A few screens of compressed texels, 16-bit geometry, one copy of each |
| Fragments a frame | ~1.5 per CSS pixel | The eye's resolution at viewing distance |

## Faster than Google Earth: where it can be won

Google Earth on the web is its C++ code compiled to WebAssembly. It streams
and decompresses data on background threads, using SharedArrayBuffer, and
draws with WebGL2 ([web.dev case study][web-dev]). Its own tile format packs a
vertex into 8 bytes and can send textures already in a GPU format
([earth-reverse-engineering][rocktree]).

**Where Earth is ahead, and stays ahead for Google's own data:**

- its format, made for its renderer;
- one engine and one data set, designed together.

Google 3D Tiles give FOSS Earth glTF with float32 geometry and JPEG
textures. The best answer here is to convert at load time, in a worker:
16-bit geometry and GPU-compressed textures
([Google 3D Tiles](google-3d-tiles.md)).

**Where FOSS Earth can be ahead:**

- **Its own data.** For the open raster globe, FOSS Earth chooses the
  format and the sampling rate. It can send heights at the mesh's rate and
  bake whole views at build time ([Terrain](terrain.md),
  [Startup](startup.md)). Earth cannot avoid streaming a view it has never
  seen.
- **Drawing only what changed.** Frames are drawn on demand, and work runs
  without drawing ([Frame scheduling](frame-scheduling.md)).
- **The GPU deciding what it needs.** Feedback from the pixels themselves
  can pick imagery, accounting for hills that hide valleys
  ([Imagery](imagery.md)).
- **The modern API.** WebGPU offers render bundles, compute shaders, timestamp
  queries and compressed-texture encoding on the GPU. The case study
  describes Earth on WebGL2 ([GPU](gpu.md)).
- **Rendering off the main thread.** The case study listed OffscreenCanvas
  as something the Earth team still hoped to adopt ([Threads](threads.md)).
- **A small start.** Only the code the first frame needs, the rest on
  demand ([Startup](startup.md)).

**How "faster" is proven.** research's [Earth comparison][earth-compare]
(W0) measures signed-out Google Earth and FOSS Earth from the same camera,
cold and warm, at rest and in motion. A claim to be faster needs, for each
of its reference views:

- the time to a complete view;
- main-thread and GPU milliseconds per moving frame;
- memory, bytes and energy.

Each must be measured on a phone as well as a desktop. Google's own Maps
JavaScript 3D (`Map3DElement`), drawn from the same photorealistic data, is
the second comparison for the keyed globe.

## How a design is judged

For each job, a page answers the same questions:

1. **The job.** What must be computed, sent or drawn, and how often?
2. **The limit.** The least it can cost, and which resource bounds it.
3. **The design.** The algorithm and the data structure, their cost in
   time, memory and bytes, and why that is at or near the limit.
4. **The alternatives,** and why each loses.
5. **What others do:** Google Earth, CesiumJS, MapLibre and game engines.
6. **Where the code is,** against the design.
7. **How it is verified:** the number that would show the limit is reached.

[backlog]: https://github.com/foss-earth/docs/blob/main/docs/optimization-backlog.md
[web-dev]: https://web.dev/case-studies/earth-webassembly
[rocktree]: https://github.com/retroplasma/earth-reverse-engineering
[earth-compare]: https://github.com/foss-earth/research/blob/main/benchmarks/earth-compare/README.md
