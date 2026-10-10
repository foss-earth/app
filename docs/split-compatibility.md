# Split application compatibility and qualification

The current Earth application composes public split owners.
No old monolith runs underneath this composition. Campus and Flight must adopt
qualified public packages and this application facade when they need its host
assembly. The local delivery identities in `dependency-pins.json` bind exact archives.
External delivery receipts distinguish current checks and installed consumers
from retained historical evidence.

## Ownership

The default tab-to-owner rule remains: Engine owns Map, Location and Controls;
Renderer owns Renderer; Sky owns Sky and Date and time; UI owns windowing,
Settings, shared Interface primitives and Bug report; Toolbar owns HUD controls
and toolbar/position contributions; Scenes owns Scenes; 360 owns 360 and 360
image settings; About owns shared About; Dev owns shared Dev. Earth only
assembles these contributions, its app files and page/version data. Flight's
domain sections and Campus content stay with their hosts. Representation and
image-resource settings are the documented exceptions contributed by their
image owners. UI supplies paragraph-grid controls; it does not own the Map
selector, viewer, or Flight policy.

One host supplies the renderer/scene, monotonic clock, RAF scheduler, readiness
timers, image broker, upload device and storage. Engine/Sky/360 borrow those
authorities. Resource-only updates request work on the same scheduler; painted
changes request a frame. Cleanup attempts all registered releases even after
a failure and preserves the original startup/frame error.

Normal destruction cancels unpublished uploads and stops app rendering. The
same native resource owner retains the broker/device while submitted transfer
tickets remain, using the supplied clock for completion pumping without a
scene paint. It releases the device after actual completion or observed loss.
A failed completion observation retains tickets and waits for actual loss;
ordinary destruction never reports a synthetic device loss. Backend execution
and GPU timing remain separate qualification gates.

## Compatibility

`createBabylonRuntime` remains an asynchronous Earth host factory, distinct from
Engine's low-level `createGlobeRuntime`, which borrows explicit ports. The
application facade forwards owner types and functions; it contains no old
terrain, image, renderer or windowing implementation.

No-argument cache, scene-media and Location helpers borrow the active Earth
host's actual stores. Calls outside an active host must instead use the owner's
factory with explicit ports. Panel APIs exported directly from owner packages
require their current explicit document/settings/lifecycle ports. The shared
range editor/controller remain Engine-owned and both Map and HUD use one
controller. Generic saved detail is independent of Flight's requirements.

The former SceneRuntime type is now the explicit Scenes `SceneWorldPorts`
contract. Generic airport/runway records come from Engine's Location provider;
Flight's airport modes and flight presets move to its host contributions. They
are not reintroduced into the shared windowing package.

The Scenes facade specializes the envelope validator with public representation
hooks and the optional preview-sheets extension. The static legacy schema asset
is a byte-identical compatibility copy of the Scenes-owned schema, recorded in
SOURCE_PROVENANCE.json. View detail is the real 360 representation reading,
including null/unknown values; old unmeasured numeric tile-detail fields are
not synthesized. Scene, media and viewer preparation retains authored order,
original image fallback, broker limits and asynchronous cancellation.

The staged Weather package implements manual wind only. New physical-height
helpers found in unfinished recovery work are not present in the currently
qualified Engine public package. Consumers needing those APIs must receive a
separately reviewed and checked owner increment; a broad compatibility barrel
cannot supply a missing implementation. No Flight or Campus implementation
enters Earth to bridge that gap.

## Remaining delivery gates

The current common input is CI `1db73d1ddb342e348a2c9e8387f7bbc7ebb3225e`,
policy 1.0.1, with all 26 executable files sealed. Every Earth destination,
including Docs, Research and community data, adopts its canonical tracked blob,
external descriptor, caller and config. Metadata checks include docs-only edits.
Scenes, Docs and Research have current local source/artifact/installed-consumer
receipts; unchanged runtime releases reuse only byte-identical production proof.
UI additionally restores the host-supplied visit identity through an injected
diagnostics port. The app's exact lock preserves separate incompatible tool
versions while runtime packages share one physical installation.

1. The final app receipt must qualify ownership, types, tests, lint, build,
   source-aware public/CSS/Vite consumer, lifecycle and full intended refs.
2. Platform qualifies source/package/hybrid setup; all three applications show
   actual adoption/default bootstrap evidence. The coordinator verifies real
   remote admission and controls publication/cutover/deployment.

The older `9e046dd` policy and installer `ff46c57` archives remain immutable
historical evidence. They do not establish the replacement policy or installer
features. Source preparation, prior local qualification, current archive
qualification, application adoption and public availability are separate facts.

## Recovery

Preserve the pre-split application archive, its dirty-source inventory, original
refs, ignored evidence, legacy storage keys and exact earlier artifacts. Revert
only the reviewed application composition and its dependency/lock pins if
necessary. Do not clean/reset the archive, rewrite provider history or delete
media/rights notices. Source/package selection switches use the shared installer
and preserve dirty source; production never falls back silently to the monolith.
