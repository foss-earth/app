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
Exact local artifacts and public exports are recorded in
[dependency-pins.json](dependency-pins.json); local qualification receipts and
remaining publication gates are described in [split status](docs/split-compatibility.md).

## Development

Use one checkout per source provider, under the same organization directory:

```text
workspace/
  foss-earth/
    app/  foss-earth.github.io/
    engine/  renderer/  ui/  toolbar/  sky/
    images/  360/  scenes/
    cubemap/  equirectangular/  tiled-cubemap/  preview-sheets/
    about/  dev/  weather/  ci/  dev_installer/
  Felipegalind0/gamepad-tools/
```

The group directory itself is not a Git repository. The shared installer owns
source links, exact package mode and persistent hybrid choices. Source changes
must reach every selected consumer through the provider's public exports, with
one Babylon and React identity. [workspace-plan.json](workspace-plan.json)
records the intended closure and build order. It is explicitly a preparation
plan, not an executable manifest with invented application or release pins.

`scripts/setup.mjs` calls the installed shared installer after verifying all
sealed executable inputs. Until Earth delivers a qualified default bootstrap,
pass an externally reviewed `--manifest`/`--manifest-sha256` or `--bootstrap` and
an explicit `--root`. The currently sealed installer supports exact mode and
explicit links; source defaults and persistent hybrid choices await Platform's
replacement qualification. Do not use plain registry versions to substitute
for the exact archive identities, or copy provider source into this app.

For the exact packaged local checkpoint, run `npm ci --offline --ignore-scripts`
using the retained cache, then `npm run dev -- --host 127.0.0.1 --port 4180` and
open `http://127.0.0.1:4180/app/`. Build output is `dist/`.

After reviewed dependencies and the lockfile are prepared, the app's explicit
commands are `npm run dev`, `npm run typecheck`, `npm run lint`, `npm test`,
`npm run build` and `npm run ci`. `dev` and `preview` start servers only when
requested. During migration all execution follows the coordinator's shared
verification slot. The app builds with `/app/` as its asset and worker base. Pages assembly and
deployment belong to the landing repository.

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

- [Code of conduct](CODE_OF_CONDUCT.md)
- [Contributing](CONTRIBUTING.md)
- [AGPL-3.0 license](LICENSE)
- [Security](SECURITY.md)

Keep [NOTICE](NOTICE), [commercial licensing](COMMERCIAL_LICENSE.md) and
asset-specific provenance with the original materials. The application's
license does not relicense third-party imagery, data or fork assets.
