# Scene screenshot capture

`scripts/capture-scenes/capture.mjs` takes a picture of an actual FOSS Earth scene with no
interface in it. It sets the place, camera, time and scenery from a scenario file, waits
until everything has loaded and held still, then saves the uncompressed original and a
compact WebP. The first uses are square backgrounds for two of the 0SFS landing page's cards:
`sky-sunset-orbit`, the Sun setting over UMN seen from orbit, and `night-lights-orbit`, cities lit
below a sunset glow.

It needs no change to the app. It drives the production build through the handle the app
exposes with `?bench=1` (`window.__fossEarthBench.runtime`). An exposure bracket also uses the
settings the app exposes with `?panoramaTest=1`. The capture-only presentation is injected into
the captured page alone, so ordinary visits never see it.

## Use

```sh
cd ~/gh/foss-earth/app
node scripts/capture-scenes/capture.mjs sky-sunset-orbit             # capture into build/
node scripts/capture-scenes/capture.mjs sky-sunset-orbit --publish   # and copy to the website
node scripts/capture-scenes/capture.mjs night-lights-orbit \
  --set observer.fromReference.sunAboveLimbDeg=-6 \
  --set camera.headingOffsetDeg=50                                   # tune without editing the file
node scripts/capture-scenes/capture.mjs sky-sunset-orbit \
  --set settings.sky.exposure.ev100=11                               # a fixed exposure: lower is brighter
node scripts/capture-scenes/capture.mjs night-lights-orbit \
  --set settings.renderer.exposureEV=1                               # one stop brighter than the meter chose
node scripts/capture-scenes/capture.mjs sky-sunset-orbit \
  --bracket=-2,-1,1,2                                                # compare exposures side by side
node scripts/capture-scenes/capture.mjs sky-sunset-orbit \
  --set settings.sky.exposure.lensFlare=glare                        # the lens's glare without its ghosts
node scripts/capture-scenes/capture.mjs sky-sunset-orbit --dry-run   # check the scenario and build only
```

| Option | Effect |
| --- | --- |
| `<scenario>...` | One or more names from `scripts/capture-scenes/scenarios/`, or paths to JSON files. |
| `--set path=value` | Overrides a scenario field after loading; repeatable. The value is read as JSON when it parses. `settings.<id>=value` keeps the dots of the app parameter id. `null` removes a field. |
| `--publish` | Copies the WebP and JPEG to the scenario's `publish` paths. |
| `--bracket=STOPS,...` | Also captures the same view at these exposure compensations, in stops on top of the scenario's exposure (+ is brighter), and shows them side by side in `preview.html`. See [Tuning the exposure](#tuning-the-exposure). Write it with `=`: a value starting with `-` is otherwise read as an option. `--publish` still publishes only the scenario's own exposure. |
| `--rebuild` | Builds the app into `build/capture-scenes/app-dist` first. The shared `dist/` is never touched. |
| `--app-dist DIR` | Serves this build instead. |
| `--out DIR` | Writes runs here instead of `build/capture-scenes/runs`. |
| `--port N`, `--timeout SEC` | Local server port (default: any free one) and a readiness limit that overrides the scenario's. |
| `--no-cache` | Uses no shared Chrome disk cache, so every tile is downloaded again. |

A run with a warm cache takes about 5 seconds. Add about 2 seconds for `--rebuild`, and about 2 for
each bracket step.

When other people or agents build the app, name the build with `--app-dist`. Otherwise a
`npm run build` of theirs into `dist/` becomes the newest build, and the next capture uses it. The
report would say so, but the pictures would change.

## Tuning the exposure

The app has no tone mapping. The display's white is a luminance of 1.2 × 2^EV cd/m², and anything
brighter clips. Two app settings choose how bright a picture is, and both work as `--set` overrides:

| Setting | What it does | Use it for |
| --- | --- | --- |
| `settings.sky.exposure.ev100=N` | A fixed exposure: EV at ISO 100, from −12 to 20. Lower is brighter, and each step down doubles everything. It applies only when `sky.exposure.mode` is `fixed`. | Scenarios with a fixed exposure, like `sky-sunset-orbit` (EV 12). |
| `settings.renderer.exposureEV=N` | Exposure compensation: from −16 to 16 stops, applied after the sky's exposure, fixed or metered. Higher is brighter; +1 doubles everything. | Metered scenarios, like `night-lights-orbit`, where the meter picks the EV. |

With a fixed exposure the two are interchangeable: compensation +1 at EV 12 gives the same picture as
EV 11.

To choose by eye, add `--bracket`:

```sh
node scripts/capture-scenes/capture.mjs sky-sunset-orbit --bracket=-2,-1,1,2
```

