# Shared browser testing preparation

Status: unrun source preparation; the Platform installer holds the shared slot.
The qualified app7335a2a and compiled38f01c72 release remain the prior checkpoint.

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

A private frozen request, tool/source digests and producer-bound artifact outputs
live in ignored `build/source-preparation/browser-testing-20261010`. Coordinator
reviewed ancestry, a new explicit grant, exact installed package checks and
current common conformance/ref gates precede acceptance. No browser, public
bootstrap, new shared package release or remote admission has passed from this
preparation. Original harnesses, human ancestry, browser tools and all prior
qualified/failed evidence stay intact.
