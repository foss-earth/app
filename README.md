# FOSS Earth

The standalone Earth application. It composes independent globe, rendering, UI,
toolbar, scene and image libraries through their public packages. This repository
also keeps the `foss-earth` application and compatibility exports used by Campus
and Flight while they adopt the split libraries. Shared implementations live in
their own repositories.

The landing page is in
[foss-earth.github.io](https://github.com/foss-earth/foss-earth.github.io), which
assembles this application's compiled build at `/app/`. Known application UX
follow-ups are in [the TODO list](docs/todo.md).

Open **+ → Browser data** to review clearing this site's saved settings, window
layout, stored media and app caches, then reload. **Keep API keys** starts checked;
uncheck it to remove the saved Google Maps and CARTO keys too. The review runs
on a separate page before deleting data. This clears data for the current site
origin, including other apps hosted on that origin.

After two failed or stalled starts, the page offers **Download crash log** and then
**Clear browser data** as a recovery option. The crash log is a `.txt` file of the failed
starts, the last failure's message and each visit's trail kept on the device; clearing
deletes those, so the review page offers the download again before its clear button.
The recovery code is included in the HTML, so the option can appear even
when the application bundle fails to load. You can also open the app address with
`?resetBrowserData=1` to reach the review directly. A successful start resets the
failure count; data is cleared only after confirmation.

The browser's HTTP cache and cookies hidden from JavaScript require the browser's
own site-data controls. The review explains this and reports any storage it could
not clear.

## Development

Clone the Earth repositories side by side in a `foss-earth` folder, with
`gamepad-tools` in a `Felipegalind0` folder next to it:

```text
foss-earth/
  app/  ui/  images/  weather/  about/  dev/  renderer/  sky/  toolbar/
  cubemap/  equirectangular/  tiled-cubemap/  preview-sheets/  engine/  360/
  scenes/  browser-testing/
Felipegalind0/
  gamepad-tools/
```

Then, in `app/`:

```sh
npm install
npm run dev
```

and open `http://localhost:5173/app/`. `npm run dev -- --host` also serves it
on the LAN, so a phone on the same Wi-Fi can open `http://<this-machine>:5173/app/`.
That page is plain HTTP, so `crypto.randomUUID` is missing. `randomId` in
`src/app/randomId.ts` uses `crypto.getRandomValues` instead, and startup depends
on that. The other commands are `npm run typecheck`,
`npm run lint`, `npm test`, `npm run build` (output in `dist/`, built for the
`/app/` route) and `npm run preview`.

Publishing https://foss-earth.github.io/ is a separate step, from any directory:

```sh
cd ~/gh/foss-earth/app && npm run build
cd ../foss-earth.github.io && npm run build && npm run deploy
```

The campus tour links this checkout, so it is published on its own afterwards
with `cd ~/gh/UMN-VR/tour && npm run deploy`. The steps are in
[Deploying to GitHub Pages](https://github.com/foss-earth/docs/blob/main/docs/deploying.md).

### VR without a headset

`npm run dev` serves an emulated headset, Meta's Immersive Web Emulation
Runtime (`iwer`), to a page opened with `?headsetEmulator=quest3` (or `quest2`,
`questPro`), such as `http://localhost:5173/app/?headsetEmulator=quest3`. The
page then runs as it does on a headset: the VR tab opens, and Enter VR draws
both eyes side by side over the page. From the console,
`__fossEarthHeadsetEmulator` moves the headset and controllers and presses
their buttons, e.g.
`__fossEarthHeadsetEmulator.remote.dispatch("set_transform", { device: "headset", orientation: { x: 0, y: 0.383, z: 0, w: 0.924 } })`
turns the head 45° to the left, and
`__fossEarthHeadsetEmulator.controllers.right.updateButtonValue("trigger", 1)`
pulls the right trigger. A build never contains it (`vite/headsetEmulator.ts`,
`src/dev/headsetEmulator.ts`).

`npm run check:headset` goes through a headset visit in headless Chrome, using
the emulated headset and the linked example pair: Enter VR, both eyes drawn,
turning the head, a snap turn, a photograph opened with the trigger, a link
followed, the grip back to the map, and the session ended. It starts its own dev
server and writes a report and screenshots to `build/headset/<time>/`.
`--url=` checks another page that mounts the app from a dev server with
`headsetEmulator()`, such as the tour's; `--scene=page` keeps that page's own
scene:

```sh
cd ~/gh/UMN-VR/tour && npm run dev
cd ~/gh/foss-earth/app && npm run check:headset -- --url=http://localhost:5173/tour/minneapolis/ --scene=page
```

The emulator is not a headset: it checks what the page does with WebXR, not how
a real device's browser, frame rate or lenses treat it.

### Local source

The app uses every Earth library straight from its checkout. `package.json` links
each one (`file:../ui`), and Vite compiles their TypeScript, so a change in
`../ui/src` shows up in the running app without building or installing anything
in `ui/`. Only `app/` has a `node_modules`: the libraries' imports of Babylon,
React and the rest resolve from it, so there is one copy of each.

- Each library's `package.json` exports have a `source` condition that points at
  its TypeScript entry.
- `vite.config.ts` and the tsconfigs select that condition. During development,
  the `localSource()` Vite plugin resolves linked packages to their actual
  checkout files, so Vite watches edits and serves them without a cached
  dependency bundle. It still resolves their dependencies through this app's
  `node_modules`. Public CSS exports also resolve to their source stylesheets,
  in development and production builds, including nested CSS `@import`s that
  otherwise select built files.
- `.npmrc` passes the same condition to Node, which loads the libraries' Vite
  plugins from source; `vite/sourceImports.mjs` lets their `.js` import names find
  the `.ts` files.

Apps using the linked `foss-earth` checkout should import `localSource` from
`foss-earth/vite` and add `localSource()` to their Vite plugins too. Selecting
the `source` condition alone does not prevent Vite from caching linked packages
under `node_modules`.

A library's own tests and build don't run on their own yet: the libraries still
name each other by version, and those versions are not published. Linking them
to their siblings the same way is the next step. If a library has its own
`node_modules`, its own tests and build use that installation; `localSource()`
keeps the development app on its shared installation. Using pinned releases or
GitHub-hosted builds of the libraries instead of local source is planned but not
available yet.

## Application contracts

`mountGlobeApp` creates the app and composes the shared overlay. `createGlobeApp`
exposes the host integration handle. The `foss-earth/runtime`, `/shell`,
`/scenes`, `/settings`, `/input`, `/diagnostics` and `/vite` exports are
compatibility surfaces; new integrations should use the owning package and
explicit host ports. The Vite plugins keep app-file caching and build
descriptions. The compatibility source exports need a TypeScript-aware bundler;
they are not native Node JavaScript entries.

The app owns URL and saved-setting policy, page identity, browser ports, example
content and feature composition. The libraries own the rest:

- Engine: Map, Location and globe input.
- Renderer: presentation and lifecycle.
- Sky: Sky and Date and time.
- Scenes: scene documents and placements.

- 360: sphere viewing.
- Image structures and preview preparation each have their own library.
- About and Dev receive application data and contributions. `?dev=1` enables Dev.

Image links are editable in **Scenes → Image links** in local development or with
`?dev=1`. Choose source and destination photographs, add a one-way or two-way
connection, and follow it immediately. Nearby destinations appear first, with
their distance. Hotspots point toward the destination's capture location. Edits
are saved per scene URL in this browser and also apply on ordinary visits.
Download links or Copy JSON exports `foss-earth-link-overrides` version 1 for a
scene's build tools to import; hosts can set `linkExportPrefix` on `mountGlobeApp`.
Remove and Reset this scene affect local additions; authored scene links remain.
Once a loaded scene authors a saved addition, the browser forgets that addition.

Inside a sphere, the position readout uses the picture's capture coordinates
and height, with live heading, pitch and vertical FOV in degrees. Unknown capture
height shows a dash. Clicking the readout opens the picture's tab; leaving the
picture restores the globe's position, camera altitude and zoom distance.

Weather currently provides manual wind only. Forecast, provider, cloud and extra
turbulence features are not implemented. For the full ownership, tab and image
specifications and the UI and rendering guidance, see
[the documentation repository](https://github.com/foss-earth/docs/blob/main/README.md).

## Project policies

- [Code of conduct](https://github.com/foss-earth/.github/blob/main/CODE_OF_CONDUCT.md)
- [Contributing](https://github.com/foss-earth/.github/blob/main/CONTRIBUTING.md)
- [AGPL-3.0 license](LICENSE)
- [Security](https://github.com/foss-earth/.github/blob/main/SECURITY.md)

Keep [NOTICE](NOTICE), [commercial licensing](COMMERCIAL_LICENSE.md) and
asset-specific provenance with the original materials. The application's
license does not relicense third-party imagery, data or fork assets.
