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

and open `http://localhost:5173/app/`. The other commands are `npm run typecheck`,
`npm run lint`, `npm test`, `npm run build` (output in `dist/`, built for the
`/app/` route) and `npm run preview`. Pages assembly and deployment belong to the
landing repository.

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
- 360: panorama viewing.
- Image structures and preview preparation each have their own library.
- About and Dev receive application data and contributions. `?dev=1` enables Dev.

Inside a panorama, the position readout uses the picture's capture coordinates
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
