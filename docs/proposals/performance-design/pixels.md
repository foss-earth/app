# Pixels

Part of [Performance design](README.md).

## The job

Shade enough pixels for the picture to look sharp, and no more. Present them
without paying the compositor for effects nobody sees.

## The limit

- **What the eye resolves.** About one arcminute. At arm's length, 30 cm
  for a phone, that is about 290 pixels per inch. At 60 cm for a laptop it
  is about 145.
- **Phones exceed it.** A phone at 2.625 device pixels per CSS pixel shows
  about 400–460 pixels per inch.
  - A 420-pixel-per-inch phone reaches the eye's limit at about 1.8 device
    pixels per CSS pixel at 30 cm, and at about 1.5 at 40 cm.
  - Past that, extra pixels cost GPU time and power and add nothing visible.
- **Fragments per frame** ≈ CSS pixels × min(device ratio, 1.5–1.8)².
  - On the reference phone that is 0.85–1.2 million instead of 2.6 million.
  - Multisampling multiplies the samples, not the shading, but it multiplies
    memory and bandwidth by the sample count.

## The design today

All of these are built ([`catalogue.ts:26–111`][r-cat]):

| Setting | Default | What it does |
| --- | --- | --- |
| `renderer.resolutionScale` | 1 × the device ratio | The fraction of device pixels drawn |
| `renderer.antialias` | On (4× MSAA) | Multisampling |
| `renderer.dynamicResolution` | Off | Steers the scale from GPU time |
| `renderer.upscaling` | Off | EASU, or EASU + RCAS (FSR 1), after a lower scale |
| `renderer.frameRateCap` | Off | Skips frames above a rate |

The canvas uses Babylon's default premultiplied alpha. Panels over the canvas
blur it (`backdrop-filter: blur(14px)`), though they are 94% opaque
([`windowing.css:82–92`][ui-blur]).

## The design that reaches the limit

**1. Draw at the eye's limit, not the screen's**
([L7](../performance-limits.md#l7-phone-pixel-defaults)).

- Cap the drawn density at about 1.5–1.8 device pixels per CSS pixel.
- Upscale with EASU, which is edge-adaptive, and sharpen with RCAS. That is
  −53% to −67% of fragments on the reference phone.

**2. Hold the frame time with dynamic resolution.**

- WebGPU timestamp queries time each pass. The scale drops quickly when the
  GPU is over budget and rises one step at a time when it is well under.
- The renderer's controller already does this ([`dynamicResolution.ts`][r-dyn]).

**3. Detail follows the drawn density.** Raster terrain and imagery already
choose detail from the drawing buffer's pixels, after hardware scaling. So a
cap at 1.5 device pixels per CSS pixel, not 2.625, also means about a third
of the imagery texels and fewer terrain tiles. Google tiles choose by CSS
pixels and are unaffected.

**4. Antialiasing by cost.**

- MSAA is cheap on Apple's and other tile-based GPUs, where samples stay in
  tile memory. It is expensive in memory on desktop GPUs.
- With upscaling on, EASU's edge reconstruction replaces most of what MSAA
  gives. Temporal antialiasing would do better (backlog P11), but
  photogrammetry and fast camera motion need careful history rejection.

**5. An opaque canvas** (backlog P7). WebGPU's `alphaMode: "opaque"` and
WebGL's `alpha: false` let the compositor copy the canvas instead of
blending it. The globe covers it, so nothing shows through.

**6. No blur nobody sees.**

- A `backdrop-filter` over a moving canvas is redone every frame.
- At 94% opacity the blur contributes 6% of the colour. Use a flat fill
  where the panel's background is at least about 90% opaque (backlog P12).
- Toolbar chips at 76% show more of it; decide those by eye.

**7. VR.**

- Multiview draws both eyes in one pass.
- Fixed foveation shades the periphery at a lower rate
  ([L16](../performance-limits.md#l16-vr-draw-both-eyes-at-once)).

## Why not the alternatives

| Alternative | Why it loses |
| --- | --- |
| Full device ratio (today) | 2.6 million fragments on a phone where about 0.85 million are visible |
| Bilinear browser scaling of a low-resolution canvas | Soft edges; EASU reconstructs them |
| A fixed low scale everywhere | Wastes a fast GPU and still overloads a slow one; dynamic resolution fits each |
| Frame generation | A browser cannot present between animation frames, and generated frames add latency |

## What others do

- **CesiumJS:** `useBrowserRecommendedResolution`, on by default, draws one
  pixel per CSS pixel.
- **Microsoft Flight Simulator:** render scaling with FSR, DLSS and TAA.
- **iOS Low Power Mode:** caps the frame rate at 30.

## How it is verified

- GPU milliseconds per frame on a real phone at the device ratio and at 1.5
  (M-4).
- The tolerance test at the same scale pairs.
- Energy per route (backlog M1).

[r-cat]: https://github.com/foss-earth/renderer/blob/63984f44225f07af070f41764202213e9040177e/src/settings/catalogue.ts#L26-L111
[r-dyn]: https://github.com/foss-earth/renderer/blob/63984f44225f07af070f41764202213e9040177e/src/dynamicResolution.ts
[ui-blur]: https://github.com/foss-earth/ui/blob/6bd0212e76c6b613f2326746162bdfb1d4fca6d4/src/windowing/styles/windowing.css#L82-L92
