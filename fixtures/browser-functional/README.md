# Earth three-browser functional floor

These are Earth application assertions and fixtures. The shared installed
`@foss-earth/browser-testing/page` export owns browser protocols, profiles,
timeouts and graceful process shutdown. No browser code is copied here. The
runner never installs tools, builds a site or starts a server implicitly.

This source is prepared under the coordinator's source-only assignment. None of
the commands below has been run under that assignment. A new explicit slot and
browser/server grant, plus an exact installed helper archive, are prerequisites.

The live floor exercises Chrome WebGL 2, Firefox WebGL 2 and WebKit WebGL 2
sequentially. Each run opens the canonical app on port 4180 and the canonical
landing delivery on port 4181. Both servers verify the existing compiled
manifest file by file before listening. They never serve the old coordinator
preview. A changed or linked file fails admission before a browser starts.

The app must show one actual globe canvas, an active globe/map mesh, a rendered
frame and nonuniform framebuffer pixels through the existing application
`panoramaTest=1` hook and public Babylon readback API. A shell, loading page,
boot error, absent camera or substituted backend cannot pass. The existing
`bench=1` app handle drives public camera navigation. DOM tab interactions,
Escape, About source identity and the theme toolbar exercise the mounted app;
theme persistence is checked after a new page load. Synthetic DOM input is
recorded as such and does not qualify physical input devices.

The scene fixture only authors metadata. Its generated cardinal JPEG images
are referenced directly from the exact compiled app and remain byte identical
to `public/examples/panorama-scenes/media/cardinal-grid/`. Their original
attribution, source preparation files and project notices remain in that
directory and the application [Notice](../../NOTICE). No photograph, image or
DEM is generated or re-encoded by this suite. `image-source-receipt.json`
records those exact source files. The fixture's 200 m ellipsoid coordinate is an
authored synthetic placement. It is not a surveyed height. It uses
capture-relative placement, so live elevation accuracy is not an acceptance
dependency.

A public custom raster descriptor references the existing 256 px cardinal face
at legal integer levels 0–2, with two concurrent requests. The existing map
runtime must adopt it. External imagery, elevation, geoid and update traffic
is refused by explicit browser proxy settings; the no-DEM route returns 404.
The existing coarse surface/fallback therefore remains valid visual coverage,
without any terrain accuracy claim. Scene preview readiness, placement,
immersion draw records, exit and unload exercise the existing image owners and
their navigation lifecycle. The `?dev=1` load must mount Earth's host-owned
runtime contribution; the ordinary load must omit Dev.

Worker scope is checked on the live landing origin with service workers allowed
in all three browsers. The compiled app worker must control `/app/` through
`/app/foss-earth-sw.js`; the root landing must have no app canvas or controlling
worker, and `/foss-earth-sw.js` must return 404. This is independent of the
shared helper's interception mode, where blocked WebKit workers cannot prove
worker behavior.

The server has a 20 minute lifetime, 4,000 request ceiling and 16 MiB response
ceiling. Each browser run aborts after 300 seconds at its next bounded command
(15 seconds maximum), then closes through the shared helper (10 seconds plus
its 5 second process-exit budget). The existing profile is never reused: a run
requires a new output directory. Evidence, failure screenshots and close
failures are retained. Shared console/network captures are bounded and
sanitized. Driver strings and known software renderers are recorded; hardware
GPU confirmation and GPU timings are explicitly unavailable. This floor is not
mobile Safari, WebGPU or a performance benchmark.

The frozen request uses this sequence after a grant:

1. Installed Node causal assertions, one worker:
   `node --test --test-concurrency=1 scripts/validation/browser-functional.test.mjs`
2. Start explicit canonical fixture servers and retain their PID/log receipts:
   `node fixtures/browser-functional/serve.mjs --mode=app --root=<canonical-app-dist> --receipt=<exact-app-release-json> --receipt-sha256=<trusted-manifest-digest>`
   and `node fixtures/browser-functional/serve.mjs --mode=landing --root=<canonical-landing-dist> --receipt=<same-exact-app-release-json> --receipt-sha256=<same-trusted-manifest-digest>`.
3. Run the following command once per browser, sequentially, with distinct
   owned ignored output/profile directories and injected tools from the
   coordinator's private decision:

```sh
node scripts/validation/browser-functional.mjs \
  --browser=chrome --backend=webgl2 \
  --url=http://127.0.0.1:4180/app/ \
  --landing-url=http://127.0.0.1:4181/app/ \
  --output=<new-canonical-app-build-directory> \
  --binary=<recorded-existing-Chrome-binary> \
  --source-revision=<exact-app-source-commit> \
  --compiled-sha256=<exact-compiled-archive-sha256> \
  --compiled-manifest-sha256=<trusted-manifest-digest> \
  --helper-version=0.1.0
```

Firefox selects its recorded existing binary. WebKit replaces `--binary` with
`--playwright-root=<recorded-tool-home>` and
`--playwright-cache=<recorded-browser-cache>` and requires Playwright 1.55.0,
playwright-core 1.55.0 and WebKit revision 2203. No acquisition or automatic
download is allowed. After each run, inspect actual lifecycle close receipts;
after all runs, gracefully stop only the two owned servers and confirm their
ports are no longer listening. The shared WebKit adapter uses Playwright's
public BrowserServer process PID and an ephemeral loopback transport; it
records that origin without the secret endpoint path. Every browser's actual
exit result belongs in the close receipt. Independent process/port inspection
is still required before the slot is released.

The helper is resolved through its public installed export under this app's
`node_modules/@foss-earth/browser-testing`. A symbolic source link, sibling
checkout, private import or alternate implementation is rejected. Exact archive
and installed file-map qualification belongs to the surrounding frozen
package-only consumer chain. Chrome WebGPU remains a separate
future capability requests, with explicit support and evidence before any
acceptance claim.

## Required WebGL1 and WebGL2 matrix

The user has made both WebGL versions required for Chrome, Firefox and WebKit.
Run six independent profiles sequentially; each run repeats the full functional
assertions. `--backend=webgl1` sets the existing `renderer=webgl` URL selection
and requires actual mode `webgl` plus `engine.webGLVersion === 1`. WebGL2 requires
mode `webgl2` plus version2. Missing support and fallback are failed acceptance,
not skips. WebGPU stays separate. The original child WebGL2-only request remains
retained; the primary frozen request supersedes its backend scope.

Every startup sets the existing public camera to lat0/lon0, heading0, pitch0 and
zoom8,000,000m before framebuffer sampling. This keeps the real coarse globe in
view when external providers are denied, avoiding a false blank-buffer failure
from a uniform close-up fallback. Camera navigation then uses a distinct view.
No runtime, imagery generation, elevation or provider policy changes are made.
