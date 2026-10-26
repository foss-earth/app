#!/usr/bin/env node
// An interactive page for framing a scenario: the real FOSS Earth view, without
// its interface, beside controls for the time, the observer, the camera and the
// exposure. The view follows every change live. The page saves the result back
// to the scenario file and can run a capture of it.
// See docs/proposals/scene-screenshot-capture.md.
//
//   node scripts/capture-scenes/tune.mjs [scenario] [--set path=value]... [--app-dist DIR] [--port N] [--no-open]
//
// --set starts the page from the scenario with these overrides, as the capture takes them: the
// command the page shows opens it again where it was left.
// It serves the build and the page on this machine only (127.0.0.1) until stopped with Ctrl-C.
import { spawn } from "node:child_process";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { readGoogleKey } from "@foss-earth/engine/prepare-heights";
import { resolveBuild } from "./lib/build.mjs";
import { loadScenario, loadScenarioSource, scenarioPath } from "./lib/scenario.mjs";
import { sendFile, serveBuild } from "./lib/server.mjs";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(SCRIPT_DIRECTORY, "../..");
const WORK = path.join(APP_ROOT, "build", "capture-scenes");
const SCENARIOS = path.join(SCRIPT_DIRECTORY, "scenarios");
const TUNE_WORK = path.join(WORK, "tune");
const KEY_FILES = [path.join(APP_ROOT, ".env.local"), path.join(homedir(), "gh/UMN-VR/tour/.env.local"), path.join(homedir(), "gh/0sfs/fly/.env.local")];
/** The parts of a scenario the page edits; everything else in the file is left as it is. */
const EDITABLE = ["time", "reference", "observer", "camera", "image", "settings"];