The run first takes the scenario's own picture. Then, in the same page, it sets each compensation in
turn and waits for the picture to hold still again, so every step shows the same loaded view.
`preview.html` shows all the steps at card size, darkest first, with the scenario's own outlined; click
one for full size. Each caption gives:

- the EV the picture is shown at
- how many stops the Sun is over white, when it has a lens flare
- the mean brightness, and the shares clipped and near black
- the `--set` that gives that picture

To keep a step, put its setting in the scenario's `settings`, or run the scenario with that `--set` and
`--publish`. Each step was checked against a fresh capture at the same setting. The night card at +1 was
identical. The sky card at +1 and +6 differed by one level in at most 5 pixels.

## What a run does

1. **Build.** By default it reuses the newest of `build/capture-scenes/app-dist` and `dist/`, and builds
   only when neither exists. It reads `<script id="foss-earth-built-from">` from the build. Each recorded
   checkout is compared with that checkout now: commits since the build, and uncommitted files then and
   now. The report says which of three cases applies: the committed source now, the working tree including
   uncommitted changes, or older than the checkouts now. An old build is never described as current.
2. **Serve.** It serves the build at `http://localhost:<port>/app/` for this run only, on 127.0.0.1.
3. **Open.** It opens headless Chrome through `@foss-earth/browser-testing/page`, using a profile inside
   `build/capture-scenes/profiles/`. The profile is deleted after each run because it stores the key.
   The window is exactly the picture's size. The app address carries:
   - the map source and renderer
   - the fixed sky time
   - the field of view
   - each scenario setting, as `set.<id>=<value>`
4. **Aim.** Once the app runs, the script plans the eye from the sky's Sun direction and puts it in place.
   Placement uses `restoreNavigationSnapshot`, with the orbit centre 1 m in front of the eye, as the
   engine's own placed views do. Seen from the starting view on the ground, the Sun's direction includes
   the air's refraction, which an eye in orbit does not see. So the script waits for the sky to be computed
   at the placed eye, plans again, and repeats until the aim holds.

   "At the placed eye" means within the sky's own recompute step. The sky is computed again only once
   travel moves the Sun by `sky.update.sunAngle` (0.05° by default, about 5 km of travel), so its
   observer can trail the eye by up to that. The script accepts 1.1 times the step, as an ordinary visit
   would show it, and reports the gap as `sky.observerLagDeg`.
