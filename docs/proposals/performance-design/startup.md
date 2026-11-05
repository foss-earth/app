# Startup

Part of [Performance design](README.md). The record of what was built is
the [startup proposal][startup].

## The job

Go from a click to a complete view. Show something useful at once, and
never block the visitor's input on the way.

## The limit

**Cold**, on Fast 4G:

- the HTML: one round trip, plus connection setup;
- the code the first frame needs: 1.09 MiB, about 1.1 s;
- compiling it;
- the first view's data: its bytes at the link's rate.

The code and the data share one link, so their bytes add.

**Warm:** the code from the service worker's cache, compiled code from
V8's code cache, and tiles from the HTTP cache. A few hundred milliseconds.

**Perceived:** the first paint. A picture of the place the visitor left can
show with that first paint, at about 0.06 s.

**Blocking:** zero. No task longer than 50 ms before the first frame or the
globe. Startup work yields between steps.

## The design today

Measured in the [startup proposal][startup] and the
[performance audit][audit]:

- **A boot terminal** paints from the HTML's first bytes: 0.06 s warm,
  0.22–0.24 s cold.
- **Only the code the first frame needs** runs first: 0.68 MiB brotli, half
  what it was.
  - Babylon is imported module by module.
  - Each shader language has its own chunk, and the renderer preloads only
    its own.
  - React and the tab overlay load after the globe starts.
  - Closed panels, editors and developer tools load on demand, prefetched
    on intent or when idle.
- **What used to block the first frame** is skipped: the WebGPU presentation
  probe once it has passed, and the atmosphere's tables, which ship
  precomputed.
- **App files** come from the service worker on later visits. Navigations
  use navigation preload.
- **Isolation.** The first visit registers the service worker that isolates
  the page and reloads once: about 0.2–0.6 s on a direct cold visit. The
  landing pages register it ahead, which removes the reload for visitors who
  come through them.
- **Measured.**
  - Cold: first 3D frame 2.77 s on Fast 4G at a 4× slowdown.
  - Warm: first frame 0.60 s, the globe 1.59 s.
  - Blocking: 300–360 ms before the first 3D frame, and 365–754 ms before
    the globe. The longest task is about 0.3 s.

## The design that reaches the limit

1. **Open connections from the HTML**
   ([L23](../performance-limits.md#l23-open-the-tile-connections-from-the-html)).
   - Add `preconnect` hints to the default tile hosts, and to Google's when
     a key is saved.
   - Their DNS, TCP and TLS then happen while the code downloads.
2. **Bake the opening view**
   ([L2](../performance-limits.md#l2-bake-the-opening-view)).
   - Every new visitor opens on the same camera. One prepared file, fetched
     beside the code, completes it.
   - That takes the complete view from about 60 s to about 3–7 s on Fast
     4G.
3. **Show the last frame at once**
   ([L17](../performance-limits.md#l17-show-the-last-frame-at-once)).
   - A small picture of the last settled frame, and its camera, kept on the
     device, shows behind the terminal.
   - It fades out when the live globe draws the same camera complete.
4. **Never block for long.**
   - Split startup into tasks that yield (`scheduler.yield()` where it
     exists, a zero-delay message elsewhere).
   - Build a closed panel's DOM the first time it opens (backlog S2). The
     scenes panel and the settings sections are the largest startup tasks
     measured.
5. **No reload for isolation**
   ([L18](../performance-limits.md#l18-hosting-that-sends-headers)). A host
   that sends COOP and COEP, or `Document-Isolation-Policy`, with the first
   response.
6. **Pipelines before they are needed** (backlog S3). Compile the shaders the
   first frame and the first tiles need while the terminal shows, in
   parallel.

## Why not the alternatives

| Alternative | Why it loses |
| --- | --- |
| One bundle | Every visitor pays for every panel |
| Server-side rendering of a picture | Needs a server per request; a baked or saved picture does the same from static files |
| Lazy-loading WebGPU's code | Measured: delays the renderer by about 0.46 s (P-058) |
| Compile hints | Measured: no difference (P-068) |

## What others do

- **Google Earth:** downloads its WebAssembly engine before it can draw;
  measure its time to first frame and to a complete view with W0.
- **iOS:** an app returning to the foreground first shows the snapshot taken
  when it left, the precedent for L17.

## How it is verified

- The `boot:*` marks, cold and warm, under Fast 4G and a 4× slowdown.
- Total blocking time before the globe.
- Bytes before the first frame.
- The time to `boot:content` against the W0 comparison.

[startup]: https://github.com/foss-earth/docs/blob/main/docs/proposals/startup-loading.md
[audit]: https://github.com/foss-earth/docs/blob/main/docs/performance-audit.md
