# Public contracts requested by Flight

The previous proper split delivery is locally qualified at Earth application
source `406e71e7c03317115a7c056548d45926c7d790be`. Its exact provider archives,
public export maps, source checks and installed consumer evidence remain in the
private delivery handoff. This document describes a subsequent source candidate.
New Node adapters and current local surface observation need their own checks
and exact artifacts before consumers can claim adoption.

## Public ownership

| Need | Public owner route | Authority |
| --- | --- | --- |
| Babylon shader splitting for Vite 8.3.4 | `@foss-earth/renderer/vite` | Selects GLSL/WGSL shader modules; imports no Babylon runtime. |
| Build and dependency provenance | `@foss-earth/about/vite` | Reads supplied or Node filesystem/Git facts into About's canonical metadata. |
| Current local displayed geometry | `@foss-earth/engine` and `@foss-earth/engine/babylon` | Engine's map owns source/revision/query facts and observation updates. |
| Frame scheduling | `@foss-earth/renderer` or `@foss-earth/renderer/browser` | One host scheduler with supplied animation-frame ports. |
| Device bootstrap and scene lifecycle | `@foss-earth/renderer/babylon` | Explicit host, settings, visibility, resize, readiness and timer ports. |
| World composition | `@foss-earth/engine/babylon` | Borrowed renderer, scene, scheduler, clock and resource services. |

The previously qualified Renderer already exports `createRenderScheduler`,
`createBrowserRenderScheduler`, `AnimationFrameHost`,
`createBrowserRendererHost`, `createBrowserRendererPlatform`, `bootstrapRenderer`,
`createBabylonRendererLifecycle`, `RendererPlatformPort`, `ReadinessTimers`,
`createFrameProfileSession` and `bindFrameProfileSettings`. Engine exports
`GlobeRuntimeOptions`, `createGlobeRuntime` and the explicit browser map/resource
ports. These generic contracts stay with those public packages.

Earth's `composeEarthRuntime`, `createEarthBrowserRuntime` and native resource
assembly remain site-owned wrappers. Hosts supply their own composition. Flight
must not import website Vite or app internals, copy shared helpers, or make Earth
or Campus depend on a Flight package. One host supplies the physical device,
scene, monotonic clock, render scheduler and Images broker. Resource completion
work uses those same authorities and grants no extra scene paint.

## Shader and build adapters

The Renderer adapter preserves the retained two Babylon language groups and
Vite's `rolldownOptions.output.codeSplitting.groups` hook. Its causal fixtures
must compare actual grouped and ungrouped lazy bundles, retain public material
exports, and establish that initial and phone graphs do not load the renderer.
A path-classification unit fixture alone does not prove the built-module repair.
Babylon core/loaders remain 8.56.2; Vite remains 8.3.4. No browser, GPU or live
flight claim follows from a successful JavaScript bundle.

About's adapter owns `builtFrom`, its generic tree readers and canonical types.
Hosts can inject the build time, source stamp, filesystem/Git reader and dirty
source scope. A package's identity is not inferred from a consuming website.
Dev declarations, actual bundled modules, checkout commits, changed source,
unpushed status and package versions remain distinct facts. Page JSON cannot
terminate its script element. An app's service worker, published-page metadata
and build stamp policy stay in that app. Earth's temporary `foss-earth/vite`
facade forwards public owners and supplies only its own source policy.

## Current local surface semantics

Preparation completion and `isStreamingTiles() === false` do not establish
local displayed terrain readiness. Engine observes explicitly supplied finite
WGS84 sample locations against its actual current displayed query, not a cache,
network estimate or future pending DEM. Ready sample points do not prove every
point in a footprint, a requested resolution, collision safety or a physical
vertical datum. Hosts retain their contact and terrain-readiness policy.

`runtime.displayedSurface.observe({ samples })` returns `read`, `subscribe`,
`updateLocality`, `isCurrent` and `dispose`. Core observation types and
`createCurrentDisplayedSurface` are exported through `@foss-earth/engine` and
`@foss-earth/engine/core`; the Babylon route supplies the actual runtime and
observation types. Inputs contain 1–25 copied, finite WGS84 points.

Source generation, displayed geometry revision, loading, failure, render pause,
supplied simulation state and suspension are separate facts. Raster/Google
transitions and committed geometry replacement
invalidate stale observations. Image-only changes must preserve geometry revision,
contact hits and quality. Loading or suspension can coexist with usable current
geometry. Subscriptions must publish meaningful asynchronous changes while paused,
and terminate on disposal. One coalesced settlement read uses the existing
injected `clock.after(..., 0)` after asynchronous queue bookkeeping; it creates
no extra clock, paint, loading or recurring polling. The wakeup is cancelled on
source supersession and destruction. Public `setPaused` requests are observed;
direct changes to the borrowed scheduler are outside the supplied owner ports.
Displayed heights remain WGS84 ellipsoid-coordinate geometry with unknown
physical datum; no geoid conversion or ground readiness is fabricated.

## Publication and qualification

The eight machine-specific paths in Scenes' tracked source receipt are replaced
in the publication candidate by explicit private evidence IDs with unchanged
hashes. IDs are neither package-relative files nor public download URLs. Original
private receipts and the qualified Scenes source/archive remain retained. This
metadata candidate requires common-policy/ref/source-publication qualification.
Other owner provenance and asset-rights publication review remains separate.

Every destination continues to use the same checked CI component and current
sentence-case contribution rule in its later Contributing section. Changed
runtime code cannot reuse metadata-only qualification. The separate request
covers frozen Renderer/About/Engine source, causal fixtures, one finished owner
CI each, actual public Node/strict declaration consumers, source/artifact seals,
full intended publication refs and common conformance. Earth application
compatibility adoption follows exact checked artifacts. Flight's own compiled
app and Platform bootstraps need their own grants. Ordinary remote admission,
publication, browser/GPU acceptance and production deployment stay separate.