let parsed;
try {
  parsed = parseArgs({ allowPositionals: true, options: {
    "app-dist": { type: "string" }, set: { type: "string", multiple: true, default: [] }, port: { type: "string", default: "4180" }, "no-open": { type: "boolean", default: false }, help: { type: "boolean", short: "h" },
  } });
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
const { values: options, positionals } = parsed;
if (options.help) {
  console.log("Usage: node scripts/capture-scenes/tune.mjs [scenario] [--set path=value]... [--app-dist DIR] [--port N] [--no-open]");
  process.exit(0);
}
const firstScenario = positionals[0] ?? "sky-sunset-orbit";
try {
  await loadScenario(scenarioPath(firstScenario, SCENARIOS), options.set);
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
// Ports browsers refuse to open (the Fetch standard's "bad ports"), such as 4190 for mail filters.
const BLOCKED_PORTS = new Set([1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080]);
if (BLOCKED_PORTS.has(Number(options.port))) {
  console.error(`Browsers refuse port ${options.port}; choose another with --port.`);
  process.exit(2);
}

const { key, origin: keyOrigin } = readGoogleKey({ files: KEY_FILES });
if (!key) {
  console.error(`Google 3D Tiles need a key: set GOOGLE_3D_TILES_KEY or add it to one of ${KEY_FILES.join(", ")}.`);
  process.exit(1);
}
console.log(`Google key: found (${keyOrigin === "environment" ? "environment" : path.relative(process.cwd(), keyOrigin)}); not printed.`);
const build = await resolveBuild({
  appRoot: APP_ROOT, ownDist: path.join(WORK, "app-dist"), explicitDist: options["app-dist"] && path.resolve(options["app-dist"]),
  rebuild: false, buildLog: path.join(WORK, "app-dist.build.log"), onChild: () => {}, log: console.log,
});
console.log(`Build: ${path.relative(process.cwd(), build.directory)} (${build.how}), built ${build.provenance.built ?? "at an unknown time"}`);

const json = (response, status, body) => {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" });
  response.end(JSON.stringify(body));
};
async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
}
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");

/** Each leaf that differs between two values, as [path, new value]; a removed field is null. */
function changes(before, after, at = []) {
  if (isObject(before) && isObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...keys].flatMap(key => changes(before[key], after[key], [...at, key]));
  }
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  return [[at, after === undefined ? null : after]];
}
function setAt(target, at, value) {
  let node = target;
  for (const part of at.slice(0, -1)) {
    if (!isObject(node[part])) node[part] = {};
    node = node[part];
  }
  node[at.at(-1)] = value;
}
/** Only the fields the page edits, from a scenario as sent or loaded. */
function editable(scenario) {
  const out = structuredClone(Object.fromEntries(EDITABLE.map(part => [part, scenario[part] ?? {}])));
  delete out.time.utcMs;
  // What the check works out from the crop, and no crop, are not written.
  delete out.image.render; delete out.image.cropPx;
  if (out.image.crop == null) delete out.image.crop;
  return out;
}
function checkName(name) {
  if (typeof name !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error("A scenario name is lower-case letters, digits and hyphens");
  return name;
}

/** A scenario as the page starts from it: with the command line's overrides, for the scenario it named. */
async function state(name) {
  const file = scenarioPath(checkName(name), SCENARIOS);
  const fileScenario = await loadScenario(file);
  const scenario = name === firstScenario && options.set.length ? await loadScenario(file, options.set) : fileScenario;
  const names = (await readdir(SCENARIOS)).filter(entry => entry.endsWith(".json")).map(entry => entry.slice(0, -5)).sort();
  return { name, file, fileScenario, scenario, names, appParameters: { key } };
}

/** Writes the page's changes into the scenario's own file, keeping a backup; a result that does not load is undone. */
async function save(name, edited) {
  const file = scenarioPath(checkName(name), SCENARIOS);
  const original = await readFile(file, "utf8");
  const raw = JSON.parse(original);
  const merged = await loadScenarioSource(file);
  const list = changes(editable(merged), editable(edited));
  if (!list.length) return { file, backup: null, changed: [] };
  for (const [at, value] of list) setAt(raw, at, value);
  await mkdir(path.join(TUNE_WORK, "backups"), { recursive: true });
  const backup = path.join(TUNE_WORK, "backups", `${name}-${stamp()}.json`);
  await copyFile(file, backup);
  await writeFile(file, JSON.stringify(raw, null, 2) + "\n");
  try {
    await loadScenario(file);
  } catch (error) {
    await writeFile(file, original);
    throw new Error(`Not saved: ${error.message}`);
  }
  return { file, backup, changed: list.map(([at, value]) => `${at.join(".")} = ${JSON.stringify(value)}`) };
}

/** A new scenario that extends the one tuned, with only what changed. */
async function saveAs(name, newName, edited) {
  const file = scenarioPath(checkName(name), SCENARIOS);
  const target = scenarioPath(checkName(newName), SCENARIOS);
  if (await readFile(target).then(() => true, () => false)) throw new Error(`${newName}.json exists already; choose another name or save over it from its own page`);
  const merged = await loadScenarioSource(file);
  const raw = { $comment: `Tuned from ${name} on ${new Date().toISOString().slice(0, 10)}. Not published: add a publish block to publish it.`, extends: path.basename(file), name: newName };
  for (const [at, value] of changes(editable(merged), editable(edited))) setAt(raw, at, value);
  await writeFile(target, JSON.stringify(raw, null, 2) + "\n");
  try {
    await loadScenario(target);
  } catch (error) {
    await rm(target, { force: true });
    throw new Error(`Not saved: ${error.message}`);
  }
  return { file: target };
}

/** Runs the capture on the page's current state, written to a scratch scenario beside the runs. */
let capturing = null;
async function capture(name, edited, publish) {
  if (capturing) throw new Error("A capture is already running");
  const file = scenarioPath(checkName(name), SCENARIOS);
  const merged = await loadScenarioSource(file);
  for (const [at, value] of changes(editable(merged), editable(edited))) setAt(merged, at, value);
  // Publish paths are relative to the scenario's own directory.
  if (merged.publish) for (const kind of Object.keys(merged.publish)) {
    const value = merged.publish[kind];
    if (typeof value === "string" && !value.startsWith("~/") && !path.isAbsolute(value)) merged.publish[kind] = path.resolve(SCENARIOS, value);
  }
  await mkdir(path.join(TUNE_WORK, "scenarios"), { recursive: true });
  const scratch = path.join(TUNE_WORK, "scenarios", `${name}.json`);
  await writeFile(scratch, JSON.stringify(merged, null, 2) + "\n");
  const runRoot = path.join(TUNE_WORK, "runs");
  const args = [path.join(SCRIPT_DIRECTORY, "capture.mjs"), scratch, "--app-dist", build.directory, "--out", runRoot, ...(publish ? ["--publish"] : [])];
  capturing = new Promise(resolve => {
    const child = spawn(process.execPath, args, { cwd: APP_ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    const keep = chunk => { log += chunk; process.stdout.write(chunk); };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    child.on("close", code => resolve({ code, log }));
  });
  try {
    const { code, log } = await capturing;
    if (code !== 0) return { ok: false, log };
    const run = (await readFile(path.join(runRoot, name, "latest.txt"), "utf8")).trim();
    const directory = path.join(runRoot, name, run);
    return { ok: true, log, directory, picture: path.join(directory, "final-decoded.png"), url: `/tune/runs/${name}/${run}/final-decoded.png` };
  } finally {
    capturing = null;
  }
}

async function handle(url, request, response) {
  const route = url.pathname;
  if (route === "/") { response.writeHead(302, { location: `/tune/?scenario=${encodeURIComponent(firstScenario)}` }).end(); return true; }
  if (!route.startsWith("/tune/")) return false;
  try {
    if (route === "/tune/" || route === "/tune/index.html") { await sendFile(request, response, path.join(SCRIPT_DIRECTORY, "tune", "index.html")); return true; }
    if (route === "/tune/tune.mjs") { await sendFile(request, response, path.join(SCRIPT_DIRECTORY, "tune", "tune.mjs")); return true; }
    const library = route.match(/^\/tune\/lib\/(geo|plan|page)\.mjs$/);
    if (library) { await sendFile(request, response, path.join(SCRIPT_DIRECTORY, "lib", `${library[1]}.mjs`)); return true; }
    const picture = route.match(/^\/tune\/runs\/([a-z0-9-]+)\/(\d{8}T\d{6}Z)\/(final-decoded\.png|final\.webp|original\.png)$/);
    if (picture) { await sendFile(request, response, path.join(TUNE_WORK, "runs", picture[1], picture[2], picture[3])); return true; }
    if (route === "/tune/state") { json(response, 200, await state(url.searchParams.get("scenario") ?? firstScenario)); return true; }
    if (request.method === "POST") {
      const body = await readBody(request);
      if (route === "/tune/save") { json(response, 200, await save(body.name, body.scenario)); return true; }
      if (route === "/tune/save-as") { json(response, 200, await saveAs(body.name, body.newName, body.scenario)); return true; }
      if (route === "/tune/capture") { json(response, 200, await capture(body.name, body.scenario, body.publish === true)); return true; }
    }
    response.writeHead(404).end();
  } catch (error) {
    json(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
  return true;
}

let server;
try {
  server = await serveBuild(build.directory, { port: Number(options.port), handle });
} catch (error) {
  if (error?.code !== "EADDRINUSE") throw error;
  server = await serveBuild(build.directory, { port: 0, handle });
}
const address = `${server.origin}/tune/?scenario=${encodeURIComponent(firstScenario)}`;
console.log(`Tuner: ${address}\nStop with Ctrl-C.`);
if (!options["no-open"] && process.platform === "darwin") spawn("open", [address], { stdio: "ignore", detached: true }).unref();
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    if (capturing) console.log("Waiting for the capture to finish...");
    await capturing;
    await server.close();
    process.exit(0);
  });
}