5. **Wait.** It polls every 250 ms. It captures only after 8 polls in a row show nothing still loading and
   nothing changed. Problems that waiting cannot fix stop the run instead of producing a picture:
   - a different map source than required, or a map error
   - the camera moved, the field of view is not vertical, or the sky time is wrong
   - the world drawn in the split presentation, or a canvas size different from the picture's
   - any visible interface
   - a night-light tile that failed to load, unless `readiness.allowNightLightFailures` is true
   - a lens flare that settled without being ready (`error`, `unsupported` or `xr`, with the app's reason),
     or a scenario that asks for one from a build that has none

   Any of these keeps it waiting:
   - the app is starting
   - the sky is not yet computed for the eye
   - the star catalogue or night-light tiles are loading
   - the lens flare is not yet in the mode asked for, or not yet settled (its shaders compiling, or the
     reading of how much of the Sun is hidden still on the GPU)
   - the picture is not yet drawn at the exposure compensation asked for
   - map tiles are streaming, none are visible yet, or no loaded detail is measurable
   - fonts are loading
   - attribution artwork is loading, when attribution is kept
6. **Capture.** It draws two frames, takes the screenshot and probes again. If anything changed while
   capturing, it waits again, up to `readiness.attempts` times.
7. **Bracket.** With `--bracket`, it sets `renderer.exposureEV` to each step through the app's settings,
   then waits and captures again as in steps 5 and 6. Each step gets its own readiness limit. The page is
   opened with `?panoramaTest=1` for this, which makes no difference to the picture.
8. **Encode and check.**
   - It checks that the picture is the requested size and not blank.
   - It finds the Sun's disc near its predicted pixel and reports the offset. When the Sun is behind the
     Earth (its whole disc below the edge), the report says so and nothing is measured.
   - It encodes WebP with `cwebp -sharp_yuv`, decodes it back for inspection, and encodes JPEG (macOS
     `sips`, or the app's `jpeg-js`).
   - It encodes each bracket step to WebP the same way. A blank step is not an error, since a step can be
     too dark or too bright to show anything.

## Outputs

Each run writes to `build/capture-scenes/runs/<scenario>/<UTC time>/`, and `runs/<scenario>/latest.txt`
names the newest run. The files are:

| File | Contents |
| --- | --- |
| `original.png` | The uncompressed screenshot. |
| `final.webp`, `final.jpg` | The compact encodings that get published. |
| `final-decoded.png` | The WebP decoded back: what the website shows at full size. |
| `bracket/stops±N/` | With `--bracket`: each step's `original.png` and `final.webp`, e.g. `bracket/stops+1/`. |
| `preview.html` | The WebP at card sizes and full size, the original, and a summary. With `--bracket`, every step at card size, as described above. |
| `report.json` | Everything needed to explain or reproduce the picture: the scenario and overrides; the planned, read-back and measured camera; the Sun above the edge and its measured pixel; the time and whether it was held exactly; the map mode, tiles and detail; the attribution the app showed; the sky's exposure (with what the meter read, and how much of it was the ground below the eye), the exposure compensation and the EV the picture is shown at (`sky.exposureCompensationEv`, `sky.effectiveEv100`); the sky observer's lag behind the eye, the night lights' state and the lens flare's (mode, status, how much of the Sun is seen, its stops over white and its pixel); renderer and GPU; build provenance; readiness attempts; console errors. With `--bracket`, `bracket.steps` holds each step's exposure, measurements, files and readiness. |

## Scenarios

Scenario files are JSON in `scripts/capture-scenes/scenarios/`. A file may name a parent with `extends`,
a path relative to itself. Objects merge and everything else replaces. A child keeps only its own
`name`, `description` and `publish`.

| Field | Meaning |
| --- | --- |
| `name` | Lower-case letters, digits and hyphens; names the run directory. |
| `time.utc` | An ISO instant with a zone. The sky's time is fixed to it, and the report checks that it was held exactly. |
| `reference` | `{label, latDeg, lonDeg}`: the place the observer is placed from. The report says where it falls in the picture. |
| `observer.altitudeKm` | The eye's height above the ellipsoid. |
| `observer.latDeg`, `lonDeg` | A fixed eye position. Use either this or `fromReference`. |
| `observer.fromReference` | `bearingDeg` (degrees, `"away-from-sun"` or `"towards-sun"`) plus one of: `distanceKm` along the great circle (0 to 20,000), or `sunAboveLimbDeg` (−10 to 80). The latter is solved for the distance, within 10,000 km, at which the Sun stands that high above the Earth's edge. At a fixed time, moving the eye is what raises or lowers the Sun. Below zero the Sun is behind the Earth and the eye is in the Earth's shadow. A child that switches from one to the other sets the parent's to `null`. |
| `camera.headingDeg` | Degrees, or `"sun"`. Optional `headingOffsetDeg` adds to it. |
| `camera.limbAtY` | Where the Earth's edge falls, as a fraction of the picture from the top; this fixes the tilt. Use `elevationDeg` (−89 to −1) instead to set the tilt directly. |
| `camera.verticalFovDeg` | Vertical field of view, 10 to 120 degrees. |
| `scenery` | `basemap` (the app's `mapSource`), `requireMode` (the runtime mode the capture insists on, e.g. `google-tiles`) and `renderer`. |
| `settings` | App parameters by id, e.g. `"sky.exposure.mode": "fixed"`. `null` drops a setting a parent gave, leaving the app's default. The Google key cannot be set here. |
| `attribution` | `true` keeps the map's attribution chip in the picture. `false` hides all interface, and the page showing the picture must credit the map itself; the report's `scenery.attribution` holds the credit and link. |
| `hideSceneMeshes` | Name prefixes of scene meshes that are interface, not world. The default is `["orbit-compass"]`, the horizon compass's letters and needle. |
| `image` | `width` and `height` in CSS pixels at device pixel ratio 1. |
| `encode` | `webpQuality` and `jpegQuality`; `"jpeg": false` skips the JPEG. |
| `publish` | `webp` and `jpeg` destinations, used with `--publish`. `~/` is expanded. |
| `readiness` | `timeoutSec` (240), `pollMs` (250), `stablePolls` (8), `attempts` (3), `allowNightLightFailures` (false), and optionally `maxLoadedErrorPx`. |

## Scenarios provided

| Scenario | Picture |
| --- | --- |
| `sky-sunset-orbit` | The sky card's background, 1200 × 1200, published as `sky-sunset-orbit.webp`/`.jpg`. At 23:10:58 UTC on 25 October 2026, the 0SFS hero video's instant and UMN's sunset: from 400 km above northern Maine, looking west to the Sun 2° above the Earth's edge, with UMN on the edge directly below it. Fixed EV 12, with the full lens flare (`sky.exposure.lensFlare`: `flare`): a starburst and halo around the Sun, and four ghost rings on the line from it through the picture's centre. |
| `night-lights-orbit` | The night-lighting card's background, 1200 × 1200, published as `night-lights-orbit.webp`/`.jpg`. At 22:16 UTC, from 400 km off Espírito Santo, looking west-north-west over lit Minas Gerais and Goiás to the sunset glow on the Earth's edge. The Sun is 4° behind the edge; metered exposure, EV 1. |
| `night-lights-orbit-europe`, `-us-east`, `-nile`, `-us-midwest` | Other places tried for the night card: the Alps and the Po Valley, the US East Coast at the hero video's instant, the Nile, the Midwest. Not published. |
| `sky-sunset-orbit-north-atlantic` | From 5000 km over the North Atlantic at 22:16 UTC, the Sun just behind the edge. A thin white arc; lights small, in Iberia and France. Not published. |
| `sky-sunset-orbit-wide` | The first 1920 × 432 strip, published as `sky-sunset-orbit-wide.*`: at 22:16 UTC, the Sun 2° above the edge from 400 km, the orange band at a fixed EV 12, no lights. |
| `sky-sunset-orbit-sun-3deg` | The strip with the Sun 3° above the edge. |
| `sky-sunset-orbit-umn-on-limb` | The strip with UMN on the edge (the Sun 8.4° up, a pale blue daytime edge), metered, the map's chip kept. |
| `night-lights-check-europe` | A check that city lights render: France, Benelux and England from 400 km at 23:16 CET. Not for publishing. |

## Capture-only presentation

The page is the production build, changed only inside this page:

- A `<style>` scoped to `html[data-capture-scene]` hides every element except the globe canvas.
  When `attribution` is true, the map chip stays too, without its download rate, warning and detail rail.
- Windows marked `data-occlude-world`, and the log, are removed from layout, because the engine masks
  the world beneath them.
- The focus is blurred and the cursor hidden.
- Scene meshes matching `hideSceneMeshes` are set invisible.
- A scan of the page lists every element still drawing. Any element in that list, or a remaining world
  mask, stops the capture.

## Google key

The script reads the key with `readGoogleKey` from `@foss-earth/engine/prepare-heights`. It tries
`GOOGLE_3D_TILES_KEY` or `FOSS_EARTH_GOOGLE_KEY` first, then these files in order:

- `app/.env.local`
- `~/gh/UMN-VR/tour/.env.local`
- `~/gh/0sfs/fly/.env.local`

It logs only which source had the key. The key reaches the page through its address, which is redacted
in the log and report. As a further guard, the report text is scrubbed of the key before it is written.

The shared Chrome cache in `build/capture-scenes/chrome-cache/` can hold tile addresses that contain
the key. Like everything in `build/`, it is ignored by git and must not be shared. `--no-cache` avoids it.

## Limitations

- **Only the Sun flares.** Without `sky.exposure.lensFlare` the Sun is its bare 0.53° disc, 16 px
  across at 40° over 1200 px. `glare` adds the lens's starburst and halo; `flare` adds its ghosts too, in
  a line through the picture's centre. The ghosts brighten with the exposure. Nothing else glows: the
  sunset band clips without bloom.
- **Compensation and stars.** The sky decides whether to draw the star field at its own exposure, before
  compensation. So a large positive compensation could lack faint stars that the same EV, fixed, would
  show. This comes from reading the code; it has not shown in these scenes.
- **No tone mapping.** A picture holds either the sunset glow or city lights, not both unclipped:
  - Exposed for the lights (metered over the night side, EV 1), the glow nearest the Sun clips to white.
  - Exposed for the glow (EV 12), the lights are at most about a ten-thousandth of white: black.
- **From orbit the meter reads the ground below the eye, not the ground in view.** Until 2026-10-26 it
  read the light at the eye, which from 400 km stays in sunlight until the Sun is 20° below the ground's
  horizon. Over the night side a sunlit eye then chose about EV 15.7, and city lights showed only while
  the eye was in the Earth's shadow. The sky now moves the reading to the ground below between 20 and
  100 km up (`sky.exposure.groundMeterAltitude`). Builds from before then still behave the old way; their
  reports have no `sky.meterGroundShare`. Looking from above the day side across the terminator, the
  night beyond is still exposed for the day.
- **Night lights** switch on only where the Sun is below −5.02° on the ground, and are as sharp as their
  tiles: soft dots a few pixels across from 400 km.
- **Stars.** They follow the sky's exposure rules: they show at night exposure, and none show at EV 12.
- **Provenance is reported, not enforced.** A build of a working tree with uncommitted changes is
  reported as such, but it cannot be reproduced from commits alone.
- **Device pixel ratio is 1.** For sharper pictures, raise `image.width` and `image.height`. Both are
  limited to 4096 px.
