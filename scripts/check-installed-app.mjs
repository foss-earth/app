/** Actual source-aware installed consumer; run only under the primary's granted slot. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync,
  readdirSync, readlinkSync, realpathSync, symlinkSync, writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const owner = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = path.join(owner, "fixtures", "public-app-consumer");
const routes = [".", "./runtime", "./shell", "./input", "./input-mode.css", "./immersive", "./immersive.css", "./shell.css", "./windowing", "./windowing.css", "./layers", "./lights", "./cameraMath", "./diagnostics", "./heights", "./diagnosticDrawing", "./mapDetailPolicy", "./perf", "./scenes", "./scenes/schema.json", "./settings", "./sky", "./weather", "./smoothElevation", "./style.css", "./vite"];
const runtimeVersions = {
  "foss-earth": "0.1.0",
  ...Object.fromEntries(["ui", "renderer", "engine", "toolbar", "about", "dev", "sky", "weather", "images", "rectangle-image", "image-viewer", "scenes", "sphere-cubemap", "sphere-equirectangular", "sphere-tiled-cubemap", "preview-sheets"].map(name => [`@foss-earth/${name}`, "0.1.0"])),
  "@felipegalind0/gamepad-tools": "0.1.0", "@babylonjs/core": "8.56.2", "@babylonjs/loaders": "8.56.2",
  "3d-tiles-renderer": "0.4.24", "react": "19.2.6", "react-dom": "19.2.6",
};
const requiredTools = { typescript: "5.9.3" };
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const fingerprint = file => { const bytes = readFileSync(file); return { bytes: bytes.length, sha256: digest(bytes) }; };
const inside = (root, candidate) => candidate === root || candidate.startsWith(root + path.sep);
const parse = argv => {
  const result = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]; assert.ok(arg.startsWith("--"), "Use --name=value or --name value");
    const at = arg.indexOf("="), key = at < 0 ? arg.slice(2) : arg.slice(2, at);
    const value = at < 0 ? argv[++index] : arg.slice(at + 1);
    assert.ok(value && !value.startsWith("--") && result[key] === undefined, `Missing or duplicate --${key}`);
    result[key] = value;
  }
  return result;
};
const args = parse(process.argv.slice(2));
const allowed = ["archive", "archive-sha256", "archive-bytes", "lockfile", "lockfile-sha256", "package-manifest", "package-manifest-sha256", "runtime-pins", "runtime-pins-sha256", "output-root", "cache"];
for (const key of Object.keys(args)) assert.ok(allowed.includes(key), `Unknown input --${key}`);
for (const key of allowed.filter(key => key !== "cache")) assert.ok(args[key], `Supply --${key}`);
const input = (key, size) => {
  const file = realpathSync(path.resolve(args[key])), bytes = readFileSync(file), expected = args[`${key}-sha256`];
  assert.match(expected, /^[a-f0-9]{64}$/, `Invalid ${key} digest`);
  assert.equal(digest(bytes), expected, `INPUT_DIGEST_MISMATCH: ${key}`);
  if (size !== undefined) assert.equal(bytes.length, size, `INPUT_SIZE_MISMATCH: ${key}`);
  return { path: file, bytes: bytes.length, sha256: expected, data: bytes };
};
const archiveSize = Number(args["archive-bytes"]); assert.ok(Number.isSafeInteger(archiveSize) && archiveSize > 0);
const appArchive = input("archive", archiveSize), lockInput = input("lockfile"), manifestInput = input("package-manifest"), pinsInput = input("runtime-pins");
const lock = JSON.parse(lockInput.data), manifest = JSON.parse(manifestInput.data), pins = JSON.parse(pinsInput.data);
assert.ok(lock.lockfileVersion >= 2 && lock.packages?.[""], "Supply a sealed npm consumer lock with package-path records");
assert.equal(manifest.private, true, "Consumer manifest must be private"); assert.equal(manifest.type, "module");
assert.equal(lock.packages[""].name ?? lock.name, manifest.name); assert.equal(lock.packages[""].version ?? lock.version, manifest.version);
for (const key of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
  assert.deepEqual(lock.packages[""][key] ?? {}, manifest[key] ?? {}, `MANIFEST_LOCK_MISMATCH: ${key}`);
}
assert.equal(pins.schemaVersion, 1); assert.ok(Array.isArray(pins.packages));
const output = path.resolve(args["output-root"]), buildRoot = realpathSync(path.join(owner, "build"));
assert.ok(inside(path.join(owner, "build"), output) && output !== path.join(owner, "build"), "Evidence must stay under owner build/");
mkdirSync(output, { recursive: true }); assert.ok(inside(buildRoot, realpathSync(output)), "Evidence parent escaped owner build/");
const workspace = path.join(output, "workspace"), logs = path.join(output, "logs"), temp = path.join(output, "temp");
mkdirSync(workspace); mkdirSync(logs); mkdirSync(temp); // never overwrite a previous consumer
const workspaceReal = realpathSync(workspace), userConfig = path.join(output, "empty.npmrc"); writeFileSync(userConfig, "");
const cache = args.cache ? realpathSync(path.resolve(args.cache)) : path.join(output, "npm-cache");
if (!existsSync(cache)) mkdirSync(cache);
const environment = {
  PATH: process.env.PATH ?? "", LANG: "C", LC_ALL: "C", TZ: "UTC",
  ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
  ...(process.env.SYSTEMROOT ? { SYSTEMROOT: process.env.SYSTEMROOT } : {}),
  TMPDIR: temp, TMP: temp, TEMP: temp,
  npm_config_cache: cache, npm_config_userconfig: userConfig,
  npm_config_ignore_scripts: "true", npm_config_audit: "false", npm_config_fund: "false",
};
const receipt = {
  schemaVersion: 1, status: "running", startedAt: new Date().toISOString(),
  runtime: { node: process.version, platform: process.platform, arch: process.arch },
  inputs: Object.fromEntries(Object.entries({ appArchive, lockfile: lockInput, packageManifest: manifestInput, runtimePins: pinsInput }).map(([key, value]) => [key, { path: value.path, bytes: value.bytes, sha256: value.sha256 }])),
  environment, cachePolicy: args.cache ? "Explicit root-controlled cache; offline only. Cache is not dependency identity." : "Fresh private cache; offline only.",
  source: [], commands: [], checks: [], limitations: [
    "Strict Bundler TypeScript and Vite build proof, not Node import compatibility; the app publishes TS/TSX source.",
    "Static application assembly only; no application mount, renderer initialization, server, browser, GPU, network provider, benchmark, WASM or media build.",
    "Owner implementation behavior, app lifecycle tests, common conformance, bootstrap acceptance, full publication-ref audit and actual remote admission are separate required gates.",
  ],
};
const writeReceipt = () => writeFileSync(path.join(output, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
writeReceipt();
function run(command, argv, name, expected = 0) {
  const file = path.join(logs, name), fd = openSync(file, "wx"), start = new Date().toISOString();
  let result;
  try { result = spawnSync(command, argv, { cwd: workspace, env: environment, stdio: ["ignore", fd, fd] }); }
  finally { closeSync(fd); }
  const record = { command, argv, cwd: workspace, environmentSha256: digest(Buffer.from(JSON.stringify(environment))), startedAt: start,
    finishedAt: new Date().toISOString(), exitCode: result?.status ?? null, signal: result?.signal ?? null, log: path.relative(output, file), ...fingerprint(file) };
  receipt.commands.push(record); writeReceipt();
  if (result?.error) throw result.error;
  if (expected === "nonzero") assert.ok(result.status !== 0 && result.status !== null, `Negative control unexpectedly passed: ${file}`);
  else assert.equal(result.status, expected, `Inspect ${file}`);
  return readFileSync(file, "utf8");
}
function protectedFile(file, label) {
  const resolved = realpathSync(file); assert.ok(inside(workspaceReal, resolved), `OUTSIDE_ISOLATED_${label}: ${file}`); return resolved;
}
function tree(directory) {
  const records = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(directory, entry.name), relative = path.relative(workspace, file);
    if (entry.isSymbolicLink()) {
      protectedFile(file, "REALPATH"); records.push({ path: relative, link: readlinkSync(file) });
    } else if (entry.isDirectory()) records.push(...tree(file));
    else if (entry.isFile()) records.push({ path: relative, ...fingerprint(file) });
    else throw new Error(`Unsupported installed entry: ${file}`);
  }
  return records;
}
function installedPackages(modules) {
  const results = [];
  for (const entry of readdirSync(modules, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const directory = path.join(modules, entry.name);
    if (entry.name.startsWith("@")) { results.push(...installedPackages(directory)); continue; }
    const physical = protectedFile(directory, "PACKAGE"), metadata = JSON.parse(readFileSync(path.join(physical, "package.json")));
    const relative = path.relative(workspace, directory).split(path.sep).join("/"), locked = lock.packages[relative];
    assert.ok(locked, `UNLOCKED_INSTALLED_PACKAGE: ${relative}`); assert.equal(metadata.version, locked.version, `LOCK_VERSION_MISMATCH: ${relative}`);
    assert.equal(locked.link ?? false, false, `Source link in exact consumer: ${relative}`);
    results.push({ name: metadata.name, version: metadata.version, path: relative, realpath: path.relative(workspace, physical), lockIntegrity: locked.integrity ?? null, resolved: locked.resolved ?? null });
    const nested = path.join(physical, "node_modules"); if (existsSync(nested)) results.push(...installedPackages(nested));
  }
  return results;
}
function locatePackage(name, importerDirectory) {
  let at = importerDirectory;
  while (inside(workspaceReal, at)) {
    const candidate = path.join(at, "node_modules", ...name.split("/"), "package.json");
    if (existsSync(candidate)) return path.dirname(protectedFile(candidate, "RUNTIME"));
    if (at === workspaceReal) break; at = path.dirname(at);
  }
  throw new Error(`RUNTIME_RESOLUTION_MISSING: ${name} from ${importerDirectory}`);
}
function declarationProof(trace) {
  const resolved = [...trace.matchAll(/successfully resolved to '([^']+)'/g)].map(match => match[1]);
  assert.ok(resolved.length, "Compiler trace has no successful resolutions");
  for (const file of resolved) protectedFile(file, "DECLARATIONS");
  return [...new Set(resolved.map(file => path.relative(workspace, realpathSync(file))))].sort();
}
function outputProof(directory) {
  return tree(directory).map(record => ({ ...record, path: path.relative(workspace, path.join(workspace, record.path)) }));
}
try {
  for (const [key, value] of Object.entries({ "input-package.json": manifestInput, "input-package-lock.json": lockInput, "runtime-pins.json": pinsInput })) copyFileSync(value.path, path.join(output, key));
  copyFileSync(manifestInput.path, path.join(workspace, "package.json")); copyFileSync(lockInput.path, path.join(workspace, "package-lock.json"));
  for (const name of readdirSync(fixtureRoot).sort()) {
    const file = path.join(fixtureRoot, name); assert.ok(lstatSync(file).isFile(), "Fixture inputs must be regular files");
    receipt.source.push({ path: path.relative(owner, file), ...fingerprint(file) }); copyFileSync(file, path.join(workspace, name));
  }
  receipt.source.push({ path: "scripts/check-installed-app.mjs", ...fingerprint(fileURLToPath(import.meta.url)) });
  const verifiedPins = new Map();
  for (const [index, pin] of pins.packages.entries()) {
    assert.ok(pin.name && pin.version && pin.archive && /^[a-f0-9]{64}$/.test(pin.sha256 ?? "") && Number.isSafeInteger(pin.bytes) && pin.bytes > 0);
    assert.equal(verifiedPins.has(pin.name), false, `Duplicate runtime pin: ${pin.name}`);
    const archive = realpathSync(path.resolve(path.dirname(pinsInput.path), pin.archive));
    assert.deepEqual(fingerprint(archive), { bytes: pin.bytes, sha256: pin.sha256 }, `RUNTIME_ARCHIVE_MISMATCH: ${pin.name}`);
    const metadata = JSON.parse(run("tar", ["-xOf", archive, "package/package.json"], `pin-${index}-package.log`));
    assert.equal(metadata.name, pin.name); assert.equal(metadata.version, pin.version);
    verifiedPins.set(pin.name, { ...pin, archive });
  }
  for (const [name, version] of Object.entries(runtimeVersions)) {
    if (name === "foss-earth" || name.startsWith("@foss-earth/") || name.startsWith("@felipegalind0/")) assert.ok(verifiedPins.has(name), `Missing exact runtime archive pin: ${name}`);
    if (verifiedPins.has(name)) assert.equal(verifiedPins.get(name).version, version);
  }
  assert.equal(verifiedPins.get("foss-earth").archive, appArchive.path); assert.equal(verifiedPins.get("foss-earth").sha256, appArchive.sha256);
  // Preserve the sealed lock byte-for-byte. Materialize its reviewed local tar
  // paths inside the new consumer without substituting directory/source links.
  receipt.localArchiveInputs = [];
  for (const [location, entry] of Object.entries(lock.packages)) {
    if (!location || !entry.resolved?.startsWith("file:")) continue;
    const raw = entry.resolved.slice(5);
    const destination = path.isAbsolute(raw) ? raw : path.resolve(workspace, raw);
    if (!path.isAbsolute(raw)) {
      assert.ok(inside(workspaceReal, destination), `LOCAL_ARCHIVE_PATH_ESCAPE: ${entry.resolved}`);
      const original = path.resolve(path.dirname(lockInput.path), raw);
      assert.ok(lstatSync(original).isFile(), `Exact consumer cannot install a source directory: ${original}`);
      mkdirSync(path.dirname(destination), { recursive: true });
      assert.ok(inside(workspaceReal, realpathSync(path.dirname(destination))), "Local archive parent escaped workspace");
      copyFileSync(original, destination);
    }
    const actual = realpathSync(destination), bytes = readFileSync(actual);
    assert.ok(lstatSync(actual).isFile() && /\.(?:tgz|tar\.gz)$/.test(actual), `Exact consumer requires tar archives: ${actual}`);
    assert.ok(entry.integrity, `Unsealed local archive integrity: ${location}`);
    const integrities = entry.integrity.split(/\s+/);
    assert.ok(integrities.some(value => {
      const at = value.indexOf("-"), algorithm = value.slice(0, at), expected = value.slice(at + 1);
      return ["sha256", "sha384", "sha512"].includes(algorithm) && createHash(algorithm).update(bytes).digest("base64") === expected;
    }), `LOCAL_ARCHIVE_INTEGRITY_MISMATCH: ${location}`);
    const segments = location.split("/node_modules/").at(-1).replace(/^node_modules\//, "");
    const runtimePin = verifiedPins.get(segments);
    if (runtimePin) assert.deepEqual({ bytes: bytes.length, sha256: digest(bytes) }, { bytes: runtimePin.bytes, sha256: runtimePin.sha256 }, `LOCK_RUNTIME_ARCHIVE_MISMATCH: ${segments}`);
    receipt.localArchiveInputs.push({ location, archive: actual, bytes: bytes.length, sha256: digest(bytes), integrity: entry.integrity });
  }
  const listed = run("tar", ["-tzf", appArchive.path], "app-archive-paths.log").trim().split("\n");
  for (const member of listed) {
    assert.ok(member.startsWith("package/") && !member.split("/").includes("..") && !member.includes("\\"), `UNSAFE_APP_ARCHIVE_PATH: ${member}`);
  }
  const verbose = run("tar", ["-tvzf", appArchive.path], "app-archive-metadata.log");
  for (const line of verbose.trim().split("\n")) assert.ok(line.startsWith("-") || line.startsWith("d"), "App archive may contain only regular files/directories");
  const reference = path.join(output, "reference-app"); mkdirSync(reference);
  run("tar", ["-xzf", appArchive.path, "-C", reference], "app-archive-extract.log");
  const archivedManifest = JSON.parse(readFileSync(path.join(reference, "package", "package.json")));
  assert.equal(archivedManifest.name, "foss-earth"); assert.equal(archivedManifest.version, "0.1.0");
  assert.deepEqual(Object.keys(archivedManifest.exports).sort(), [...routes].sort(), "Public app route set changed; review consumer fixture");
  for (const route of routes) assert.equal(typeof archivedManifest.exports[route], "string", `Review non-source route ${route}`);
  assert.ok(existsSync(path.join(reference, "package", "vite", "appFilesWorker.js")), "Packed Vite worker is missing");
  run("npm", ["ci", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--cache", cache], "install.log");
  assert.deepEqual(fingerprint(path.join(workspace, "package-lock.json")), { bytes: lockInput.bytes, sha256: lockInput.sha256 }, "npm changed the sealed consumer lock");
  receipt.installed = installedPackages(path.join(workspace, "node_modules"));
  const installedLocations = new Set(receipt.installed.map(entry => entry.path));
  receipt.uninstalledLockPackages = Object.entries(lock.packages).filter(([location]) => location && !installedLocations.has(location)).map(([location, entry]) => ({ path: location, version: entry.version, optional: entry.optional ?? false, os: entry.os ?? null, cpu: entry.cpu ?? null }));
  const before = tree(path.join(workspace, "node_modules"));
  writeFileSync(path.join(output, "installed-file-map.json"), JSON.stringify(before, null, 2) + "\n");
  receipt.installedFileMap = fingerprint(path.join(output, "installed-file-map.json"));
  receipt.runtimePackages = [];
  const runtimeDirectories = new Map();
  for (const [name, version] of Object.entries(runtimeVersions)) {
    const directory = locatePackage(name, workspaceReal), metadata = JSON.parse(readFileSync(path.join(directory, "package.json")));
    assert.equal(metadata.name, name); assert.equal(metadata.version, version, `RUNTIME_VERSION_MISMATCH: ${name}`);
    const location = path.relative(workspace, directory).split(path.sep).join("/");
    if (verifiedPins.has(name)) assert.ok(lock.packages[location]?.resolved?.startsWith("file:"), `Runtime archive pin requires actual file archive adoption: ${name}`);
    runtimeDirectories.set(name, directory); receipt.runtimePackages.push({ name, version, path: path.relative(workspace, directory), ...(verifiedPins.has(name) ? { archiveSha256: verifiedPins.get(name).sha256, archiveBytes: verifiedPins.get(name).bytes } : { archiveSha256: null, identity: "sealed lock plus installed file map; external archive unavailable" }) });
  }
  for (const [name, directory] of runtimeDirectories) {
    const metadata = JSON.parse(readFileSync(path.join(directory, "package.json")));
    for (const dependency of new Set([...Object.keys(metadata.dependencies ?? {}), ...Object.keys(metadata.peerDependencies ?? {}), ...Object.keys(metadata.optionalDependencies ?? {})])) {
      if (!runtimeDirectories.has(dependency)) continue;
      assert.equal(locatePackage(dependency, directory), runtimeDirectories.get(dependency), `SECOND_PHYSICAL_RUNTIME: ${name} -> ${dependency}`);
    }
  }
  const appDirectory = runtimeDirectories.get("foss-earth");
  const appMap = [];
  function compareApp(directory, relative = "") {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const name = path.join(relative, entry.name), file = path.join(directory, entry.name);
      if (entry.isDirectory()) compareApp(file, name);
      else {
        assert.ok(entry.isFile(), "Sealed app reference contains an unsupported entry");
        const installed = path.join(appDirectory, name); protectedFile(installed, "APP_BYTES");
        assert.deepEqual(fingerprint(installed), fingerprint(file), `INSTALLED_APP_BYTE_MISMATCH: ${name}`);
        appMap.push({ path: name.split(path.sep).join("/"), ...fingerprint(file) });
      }
    }
  }
  compareApp(path.join(reference, "package")); receipt.appFiles = appMap.sort((a, b) => a.path.localeCompare(b.path));
  receipt.toolPackages = receipt.installed.filter(entry => ![...runtimeDirectories.values()].some(directory => path.relative(workspace, directory).split(path.sep).join("/") === entry.path));
  for (const [name, version] of Object.entries(requiredTools)) assert.equal(JSON.parse(readFileSync(path.join(locatePackage(name, workspaceReal), "package.json"))).version, version);
  const compiler = path.join(locatePackage("typescript", workspaceReal), "bin", "tsc");
  const trace = run(process.execPath, [compiler, "-p", "tsconfig.json", "--traceResolution"], "strict-types.log");
  receipt.declarationFiles = declarationProof(trace);
  const typeRoutes = routes.filter(route => !route.endsWith(".css"));
  for (const route of typeRoutes) {
    const name = route === "." ? "foss-earth" : `foss-earth/${route.slice(2)}`;
    const expression = new RegExp(`Module name '${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}' was successfully resolved to '([^']+)'`);
    const match = trace.match(expression); assert.ok(match, `PUBLIC_TYPE_ROUTE_NOT_RESOLVED: ${name}`);
    assert.ok(inside(appDirectory, protectedFile(match[1], "PUBLIC_ROUTE")), `Public type route bypassed sealed app: ${name}`);
  }
  writeFileSync(path.join(output, "outside.d.ts"), "export interface Outside { value: string }\n");
  writeFileSync(path.join(workspace, "negative-outside.ts"), 'import type { Outside } from "../outside.js"; export const value: Outside = { value: "negative control" };\n');
  writeFileSync(path.join(workspace, "tsconfig.negative-outside.json"), JSON.stringify({ compilerOptions: { target: "ES2023", module: "ESNext", moduleResolution: "Bundler", strict: true, noEmit: true, types: [] }, files: ["negative-outside.ts"] }));
  const negativeTrace = run(process.execPath, [compiler, "-p", "tsconfig.negative-outside.json", "--traceResolution"], "negative-outside-types.log");
  assert.throws(() => declarationProof(negativeTrace), /OUTSIDE_ISOLATED_DECLARATIONS/);
  symlinkSync(path.join(output, "outside.d.ts"), path.join(workspace, "negative-symlink.d.ts"));
  assert.throws(() => protectedFile(path.join(workspace, "negative-symlink.d.ts"), "REALPATH"), /OUTSIDE_ISOLATED_REALPATH/);
  writeFileSync(path.join(workspace, "negative-private.ts"), 'import { createGlobeApp } from "foss-earth/src/app/createGlobeApp"; void createGlobeApp;\n');
  writeFileSync(path.join(workspace, "tsconfig.negative-private.json"), JSON.stringify({ compilerOptions: { target: "ES2023", module: "ESNext", moduleResolution: "Bundler", noEmit: true, types: [] }, files: ["negative-private.ts"] }));
  const privateTrace = run(process.execPath, [compiler, "-p", "tsconfig.negative-private.json", "--traceResolution"], "negative-private-types.log", "nonzero");
  assert.match(privateTrace, /error TS2307: Cannot find module 'foss-earth\/src\/app\/createGlobeApp'/);
  receipt.negativeControls = ["actual outside declaration import rejected by realpath guard", "actual symlink escape rejected by realpath guard", "private package source import rejected by export-aware Bundler compiler"];
  const vite = path.join(locatePackage("vite", workspaceReal), "bin", "vite.js");
  run(process.execPath, [vite, "build", "--config", "vite.config.ts", "--configLoader", "runner"], "vite-build.log");
  const distribution = path.join(workspace, "dist"), html = readFileSync(path.join(distribution, "index.html"), "utf8"), worker = readFileSync(path.join(distribution, "foss-earth-sw.js"), "utf8");
  assert.ok(worker.includes(readFileSync(path.join(appDirectory, "vite", "appFilesWorker.js"), "utf8")), "Generated worker did not use packed worker bytes");
  assert.match(html, /id="foss-earth-built-from"/); assert.match(html, /foss-earth-build/);
  const proof = JSON.parse(readFileSync(path.join(distribution, "public-resolution-proof.json")));
  for (const name of ["foss-earth-app-files", "foss-earth-built-from", "foss-earth-babylon-shader-chunks"]) assert.ok(proof.plugins.includes(name), `Missing actual Vite plugin: ${name}`);
  for (const name of ["babylon-shaders-glsl", "babylon-shaders-wgsl"]) assert.ok(proof.groups.includes(name), `Missing actual shader chunk group: ${name}`);
  const builtFiles = new Set(proof.modules.filter(entry => entry.file).map(entry => realpathSync(path.join(workspace, entry.file))));
  for (const route of routes.filter(route => route !== "./vite")) {
    const target = realpathSync(path.join(appDirectory, archivedManifest.exports[route]));
    assert.ok(builtFiles.has(target), `PUBLIC_BUILD_ROUTE_NOT_CONSUMED: ${route}`);
  }
  for (const file of builtFiles) {
    protectedFile(file, "BUILD");
    for (const [name, canonical] of runtimeDirectories) {
      const marker = `${path.sep}node_modules${path.sep}${name.split("/").join(path.sep)}${path.sep}`;
      const at = file.lastIndexOf(marker); if (at < 0) continue;
      assert.equal(realpathSync(file.slice(0, at + marker.length - 1)), canonical, `BUILT_SECOND_PHYSICAL_RUNTIME: ${name}`);
    }
  }
  receipt.buildProof = proof; receipt.outputFiles = outputProof(distribution);
  receipt.checks = ["All sealed input digests/bytes and runtime archive package identities", "Fresh offline scripts-disabled npm ci with unchanged sealed consumer lock", "Every installed package version/path matched consumer lock; full installed file map retained", "Every packed app file matched actual installed bytes", "Runtime/provider dependency edges and built modules converged on one physical package inside workspace", "Strict export-aware Bundler TypeScript consumed all 21 non-CSS public routes", "Declaration/realpath/private-export negative controls", "Actual Vite build consumed all 26 routes/five CSS routes and three plugins; packed service-worker bytes emitted"];
  receipt.status = "passed";
} catch (error) {
  receipt.status = "failed"; receipt.failure = { name: error?.name ?? "Error", message: error?.message ?? String(error), stack: error?.stack ?? null };
  process.exitCode = 1;
} finally {
  receipt.finishedAt = new Date().toISOString(); writeReceipt();
  process.stdout.write(JSON.stringify({ status: receipt.status, output, receipt: path.join(output, "receipt.json"), ...fingerprint(path.join(output, "receipt.json")) }) + "\n");
}
