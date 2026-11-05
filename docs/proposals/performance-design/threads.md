# Threads

Part of [Performance design](README.md).

## The job

Keep the main thread free for input, the page's DOM and the draw
submission. Run everything else in parallel, and share data between threads
without copying it.

## The limit

- **Main thread per frame:** input, the camera, and one submission whose
  uniforms do not change. That is a fraction of a millisecond, and zero while
  still. With rendering in a worker, the main thread draws nothing at all.
- **Total CPU:** the sum of the work. Parallel work finishes in the work
  divided by the cores, plus the part that cannot be split (Amdahl's law).
  So the serial part, the main thread's, is what bounds a frame.
- **Copies:** none. A worker writes bytes once into memory that the reader
  reads.

## The design today

- **Workers by job.**
  - elevation decoders: one per hardware thread but one, at most 16;
  - terrain mesh builders and a heights worker;
  - an atlas imagery worker;
  - a Google preparation worker, with a WebAssembly core;
  - a ground BVH worker;
  - a sky worker and three sky helpers sharing one WebAssembly memory.

  On the 10-thread M5 a page ran 17 ([audit][audit-19]).
- **A pull-based pool** ([`workerPool.ts`][e-pool]): a worker takes the next
  task only when it finishes its last one, so fast cores take more. Workers
  start when work queues and stop when idle. Compute admission (backlog C13)
  bounds how many run at once.
- **WebAssembly cores** in Rust, built with `simd128`, `opt-level = 3` and fat
  LTO; 16–63 KB each.
- **Shared memory** on cross-origin isolated pages: decoders publish heights
  once in a `SharedArrayBuffer`, which the page and the mesh workers read.
  Elsewhere, buffers are transferred.
- **On the main thread:** traversal, imagery selection and measurement,
  container creation, Babylon's frame and the DOM.

## The design that reaches the limit

**1. One pool of general workers** ([L15](../performance-limits.md#l15-one-worker-pool)).

- Size it to the cores but one. Every worker can run every kernel, from one
  WebAssembly module and one shared memory.
- Jobs carry a priority and a deadline, and take the earliest deadline
  first.
- Seven kinds of realm become one kind. That saves a heap, a module instance
  and a start per kind, and keeps idle threads asleep.

**2. Queues in shared memory.**

- A job is a few integers in a ring buffer in a `SharedArrayBuffer`. Workers
  wait with `Atomics.wait` and are woken with `Atomics.notify`.
- No message is structured-cloned for a job, and results land where the
  reader expects them.

**3. Move work off the main thread, in order of what it costs there:**

| Work | Where it should run | How |
| --- | --- | --- |
| Imagery selection and measurement | The GPU | Feedback pass ([Imagery](imagery.md)) |
| Terrain meshes and stitching | Nowhere | One grid and heights in textures ([Terrain](terrain.md)) |
| Google traversal | A worker | The camera's snapshot in shared memory; the worker writes the selected set back |
| Uniform rewrites per mesh | Nowhere | The origin moves only on a rebase ([GPU](gpu.md)) |
| Babylon's whole frame | A worker | `OffscreenCanvas`, with input sent to it (backlog C3) |

**4. Render in a worker** (backlog C3), the end state.

- Babylon runs on an `OffscreenCanvas`. Pointer and keyboard events are
  posted to it, at a cost under a millisecond.
- The main thread keeps only the DOM, so a slow panel can no longer drop a
  frame, and a heavy frame can no longer delay a click.
- The Google Earth case study names OffscreenCanvas as something its team
  still hoped to adopt ([web.dev][web-dev]).

**5. Isolation without a reload.** Shared memory needs cross-origin
isolation. Today a service worker adds the headers and the page reloads once
on its first visit. A host that sends the headers removes the reload
([L18](../performance-limits.md#l18-hosting-that-sends-headers)).

## Why not the alternatives

| Alternative | Why it loses |
| --- | --- |
| One worker per job type (today) | Seven realms, seven heaps and seven module instances, and an idle type cannot help a busy one |
| `postMessage` with structured clone | Copies every byte; transfer avoids the copy, but detaches the sender's buffer |
| WebAssembly threads for everything | A long task on one thread still blocks; the main thread's share is the bound, not the parallel part |
| More decoders than cores | They compete for cores with the main thread and the GPU process |

## What others do

- **Google Earth:** C++ threads compiled to WebAssembly over shared memory;
  streaming and decompression on background threads ([web.dev][web-dev]).
- **CesiumJS:** a task processor that sends decoding to workers.
- **MapLibre:** a pool of workers that fetch and parse tiles.

## How it is verified

- Main-thread milliseconds per moving frame, from the frame profiler.
- Worker utilisation and the time a job waits.
- Energy per route, from the power harness (backlog M1).

[audit-19]: https://github.com/foss-earth/docs/blob/main/docs/performance-audit.md#19-october-2026
[e-pool]: https://github.com/foss-earth/engine/blob/f77da98e85b1a4ae32dd9024b14342817600684f/src/browser/workerPool.ts
[web-dev]: https://web.dev/case-studies/earth-webassembly
