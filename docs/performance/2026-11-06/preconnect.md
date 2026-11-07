# Preconnect to the tile hosts — 6 November 2026

Item L23 of [the performance limits audit](../../proposals/performance-limits.md#l23-open-the-tile-connections-from-the-html),
P-107 in the performance ledger.

`vite/preconnect.ts` adds two hints first in every page's `<head>`, in dev and
in builds:

```html
<link rel="preconnect" href="https://tiles.mapterhorn.com" crossorigin>
<link rel="preconnect" href="https://basemap.nationalmap.gov" crossorigin>
```

They are the hosts of the default elevation (Mapterhorn) and the default base
map (USGS Imagery Topo). `crossorigin` opens the anonymous connection the tile
fetches use: they are CORS requests without credentials (`mapCache.ts` sends
`credentials: "omit"`). The hook runs last (`order: "post"`) and prepends, so
the hints come before the build's inline isolation script (about 14 KB) and
the boot terminal's style. No pixel changes.

Not done: `tile.googleapis.com` for a visitor with a saved key, and the hosts of
a scene or base map chosen in settings. A hint to a host the page does not use
costs one idle connection, which Chrome closes after about 10 s.

## Where the hints land

In `dist/index.html` from `npm run build`:

| Mark | Byte | Gzip prefix | Brotli prefix |
| --- | ---: | ---: | ---: |
| First hint (Mapterhorn) | 83 | 92 | 52 |
| Second hint (USGS) | 159 | 119 | 85 |
| Isolation script | 210 | 142 | 95 |
| `<meta charset>` | 14,353 | 3,819 | 3,256 |
| Entry module | 19,115 | 5,392 | 4,552 |
| `</head>` | 24,469 | 6,611 | 5,660 |

Both hints arrive in the response's first packet.

`<meta charset>` was already about 14 KB in, after the isolation script, and is
now 168 bytes further. The HTML spec looks for it in the first 1,024 bytes.
GitHub Pages and the startup audit's server send `charset=utf-8` in
`Content-Type`, so nothing depends on it there. This is not part of L23.

## Tests

`vite/preconnect.test.ts`: each origin once, https only; the tags, their order
and `crossorigin`; and the hosts equal the engine's default terrain source and
default base map, so the hints follow a change of default. Six one-line mutants
(`crossorigin: false`, no `order`, `injectTo: "head"`, another host, no
deduplication, the https check inverted) each failed one test. All 69 tests in
`vite/` pass.

## Browser timing

Method: headless Chrome with the startup audit's switches (WebGPU, Metal), a
new profile for each cold visit, DevTools' Fast 4G preset and a 4× CPU
slowdown. A control build (the same tree without the plugin) and the build with
the hints were served alternately, six pairs, by the audit's static server
(`research/scripts/benchmarks/startup-audit/serve.mjs`). For each host, the
earliest-sent tile request's connection timing comes from Chrome
(`Network.responseReceived`, `response.timing`). Times are from the first
navigation; the page reloads once on a cold visit to become cross-origin
isolated.

| Host | Arm | First tile sent | Headers | Sent → headers | DNS + connect, TLS included |
| --- | --- | ---: | ---: | ---: | ---: |
| `basemap.nationalmap.gov` | control | 3,157 ms | 3,462 ms | 307 ms | 88 ms (4 of 6 paid 88–174 ms) |
| `basemap.nationalmap.gov` | hints | 3,164 ms | 3,370 ms | 204 ms | 0 ms (0 of 6) |
| `tiles.mapterhorn.com` | control | 2,647 ms | 3,017 ms | 370 ms | 0 ms (2 of 6 paid 80–121 ms) |
| `tiles.mapterhorn.com` | hints | 2,652 ms | 3,006 ms | 354 ms | 0 ms (0 of 6) |

Medians of six. The USGS imagery's first tile answers about 90–100 ms sooner.
Mapterhorn's moves by about 10 ms. DevTools throttling adds its latency to each
request but not to DNS, TCP or TLS, which run at this network's real speed and
here overlap the added latency. So this run cannot show the audit's estimate
for a real 4G radio, three round trips of about 150 ms. It shows that neither
host's first tile pays for its connection with the hints. The frame profiler
does not apply: no frame's work changes.

Not a frame-rate claim.
