# Installed Earth application consumer

The primary Earth checker supplies a sealed `foss-earth` archive, a separately
sealed private consumer package manifest and lockfile, and runtime archive pins.
`scripts/check-installed-app.mjs` installs that exact closure into a fresh private
workspace with npm scripts disabled. It checks strict TypeScript Bundler
resolution and performs an actual Vite build of all 24 public package routes,
including the four CSS routes, scene schema and three Vite plugins. The generated
service worker must contain the worker bytes packed in the application archive.

Runtime and provider package resolution must remain inside the consumer workspace
and converge on one physical package for each runtime identity. Separately locked
nested tool versions are reported without being mistaken for a runtime duplicate.
Negative controls prove that declaration and realpath escapes are rejected.
Every invoked command, exit status, environment, log and input/output file hash is
retained under the primary checker's chosen owner `build/` directory.

The application publishes TypeScript/TSX source. This fixture makes no Node import
compatibility claim. It does not mount the application or run a server, browser,
GPU, benchmark, native build or network provider. Real browser rendering, owner
implementation behavior, application lifecycle tests, shared attribution
conformance, bootstrap acceptance and remote admission remain separate gates.

Source preparation is unrun until the primary reviews it and executes it within
its coordinator-granted slot. The child writer does not execute this runner.

Required runner inputs (each digest is SHA256 of the exact supplied file):

```text
--archive PATH --archive-sha256 HEX --archive-bytes COUNT
--package-manifest PATH --package-manifest-sha256 HEX
--lockfile PATH --lockfile-sha256 HEX
--runtime-pins PATH --runtime-pins-sha256 HEX
--output-root OWNER_BUILD_NEW_RUN_DIRECTORY [--cache ROOT_CONTROLLED_CACHE]
```

Runtime pins have `schemaVersion: 1` and `packages` rows containing `name`,
`version`, `archive`, `sha256` and `bytes`. Pin the app and every provider runtime
archive. Babylon/React external archives may be included when available; their
exact versions and physical identity are always checked against the sealed lock
and installed file map. Relative pin archive paths resolve beside the pin JSON.

The manifest must exactly match the consumer lock's root dependency sections.
File dependencies must be actual tar archives with lock integrity, never source
directories. Absolute archive paths are private fixture inputs. Relative locked
archive paths resolve beside the supplied lock and are copied byte-for-byte into
the corresponding fresh workspace path; paths escaping that workspace are
rejected. Registry artifacts in the supplied cache remain pinned by lock
integrity and npm's offline install. The cache cannot replace runtime archive
pins. The runner does not download or fabricate an archive URL.
