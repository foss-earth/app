# Browser regression coverage

The shared browser helper is locally checked at
`d63ca6e46d94dc90635f3da4b9d73a741347f026` and adopted as an exact development
archive. Application assertions and local source repairs have separate scopes.
Synthetic tests passing does not mean the real browser suite has passed.

`@foss-earth/browser-testing` owns generic browser startup, protocol, timeouts,
owned-process cleanup, interception, screenshots and bounded sanitized evidence.
Earth assertions stay in `scripts/validation/browser-functional.mjs`, with
application fixtures under `fixtures/browser-functional`. Campus and Flight
consume the same public package in their own suites and later phases. No browser
tooling is an application runtime or default bootstrap dependency.

The executable assertion imports the exact installed public `/page` export;
there is no archive-relative helper, provider copy or source checkout fallback.
A checked helper archive must be adopted as an exact development dependency
before that script can run. `test:browser-assertions` uses one Node test worker;
`check:browser` requires explicit browser, backend, canonical URLs, source and
compiled pins, tools and a new ignored output directory. It starts no server.
The separate fixture server verifies the compiled release file map before
listening on its named canonical port. No old coordinator preview is used.

The suite measures actual bottom-right map-control rectangles, compact versus
explicitly expanded layout, clipping and provider typography. Those checks run
immediately after startup, before navigation assertions. It also exercises the
actual Map-tab Save and Google-source controls starting without a key, requiring
activation in the same document/runtime/scene/device. External requests remain
blocked and the synthetic credential is cleared afterward: that check proves
live activation, not successful Google access or valid key permissions.

Engine's ordinary runtime regression tests use the real borrowed runtime and
shared Save control with injected, non-network authentication/traversal fixtures.
They cover save-then-select, retrying an already selected source, key replacement
and clear, either batched update order, blank credentials and disposal. App's
composition test covers the actual Map controls and persistence without host
recreation; its world-construction mock does not qualify rendering. The Node
assertion tests reject deliberately bad geometry, browser-default typography,
storage-only saves, failed activation and recreated hosts. These synthetic
negative controls do not substitute for actual browser observations.

The requested functional floor is Chrome, Firefox and WebKit on both WebGL1
and WebGL2: six sequential runs. WebGL1 uses the existing `renderer=webgl`
selection; actual mode and engine version must match the requested backend. Assert a real rendered globe, navigation/tabs, persistent
settings, host Dev contributions, scene/image replacement and real scoped
workers on `/app/`; verify the thin landing root stays uncontrolled. Each runner
closes its owned browser in `finally` and records cleanup failures. Fixture
interception alone cannot prove workers. Synthetic retained images avoid live
provider content as a correctness oracle; unavailable network/DEM fallback is
not a qualification of elevation or terrain streaming.

The request uses the existing explicit installed Chrome/Firefox binaries and
retained Playwright1.55.0/core1.55.0/WebKit2203 read-only. There is no automatic
browser acquisition. Actual product versions, backend and GPU/software facts
must be observed during the future run; WebKit does not establish mobile Safari
or WebGPU. Chrome WebGPU remains a separately named optional request. Both WebGL versions
are mandatory; an unavailable backend or silent fallback cannot pass.

Earlier frozen requests and their failed/passing evidence remain immutable in
ignored owner `build/` directories. Changed App/Engine bytes need fresh exact
compiled/landing bindings and a new coordinator browser grant. Full six-pair
acceptance remains incomplete, as do narrow-viewport/theme layout bindings,
actual forced-WebGL1 confirmation, accepted-installer bootstrap and remote
admission. The retained wheel/Trackpad fixture failure remains visible; it is
not waived by placing the new regressions ahead of it. Original harnesses,
human ancestry, browser tools and every prior receipt stay intact.
