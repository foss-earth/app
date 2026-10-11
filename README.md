# FOSS Earth

The standalone Earth application composes independent globe, rendering, UI,
toolbar, scene and image providers through their public packages. This checkout
also keeps the `foss-earth` application and compatibility exports used while
Campus and Flight adopt the split providers. Shared implementations live in
their owning repositories; the old monolith is a read-only recovery input.

The standard application lives in `foss-earth/app`. The separate
[foss-earth.github.io](https://github.com/foss-earth/foss-earth.github.io)
repository owns the landing page and assembles this application's exact compiled
artifact at `/app/`. Provider code remains in its independent owner repository.
Known application UX follow-ups are recorded in [the TODO list](docs/todo.md).

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
- `vite.config.ts` and the tsconfigs select that condition and keep linked paths
  (`preserveSymlinks`), which is what makes library imports resolve from this
  app's `node_modules`.
- `.npmrc` passes the same condition to Node, which loads the libraries' Vite
  plugins from source; `vite/sourceImports.mjs` lets their `.js` import names find
  the `.ts` files.

A library's own tests and build don't run on their own yet: the libraries still
name each other by version, and those versions are not published. Linking them
to their siblings the same way is the next step. If a library has its own
`node_modules`, that copy wins for its imports in the app, so keep libraries
without one. Using pinned releases or GitHub-hosted builds of the libraries
instead of local source is planned but not available yet.

## Application contracts

`mountGlobeApp` creates the app and composes the shared overlay. `createGlobeApp`
exposes the existing host integration handle. `foss-earth/runtime`, `/shell`,
`/scenes`, `/settings`, `/input`, `/diagnostics` and `/vite` remain compatibility
surfaces; new integrations use the owning package and explicit host ports.
Vite plugins preserve app-file caching and build descriptions. The compatibility
source exports require a TypeScript-aware bundler; they are not native Node
JavaScript entries.

The app owns URL/saved-setting policy, page identity, browser ports, example
content and feature composition. Engine owns Map, Location and globe input;
Renderer owns its presentation/lifecycle; Sky owns Sky and Date and time;
Scenes owns scene documents/placements; 360 owns panorama viewing. Image
structures and preview preparation retain their distinct owners. About and
Dev receive application data and contributions. `?dev=1` enables Dev.

Weather currently delivers the extracted manual wind behavior. Forecast,
provider, cloud and additional turbulence capabilities are not implemented by
that release. Preserved research or dirty recovery source is not a release
claim. Follow [the owner documentation](https://github.com/foss-earth/docs/blob/main/README.md)
for the complete ownership/tab/image specifications and UI/rendering guidance.

## Project policies

- [Code of conduct](https://github.com/foss-earth/.github/blob/main/CODE_OF_CONDUCT.md)
- [Contributing](https://github.com/foss-earth/.github/blob/main/CONTRIBUTING.md)
- [AGPL-3.0 license](LICENSE)
- [Security](https://github.com/foss-earth/.github/blob/main/SECURITY.md)

Keep [NOTICE](NOTICE), [commercial licensing](COMMERCIAL_LICENSE.md) and
asset-specific provenance with the original materials. The application's
license does not relicense third-party imagery, data or fork assets.
