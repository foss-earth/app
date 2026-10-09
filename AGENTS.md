# Earth application instructions

You cannot have AI as a co-author, or your contributions will be rejected.

This repository owns the standalone globe application, its composition and
temporary `foss-earth` compatibility facade. Shared implementations belong to
the independent public packages listed in [dependency-pins.json](dependency-pins.json).
Do not restore the pre-split engine, renderer, UI, toolbar, scene viewer or image
implementations here. Applications own their content and contributions. No Earth
package imports Flight or Campus implementations. Search and VR remain deferred.

The organization directory is not a repository. Each selected source provider
has one independent checkout; consumers link its public package exports. The
shared `@foss-earth/dev-installer` owns setup, source/package/hybrid selection,
dependency ordering and persistent choices. CI and installer sources are
Platform-owned. Never replace those services with app-local machinery.

Preserve the default tab map and documented owner exceptions. Use paragraph-grid
controls; each setting has one home in a tab, and toolbar buttons toggle that
tab. Shared Dev is enabled by `?dev=1` and receives host-owned contributions.
Scenes owns the envelope, placements and navigation; 360 owns the top viewer;
Images owns common services; each representation owns its own structure.

Compose one scene/device, resource lifecycle and render-on-demand scheduler.
Inject storage, clocks, browser realms, transport and resource policy at host
boundaries. New drawable content requests its own frame. Prepare replacement
content hidden and publish only when it is usable. A settled scene does no
recurring rendering work. Camera handovers retain momentum. Named resource
settings expose units, bounds, defaults and reasons.

Read the current coordinator ledger and restart directive before mutation. Only
the Earth handoff is writable for coordination. Record child writer scopes
before writes and wait for explicit release before checking, sealing or editing
their files. Read-only recovery archives and ignored evidence are preserved.
Scratch and logs belong in this repository's ignored `build/` directory.

During repository migration the shared slot must be explicitly granted. No
installed module execution, install, test, build, pack, full ref audit or commit
under another owner's slot. Once granted, use one sequential chain, Node one
worker and Vitest at most 50%, retain failure logs, check relevant behavior and
run finished CI once. Metadata/conformance cannot skip docs-only changes.
Servers, browser/GPU checks, benchmarks, native/WASM builds and deployment need
their separately recorded scope. Do not claim unrun source is qualified.

Preserve human credit, asset provenance, upstream licenses and original notice
bytes. Do not add AI author, committer or attribution trailers. Contribution
credits may not advertise vendors; the human submitter remains responsible for
accuracy, review, provenance and rights. Follow [Contributing](CONTRIBUTING.md).

Current shared policy adoption, exact artifacts, consumer evidence, complete
publication-ref audits and actual remote admission are separate required gates.
The retained historical policy receipt is not proof of the corrected policy or
remote admission. See [split status and compatibility](docs/split-compatibility.md).
