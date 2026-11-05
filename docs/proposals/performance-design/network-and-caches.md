# Network and caches

Part of [Performance design](README.md).

## The job

Deliver the bytes a view needs, in the order that completes the picture
soonest. Never fetch the same bytes twice. Keep each byte in the cheapest
form until it is needed.

## The limit

- **Time to a complete view ≈ bytes ÷ bandwidth + round trips × latency.**
  - On Fast 4G that is 1.03 s per MiB plus 0.165 s per round trip.
  - A cold first view of 41–55 MiB therefore takes about a minute, whatever
    else is optimised. Bytes are the first lever.
- **Round trips on the critical path:**
  - a new connection's setup: DNS, TCP and TLS, about three;
  - one per level of nested metadata (Google's tileset JSON);
  - one for the first tile.
- **Repeat visits:** zero bytes for anything still fresh in a cache.

## The design

**1. One queue, ordered by benefit per byte**
([L11](../performance-limits.md#l11-one-request-queue-ordered-by-benefit-per-byte)).

- Every request, of any kind, waits in one binary heap, O(log n) a step.
- Its priority is the screen error it removes, times its area on screen,
  divided by its bytes. The area comes from GPU feedback
  ([Imagery](imagery.md)); bytes are known from the source's average.
- This is the greedy solution to "the least visible error for the bytes
  received so far". It makes the whole picture sharpen together, centre
  first.
- A request no claim still wants leaves the heap before it is sent. The
  terrain loader already withdraws such claims.

**2. In flight: enough to fill the link, no more.**

- The bandwidth-delay product sets the number:
  in flight ≈ bandwidth × (round trip + one response's transfer time) ÷
  mean response size, plus a margin.
  - Fast 4G with 80 KB tiles: 0.97 MiB/s × (0.165 + 0.08) s ÷ 80 KB ≈ 3.
  - Fibre at 50 MB/s, 20 ms and 50 KB: about 21.
- Today's fixed 16 (`map.loader.requests`, `map.imagery.concurrentRequests`)
  is too many on a phone link, where they all share the bandwidth and finish
  late together, and too few on fibre.
- Measure throughput and round trips as tiles arrive, and size the window
  from them, as TCP does.

**3. No setup on the critical path.**

- `<link rel="preconnect">` to the default tile hosts in the HTML
  ([L23](../performance-limits.md#l23-open-the-tile-connections-from-the-html)).
- Tile requests skip the service worker with its static routing API
  ([L26](../performance-limits.md#l26-send-cross-origin-requests-past-the-service-worker)).

**4. Never ask twice for what does not exist**
([L21](../performance-limits.md#l21-remember-elevation-that-does-not-exist)).

- Mapterhorn returns 404 above zoom 12 outside its regional coverage.
- Keep a set of missing tile keys. Before a request, walk up the tile's
  ancestors (at most 15 steps) and stop at a missing one, then use the
  nearest existing ancestor.

**5. Never fetch the same bytes twice.**

- **Google sessions:** reuse a session's token for its three-hour life
  ([L20](../performance-limits.md#l20-reuse-a-google-session-for-its-three-hours)).
- **Providers that hide `Age`:**
  - The map cache cannot tell how fresh their responses are, so it stores
    nothing for them ([performance notes][en-notes]).
  - USGS sends `max-age=86400` with an ETag. Mapterhorn sends
    `max-age=604800`. Both send `Access-Control-Allow-Origin: *` but expose
    no other headers.
  - Give each provider a fixed lifetime from its published policy
    (backlog R7).
- **Baked views:** the opening view and each tour stop as one prepared file
  ([L2](../performance-limits.md#l2-bake-the-opening-view)).

**6. A memory hierarchy, bounded in bytes at every level.**

| Level | Holds | Bound | Evicts |
| --- | --- | --- | --- |
| Browser HTTP cache | Responses, by URL | The browser's | Its own |
| Map cache (Cache Storage) | Public tiles across visits | `map.cache.httpBytes` | LRU |
| Encoded in memory | WebP and JPEG bytes of tiles not shown | A byte budget | Least value per byte |
| Decoded in memory | Grids and bitmaps for tiles being prepared | A byte budget | Least value per byte |
| GPU | Pages, buffers and textures for shown tiles and a margin | `map.imagery.gpuBudget`, `map.google.cacheBytes` | Least value per byte |

"Value" is the expected screen area per byte near the predicted view, with
the time of last use breaking ties.

- **One copy.** A byte that has moved to the next level is freed from the
  previous one, unless a reader still needs it there.
- **Implementation.** A hash map with an intrusive list gives an O(1) LRU. A
  heap keyed by value gives O(log n) value eviction.

## Why not the alternatives

| Alternative | Why it loses |
| --- | --- |
| A queue per kind (today) | Elevation, imagery and Google compete without knowing which matters more |
| A fixed number in flight | Wrong on every link but one |
| Caches bounded by count (today: 256 grids, 6,000 Google tiles) | An entry's size varies by orders of magnitude, so a count bounds nothing |
| Plain LRU everywhere | Evicts what the next frame needs when the camera turns back |

## What others do

- **CesiumJS:** a request scheduler with per-server limits and priorities
  from screen error and distance; byte-bounded caches.
- **MapLibre:** tiles fetched and parsed in workers; per-source caches.
- **Google Earth:** bulk metadata cuts round trips, and its data comes from
  one origin over long-lived connections.

## How it is verified

- Bytes, requests and failures per reference view, cold and warm.
- Round trips before the first tile.
- Time to a complete view under Fast 4G against the W0 comparison.

[en-notes]: https://github.com/foss-earth/engine/blob/main/docs/performance-notes.md
