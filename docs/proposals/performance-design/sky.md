# Sky

Part of [Performance design](README.md).

## The job

- A sky colour for every pixel of sky, from the ground to orbit, by day,
  twilight and night.
- Haze on distant ground (aerial perspective).
- The Sun's and the sky's illuminance for the scene's lights and the
  camera's exposure.

## The limit

- **The sky depends on few inputs:** the Sun's direction, the eye's height
  and the atmosphere. So it can be tabulated in a small table that changes
  only when they do, and read per pixel for almost nothing.
- **GPU:** filling a 192 × 108 table and reading it per pixel is microseconds
  on desktops and still small on phones.
- **CPU:** zero per frame. One illuminance evaluation per change of Sun or
  height.

## The design today

`createSkyRuntime.ts` and the sky's WebAssembly core:

- **A dome of 32 × 32 vertices.** A worker marches each line of sight, 16
  steps, with tables of multiple scattering and irradiance that ship
  precomputed for the default atmosphere.
- **Colour per vertex.** It writes a colour per vertex, drawn with a
  `StandardMaterial` and uploaded again on each update
  ([`createSkyRuntime.ts:476–488, 834–835`][s-sky]).
- **Cost.** An evaluation costs about 2.5 ms in daylight, after the October
  speedups.
- **Updates on change.** It runs only when its inputs change. Stars update
  only when one could be seen.

Accurate and already cheap. What it cannot give:

- a per-pixel sky: the Sun's glow and the horizon band are interpolated
  between 1,024 vertices;
- haze on the ground;
- no CPU work at all.

## The design that reaches the limit

Hillaire, "A Scalable and Production Ready Sky and Atmosphere Rendering
Technique" (EGSR 2020), used in Unreal Engine
([L14](../performance-limits.md#l14-the-sky-on-the-gpu)). Four small tables
on the GPU:

| Table | Size | When it changes | Holds |
| --- | --- | --- | --- |
| Transmittance | 256 × 64 | With the atmosphere | Light lost along a ray, by height and angle |
| Multiple scattering | 32 × 32 | With the atmosphere | Light scattered more than once. FOSS Earth already ships an equivalent |
| Sky view | 192 × 108 | With the Sun or the eye's height | The sky around the eye, with more rows near the horizon |
| Aerial perspective | 32 × 32 × 32 | With the Sun, the eye or the view | Haze and transmittance along the view, in depth slices |

**How it is used.**

- The sky pixels read the sky-view table, and the ground reads the
  aerial-perspective volume.
- The tables are small enough to recompute each frame on a desktop and on a
  change elsewhere. The paper reports the method scaling down to an
  iPhone 6s.
- Illuminance for the lights and the exposure stays on the CPU: one
  direction, one evaluation.

**What it gains beyond its own cost.**

- The haze it computes is the ground's visibility. Tiles the haze hides
  entirely need no detail and need not load (backlog T3, and
  [Level of detail](level-of-detail.md)).

## Why not the alternatives

| Alternative | Why it loses |
| --- | --- |
| A colour per dome vertex (today) | CPU or worker time on each change; interpolated glow; no haze on the ground |
| Bruneton's 4D tables (2008) | Precise, but megabytes of four-dimensional tables, slow to rebuild when the atmosphere changes |
| Analytic skies (Preetham, Hosek and Wilkie) | Only from the ground, only by day, and no view from orbit |
| Ray marching every pixel | The most accurate, at many times the GPU work of reading tables that reproduce the same image within noise |

## What others do

- **Unreal Engine:** Hillaire's method.
- **CesiumJS:** sky and ground atmosphere computed per vertex or per
  fragment.
- **Google Earth:** not documented.

## How it is verified

- Sky CPU milliseconds per second: zero.
- GPU milliseconds of the tables and the sky pass, from timestamp queries.
- A photometric check against today's model at fixed Sun angles, heights and
  exposures: the illuminance in lux and the sky's luminance by direction.

[s-sky]: https://github.com/foss-earth/sky/blob/6dabf1889f8929082388564b1d241bd4290cf51f/src/babylon/createSkyRuntime.ts#L476-L488
