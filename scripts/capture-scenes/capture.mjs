#!/usr/bin/env node
// Pictures of FOSS Earth scenes without the interface: the real globe, sky
// and map at a set place, camera and time, with the map's attribution kept.
// See docs/proposals/scene-screenshot-capture.md.
//
//   node scripts/capture-scenes/capture.mjs <scenario>... [--set path=value]... [--publish] [--bracket=STOPS,...]
//        [--rebuild | --app-dist DIR] [--out DIR] [--port N] [--timeout SEC] [--no-cache] [--dry-run]
//
// A scenario is a JSON file, or the name of one in scripts/capture-scenes/scenarios/.
// Each run writes original.png, final.webp, its decoded full-size preview,
// report.json and preview.html to build/capture-scenes/runs/<name>/<UTC time>/.
// --publish also copies the encoded pictures to the scenario's `publish` paths.
// --bracket also captures the same loaded view at other exposures, side by side in
// preview.html, for choosing one: each step is exposure compensation
// (renderer.exposureEV) in stops on top of the scenario's, + brighter, set live.
import { copyFile, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { openHeadlessPage } from "@foss-earth/browser-testing/page";
import { readGoogleKey } from "@foss-earth/engine/prepare-heights";
import { resolveBuild } from "./lib/build.mjs";
import { analyse, decodePng, decodeWebp, encodeJpeg, encodeWebp, measureSun } from "./lib/image.mjs";
import { hideInterface, hideSceneMeshes, inPage, placeCamera, probe, setSetting, settleFrames } from "./lib/page.mjs";
import { describeView, planCamera } from "./lib/plan.mjs";
import { assess, skyLagToleranceDeg, skyObserverArcDeg, skyObserverAt } from "./lib/readiness.mjs";
import { loadScenario, resolveDestination, scenarioPath } from "./lib/scenario.mjs";
import { serveBuild } from "./lib/server.mjs";

/** parseArgs, with its errors said plainly: a negative step needs `--bracket=-1,1`, as its message explains. */
function parseCommandLine(config) {
  try {
    return parseArgs(config);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(2);
  }
}

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(SCRIPT_DIRECTORY, "../..");
const WORK = path.join(APP_ROOT, "build", "capture-scenes");
// The documented lookup: the environment, then these ignored files. The key is never printed.
const KEY_FILES = [path.join(APP_ROOT, ".env.local"), path.join(homedir(), "gh/UMN-VR/tour/.env.local"), path.join(homedir(), "gh/0sfs/fly/.env.local")];

const { values: options, positionals } = parseCommandLine({
  allowPositionals: true,
  options: {
    set: { type: "string", multiple: true, default: [] },
    publish: { type: "boolean", default: false },
    bracket: { type: "string" },
    rebuild: { type: "boolean", default: false },
    "app-dist": { type: "string" },
    out: { type: "string" },
    port: { type: "string", default: "0" },
    timeout: { type: "string" },
    "no-cache": { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    help: { type: "boolean", short: "h" },
  },
});

if (options.help || positionals.length === 0) {
  console.log(`Usage: node scripts/capture-scenes/capture.mjs <scenario>... [--set path=value]... [--publish] [--bracket=STOPS,...]
       [--rebuild | --app-dist DIR] [--out DIR] [--port N] [--timeout SEC] [--no-cache] [--dry-run]

Scenarios: ${path.relative(process.cwd(), path.join(SCRIPT_DIRECTORY, "scenarios"))}/<name>.json or a path.
--set camera.verticalFovDeg=18   overrides a scenario field (settings.<id>=value for a parameter).
--set settings.sky.exposure.ev100=11
                                 a fixed exposure (EV at ISO 100; lower is brighter).
--set settings.renderer.exposureEV=1
                                 exposure compensation in stops, + brighter: on top of a fixed or metered exposure.
--bracket=-2,-1,1,2              also captures the same view at these compensations, in stops on top of the
                                 scenario's, side by side in preview.html. --publish still publishes the scenario's own.
--publish                        copies the encoded pictures to the scenario's publish paths.
--rebuild                        builds the app into build/capture-scenes/app-dist first.
--dry-run                        checks the scenarios and the build, without a browser.`);
  process.exit(options.help ? 0 : 2);
}

/** The exposure setting a bracket steps: compensation, which applies the same way to a fixed and a metered exposure. */
const COMPENSATION_ID = "renderer.exposureEV";
const COMPENSATION_LIMIT = 16;
/** Whether the app's fixed exposure, sky.exposure.ev100, can be set to this EV: it allows −12 to 20. */
const fixedEvAllows = ev => typeof ev === "number" && ev >= -12 && ev <= 20;
const bracket = (() => {
  if (options.bracket === undefined) return [];
  const steps = options.bracket.split(",").map(part => part.trim()).filter(Boolean).map(Number);
  if (!steps.length || steps.some(step => !Number.isFinite(step) || Math.abs(step) > 2 * COMPENSATION_LIMIT)) {
    console.error(`--bracket needs stops separated by commas, e.g. --bracket=-2,-1,1,2 (got "${options.bracket}")`);
    process.exit(2);
  }
  // The scenario's own exposure is always the first picture; the steps are the others, darkest first.
  return [...new Set(steps)].filter(step => step !== 0).sort((a, b) => a - b);
})();
const stopsText = stops => `${stops > 0 ? "+" : stops < 0 ? "-" : "±"}${Math.abs(stops)}`;
const stopsLabel = stops => `${stopsText(stops)} ${Math.abs(stops) === 1 ? "stop" : "stops"}`;

/** The scenario's own compensation: renderer.exposureEV in its settings, else the app's default, none. */
function compensationOf(scenario) {
  const given = scenario.settings[COMPENSATION_ID] ?? 0;
  const value = typeof given === "number" ? given : Number(given);
  if (!Number.isFinite(value)) throw new Error(`[${scenario.name}] settings.${COMPENSATION_ID} must be a number of stops, not ${JSON.stringify(given)}`);
  return value;
}

const log = (...parts) => console.log(...parts);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const relative = file => path.relative(process.cwd(), file) || ".";

// Everything this run owns, for cleanup on any exit.
const owned = { server: null, page: null, profile: null, buildChild: null };
let cleaning = null;
async function cleanup() {
  cleaning ??= (async () => {
    if (owned.buildChild) owned.buildChild.kill("SIGTERM");
    if (owned.page) await owned.page.close().catch(error => console.error(`Chrome close: ${error.message}`));
    owned.page = null;
    if (owned.server) await owned.server.close();
    owned.server = null;
    // The profile holds the key the page saved; it never outlives the run.
    if (owned.profile) await rm(owned.profile, { recursive: true, force: true });
    owned.profile = null;
  })();
  return cleaning;
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    console.error(`\n${signal}: stopping Chrome and the server...`);
    cleanup().finally(() => process.exit(130));
  });
}

/** Page URL for a scenario; the key is added separately so nothing else carries it. */
function pageParameters(scenario) {
  const params = new URLSearchParams({ bench: "1" });
  // The app's settings handle, to set each bracket step live; it changes nothing else.
  if (bracket.length) params.set("panoramaTest", "1");
  params.set("mapSource", scenario.scenery.basemap);
  if (scenario.scenery.renderer !== "auto") params.set("renderer", scenario.scenery.renderer);
  // The sky's set time is a UTC day and an hour of it.
  const day = new Date(scenario.time.utcMs).toISOString().slice(0, 10);
  params.set("set.sky.time.mode", "fixed");
  params.set("set.sky.time.date", day);
  params.set("set.sky.time.utcHours", String((scenario.time.utcMs - Date.parse(`${day}T00:00:00Z`)) / 3_600_000));
  params.set("set.camera.fieldOfView", String(scenario.camera.verticalFovDeg));
  for (const [id, value] of Object.entries(scenario.settings)) params.set(`set.${id}`, String(value));
  return params;
}

/** Capture-only presentation, applied on every poll: no controls, no scene overlays; the attribution chip kept unless the scenario says not. */
async function presentForCapture(page, scenario) {
  const ui = await inPage(page, hideInterface, { keepAttribution: scenario.attribution });
  ui.hiddenMeshes = await inPage(page, hideSceneMeshes, { prefixes: scenario.hideSceneMeshes });
  return ui;
}

/** Polls the page until `done(state)` is true or the deadline passes; page reloads are tolerated. */
async function pollPage(page, deadline, pollMs, step) {
  let last = null, errors = 0;
  while (Date.now() < deadline) {
    try {
      last = await inPage(page, probe);
      errors = 0;
      const result = await step(last);
      if (result) return result;
    } catch (error) {
      // A navigation or the service worker's one reload destroys the context mid-call.
      if (++errors > 40) throw error;
    }
    await sleep(pollMs);
  }
  return { timedOut: true, last };
}

/**
 * Waits until the view is loaded, as asked and still for `readiness.stablePolls` polls, then draws two
 * frames, captures, and probes again. A picture is kept only if nothing changed while it was taken;
 * otherwise it waits again, up to `readiness.attempts` times.
 */
async function captureWhenStill(page, scenario, plan, { deadline, timeoutMs, label, compensationEv }) {
  const readiness = scenario.readiness;
  const attempts = [];
  let accepted = null, stableSince = null, lastFingerprint = null, stable = 0, lastReport = 0, placedAgain = 0;
  for (let attempt = 1; attempt <= readiness.attempts && !accepted; attempt++) {
    const result = await pollPage(page, deadline, readiness.pollMs, async s => {
      const ui = await presentForCapture(page, scenario);
      const verdict = assess(s, { scenario, plan, ui, compensationEv });
      const cameraMoved = verdict.problems.find(problem => problem.startsWith("the camera is not where"));
      if (cameraMoved && placedAgain < 2) {
        // The app's own start-up may still move the camera once; place it again, a bounded number of times.
        placedAgain++;
        await inPage(page, placeCamera, plan.engine);
        stable = 0;
        return null;
      }
      if (verdict.problems.length) return { failed: verdict.problems, state: s, ui };
      if (verdict.waiting.length || verdict.fingerprint !== lastFingerprint) {
        stable = 0; stableSince = Date.now(); lastFingerprint = verdict.fingerprint;
        if (Date.now() - lastReport > 3000) { lastReport = Date.now(); log(`[${label}] waiting: ${verdict.waiting.join("; ") || "for the picture to hold still"}`); }
        return null;
      }
      return ++stable >= readiness.stablePolls ? { state: s, ui, fingerprint: verdict.fingerprint } : null;
    });
    if (result.timedOut) {
      const last = result.last && assess(result.last, { scenario, plan, ui: null, compensationEv });
      throw new Error(`[${label}] not ready within ${timeoutMs / 1000} s: ${[...(last?.problems ?? []), ...(last?.waiting ?? [])].join("; ") || "no state"}`);
    }
    if (result.failed) throw new Error(`[${label}] cannot capture: ${result.failed.join("; ")}`);

    await inPage(page, settleFrames);
    const png = await page.screenshot();
    const after = await inPage(page, probe);
    const ui = await presentForCapture(page, scenario);
    const verdict = assess(after, { scenario, plan, ui, compensationEv });
    const steady = !verdict.problems.length && !verdict.waiting.length && verdict.fingerprint === result.fingerprint;
    attempts.push({ attempt, heldStillMs: Date.now() - stableSince, steady, changed: steady ? null : [...verdict.problems, ...verdict.waiting, verdict.fingerprint === result.fingerprint ? null : "the scene changed while capturing"].filter(Boolean) });
    if (steady) accepted = { png, state: after, ui };
    else { log(`[${label}] the scene changed during the capture; waiting again`); stable = 0; lastFingerprint = null; }
  }
  if (!accepted) throw new Error(`[${label}] the scene never held still for a capture (${readiness.attempts} attempts)`);
  return { ...accepted, attempts, placedAgain };
}

/** The exposure a picture was drawn at, from a probe taken with it. */
function exposureOf(state) {
  const sky = state.sky, compensationEv = state.exposureCompensationEv;
  const sun = sky?.lensFlare?.sources?.find(source => source.id === "sun") ?? null;
  return {
    ev100: sky?.ev100 ?? null, compensationEv,
    // The sky's exposure less the compensation: the EV the picture is shown at, as a fixed exposure would give it.
    effectiveEv100: typeof sky?.ev100 === "number" && typeof compensationEv === "number" ? sky.ev100 - compensationEv : null,
    sunStopsOverWhite: sun?.stopsOverWhite ?? null,
  };
}

async function captureScenario(scenario, scenarioFile, { origin, key, build, runRoot }) {
  const runDirectory = path.join(runRoot, scenario.name, stamp());
  await mkdir(runDirectory, { recursive: true });
  const { width, height } = scenario.image;
  const readiness = scenario.readiness;
  const timeoutMs = (options.timeout ? Number(options.timeout) : readiness.timeoutSec) * 1000;
  const started = Date.now(), deadline = started + timeoutMs;
  const params = pageParameters(scenario);
  const redactedUrl = `${origin}/app/?${params}${scenario.scenery.basemap === "google" ? "&key=REDACTED" : ""}`;
  if (scenario.scenery.basemap === "google") params.set("key", key);

  owned.profile = path.join(WORK, "profiles", `${scenario.name}-${stamp()}`);
  const chromeArgs = ["--hide-scrollbars", "--ignore-gpu-blocklist", "--force-color-profile=srgb",
    ...(scenario.scenery.renderer === "webgpu" || scenario.scenery.renderer === "auto" ? ["--enable-unsafe-webgpu"] : []),
    ...(options["no-cache"] ? [] : [`--disk-cache-dir=${path.join(WORK, "chrome-cache")}`])];
  const binary = process.env.CHROME_BINARY ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "");
  log(`[${scenario.name}] Chrome ${width}×${height}, ${redactedUrl}`);
  const page = await openHeadlessPage("chrome", owned.profile, { mode: "live", width, height, binary, chromeArgs,
    timeouts: { startupMs: 30_000, commandMs: 60_000, closeMs: 10_000 } });
  owned.page = page;
  await page.navigate(`${origin}/app/?${params}`);

  // 1. The app and its sky, at whatever view it starts with: the Sun's direction is needed to aim.
  let state = await pollPage(page, deadline, readiness.pollMs, s => (s.phase === "running" && s.sky ? s : null));
  if (state.timedOut) throw new Error(`[${scenario.name}] the app did not start within ${timeoutMs / 1000} s (last: ${JSON.stringify(state.last)?.slice(0, 400)})`);
  let plan = planCamera(scenario, state.sky.sunDirection);
  let placement = await inPage(page, placeCamera, plan.engine);
  if (!placement.restored) throw new Error(`[${scenario.name}] the runtime refused the camera placement`);

  // 1b. The Sun's direction seen from the starting view on the ground includes the air's refraction, which the
  // orbit does not see. Aim again with the direction the sky computes at the placed eye, until the aim holds.
  let aimedAgain = 0;
  for (;;) {
    const there = await pollPage(page, deadline, readiness.pollMs, s => (s.phase === "running" && s.sky && skyObserverAt(s.sky, plan, skyLagToleranceDeg(scenario)) ? s : null));
    if (there.timedOut) {
      const last = there.last, o = last?.sky?.observer;
      throw new Error(`[${scenario.name}] the sky was not computed for the placed camera within ${timeoutMs / 1000} s: planned ${plan.observer.latDeg}, ${plan.observer.lonDeg} at ${plan.observer.altitudeKm} km`
        + `; sky observer ${o ? `${o.latDeg.toFixed(4)}, ${o.lonDeg.toFixed(4)} at ${(o.altitudeMeters / 1000).toFixed(1)} km` : "none"}`
        + `; camera ${last?.camera ? JSON.stringify({ center: last.camera.center.map(v => Math.round(v)), planned: plan.engine.center.map(v => Math.round(v)), yaw: last.camera.yaw, pitch: last.camera.pitch, plannedYaw: plan.engine.yaw, plannedPitch: plan.engine.pitch }) : "none"}`);
    }
    const next = planCamera(scenario, there.sky.sunDirection);
    const moved = Math.hypot(...next.engine.center.map((v, i) => v - plan.engine.center[i]));
    if (moved <= 0.5 && Math.abs(next.engine.yaw - plan.engine.yaw) <= 1e-6 && Math.abs(next.engine.pitch - plan.engine.pitch) <= 1e-6) break;
    if (++aimedAgain > 3) throw new Error(`[${scenario.name}] the aim did not settle: the Sun's direction keeps changing as the camera moves`);
    plan = next;
    placement = await inPage(page, placeCamera, plan.engine);
    if (!placement.restored) throw new Error(`[${scenario.name}] the runtime refused the camera placement`);
  }
  log(`[${scenario.name}] observer ${plan.observer.latDeg}, ${plan.observer.lonDeg} at ${plan.observer.altitudeKm} km (${plan.observer.how}); heading ${plan.headingDeg}°, elevation ${plan.elevationDeg}°, FOV ${scenario.camera.verticalFovDeg}°`);
  log(`[${scenario.name}] expected: Sun ${plan.expected.sun.aboveLimbDeg}° above the Earth's edge at ${JSON.stringify(plan.expected.sun.pixel)}; edge at centre row ${plan.expected.limb[Math.floor(plan.expected.limb.length / 2)]?.y ?? "?"}`);

  // 2. Hide the interface, wait for everything to load and hold still, and capture.
  const compensationEv = compensationOf(scenario);
  const accepted = await captureWhenStill(page, scenario, plan, { deadline, timeoutMs, label: scenario.name, compensationEv });

  // 3. The bracket: the same loaded view at other exposures, each set live and captured as carefully.
  const shots = [];
  for (const stops of bracket) {
    const label = `${scenario.name} ${stopsLabel(stops)}`;
    const stepEv = compensationEv + stops;
    const set = await inPage(page, setSetting, { id: COMPENSATION_ID, value: stepEv });
    if (!set.ok) throw new Error(`[${label}] could not set ${COMPENSATION_ID} to ${stepEv}: ${set.reason}`);
    shots.push({ stops, compensationEv: stepEv, ...await captureWhenStill(page, scenario, plan, { deadline: Date.now() + timeoutMs, timeoutMs, label, compensationEv: stepEv }) });
  }
  const evidence = page.captureEvidence();
  await page.close();
  owned.page = null;
  await rm(owned.profile, { recursive: true, force: true });
  owned.profile = null;

  // 4. The original, the encodings, and what they show.
  const original = path.join(runDirectory, "original.png");
  await writeFile(original, accepted.png);
  const image = decodePng(accepted.png);
  if (image.width !== width || image.height !== height) throw new Error(`[${scenario.name}] the screenshot is ${image.width}×${image.height}, not ${width}×${height}`);
  const measured = analyse(image);
  if (measured.lumaStdDev < 2) {
    // A blank picture is most often the exposure: say which one was in use.
    const sky = accepted.state.sky;
    const exposure = sky ? ` at EV ${sky.ev100?.toFixed(2)} (the meter read EV ${sky.meteredEv100?.toFixed(2)}${typeof sky.meterGroundShare === "number" ? `, ${Math.round(sky.meterGroundShare * 100)}% on the ground below` : ""}, adapted ${sky.adaptedEv100?.toFixed(2)}${sky.exposureHeld ? `, held ${sky.exposureHeld}` : ""})` : "";
    throw new Error(`[${scenario.name}] the picture is blank (luma deviation ${measured.lumaStdDev})${exposure}; see ${original}`);
  }
  const webp = path.join(runDirectory, "final.webp");
  const webpBytes = await encodeWebp(original, webp, scenario.encode.webpQuality);
  const decoded = path.join(runDirectory, "final-decoded.png");
  const hasDecoded = await decodeWebp(webp, decoded);
  let jpegBytes = null;
  const jpeg = path.join(runDirectory, "final.jpg");
  if (scenario.encode.jpeg !== false) jpegBytes = await encodeJpeg(original, jpeg, scenario.encode.jpegQuality, APP_ROOT);

  const s = accepted.state;
  const actual = describeView({ eye: s.eye ?? plan.engine.center, center: s.camera.center, verticalFovDeg: s.camera.fov * 180 / Math.PI, width, height, sunDirection: s.sky.sunDirection, reference: scenario.reference });
  // The Sun's disc is 0.533° across; look for it within a few of its widths of the predicted place.
  const sunRadiusPx = (0.2665 / (s.camera.fov * 180 / Math.PI)) * height;
  const sun = { predicted: actual.sun.pixel, behindEarth: actual.sun.behindEarth, expectedDiameterPx: Math.round(sunRadiusPx * 20) / 10,
    ...(actual.sun.behindEarth ? {} : measureSun(image, actual.sun.pixel, Math.max(24, Math.ceil(sunRadiusPx * 4)))) };
  const published = [];
  if (options.publish && scenario.publish) {
    for (const [kind, source] of [["webp", webp], ["jpeg", jpegBytes ? jpeg : null]]) {
      const destination = resolveDestination(scenario.publish[kind], scenarioFile);
      if (!destination || !source) continue;
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(source, destination);
      published.push({ kind, path: destination, bytes: (await stat(destination)).size });
    }
  }

  // 4b. The bracket's pictures, encoded as the published one is, to compare at card size. A blank one is
  // a result here, not a failure: a step can be too dark or too bright to show anything.
  const steps = [];
  for (const shot of shots) {
    const directory = path.join("bracket", `stops${stopsText(shot.stops)}`);
    await mkdir(path.join(runDirectory, directory), { recursive: true });
    const stepOriginal = path.join(runDirectory, directory, "original.png");
    await writeFile(stepOriginal, shot.png);
    const stepWebp = path.join(runDirectory, directory, "final.webp");
    const stepWebpBytes = await encodeWebp(stepOriginal, stepWebp, scenario.encode.webpQuality);
    steps.push({ stops: shot.stops, ...exposureOf(shot.state), measured: analyse(decodePng(shot.png)), directory,
      files: { original: { path: stepOriginal, bytes: shot.png.length }, webp: { path: stepWebp, bytes: stepWebpBytes } },
      readiness: { attempts: shot.attempts, cameraPlacedAgain: shot.placedAgain } });
  }

  const report = {
    scenario: scenario.name, description: scenario.description ?? null, scenarioFile, overrides: options.set,
    captured: new Date().toISOString(), durationS: Math.round((Date.now() - started) / 100) / 10,
    time: { utc: scenario.time.utc, label: scenario.time.label ?? null, skyUtc: new Date(s.sky.utcMs).toISOString(), heldExactly: s.sky.utcMs === scenario.time.utcMs },
    reference: scenario.reference ?? null,
    camera: { planned: plan, readBack: { snapshot: s.camera, eye: s.eye, fovMode: s.fovMode }, actual,
      note: "The eye is placed by restoring a navigation snapshot whose orbit centre is 1 m in front of it, as the engine's own placed views do." },
    scenery: { requested: scenario.scenery.basemap, mode: s.status.mode, message: s.status.message, terrainSource: s.status.terrainSource, tiles: s.tiles, detail: s.terrain,
      attribution: accepted.ui.attribution },
    presentation: { attributionInPicture: scenario.attribution, hiddenSceneMeshes: accepted.ui.hiddenMeshes,
      note: `Capture-only, in this page: page controls hidden by an injected style, these scene meshes set invisible; ${scenario.attribution ? "the map attribution chip kept" : "no interface at all, so the page that shows the picture must credit the map (scenery.attribution) beside it"}.` },
    sky: { model: s.sky.model, observer: s.sky.observer, observerLagDeg: Math.round(skyObserverArcDeg(s.sky, plan) * 1e4) / 1e4, sunAzimuthDeg: s.sky.sunAzimuthDeg, sunElevationDeg: s.sky.sunElevationDeg, ev100: s.sky.ev100,
      meteredEv100: s.sky.meteredEv100, adaptedEv100: s.sky.adaptedEv100, meterGroundShare: s.sky.meterGroundShare, exposureHeld: s.sky.exposureHeld,
      exposureCompensationEv: s.exposureCompensationEv, effectiveEv100: exposureOf(s).effectiveEv100,
      starCatalogue: s.sky.starCatalogue, nightLights: s.sky.nightLights, lensFlare: s.sky.lensFlare ?? null, computations: s.sky.computations },
    renderer: s.renderer, viewport: s.viewport, canvas: s.canvas, settings: scenario.settings, url: redactedUrl,
    build: { directory: build.directory, how: build.how, provenance: build.provenance },
    readiness: { attempts: accepted.attempts, stablePolls: readiness.stablePolls, pollMs: readiness.pollMs, aimedAgainForTheSkyAtTheEye: aimedAgain, cameraPlacedAgain: accepted.placedAgain },
    image: { width, height, measured, sun },
    files: { original: { path: original, bytes: accepted.png.length }, webp: { path: webp, bytes: webpBytes, quality: scenario.encode.webpQuality },
      decodedPreview: hasDecoded ? decoded : null, jpeg: jpegBytes ? { path: jpeg, bytes: jpegBytes, quality: scenario.encode.jpegQuality } : null, published },
    bracket: steps.length ? {
      setting: COMPENSATION_ID,
      note: `The same loaded view captured again after setting ${COMPENSATION_ID} live, each step in stops on top of the scenario's own exposure (the picture above, step 0); + is brighter. To use a step, capture with --set settings.${COMPENSATION_ID}=<its compensationEv>; with a fixed exposure and no compensation of the scenario's own, --set settings.sky.exposure.ev100=<its effectiveEv100> gives the same picture, where the app allows that EV (−12 to 20).`,
      steps,
    } : null,
    console: evidence.console.filter(entry => entry.level === "error" || entry.level === "warning").slice(-40),
  };
  // Belt and braces: the key reaches the page only through its address.
  const text = JSON.stringify(report, null, 2).replaceAll(key ?? "\u0000", "[google-key]");
  await writeFile(path.join(runDirectory, "report.json"), text + "\n");
  await writeFile(path.join(runDirectory, "preview.html"), previewHtml(JSON.parse(text)));
  await writeFile(path.join(runRoot, scenario.name, "latest.txt"), path.relative(path.join(runRoot, scenario.name), runDirectory) + "\n");
  log(`[${scenario.name}] captured in ${report.durationS} s: ${relative(original)} (${accepted.png.length} B), final.webp ${webpBytes} B${jpegBytes ? `, final.jpg ${jpegBytes} B` : ""}`);
  log(`[${scenario.name}] Sun ${actual.sun.aboveLimbDeg}° above the Earth's edge, ${sun.behindEarth ? "behind the Earth" : `predicted ${JSON.stringify(actual.sun.pixel)}, ${sun.found ? `found ${sun.offsetPx} px from there, ${sun.diameterPx} px across` : sun.predicted?.inFrame ? "not found there" : "out of frame"}`}; map ${s.status.mode}; renderer ${s.renderer.mode} (${s.renderer.gpu ?? "GPU unknown"})`);
  const flare = s.sky.lensFlare, flareSun = flare?.sources.find(source => source.id === "sun");
  const shown = exposureOf(s);
  log(`[${scenario.name}] exposure EV ${s.sky.ev100?.toFixed(2)}${scenario.settings["sky.exposure.mode"] === "fixed" ? " (fixed)" : ` (metered EV ${s.sky.meteredEv100?.toFixed(2)}${typeof s.sky.meterGroundShare === "number" ? `, ${Math.round(s.sky.meterGroundShare * 100)}% on the ground below` : ""})`}${shown.compensationEv ? `, compensation ${stopsLabel(shown.compensationEv)}: shown at EV ${shown.effectiveEv100?.toFixed(2)}` : ""}; lens flare ${flare ? `${flare.mode}, ${flare.status}${flareSun ? `, ${Math.round(flareSun.visibleFraction * 100)}% of the Sun seen${typeof flareSun.stopsOverWhite === "number" ? `, ${flareSun.stopsOverWhite.toFixed(1)} stops over white` : ""}` : ""}` : "not in this build"}`);
  for (const step of steps) {
    log(`[${scenario.name}] bracket ${stopsLabel(step.stops)}: shown at EV ${step.effectiveEv100?.toFixed(2)} (compensation ${step.compensationEv}); mean luma ${step.measured.meanLuma}, ${(step.measured.clippedFraction * 100).toFixed(1)}% clipped, ${Math.round(step.measured.nearBlackFraction * 100)}% near black${typeof step.sunStopsOverWhite === "number" ? `; Sun ${step.sunStopsOverWhite.toFixed(1)} stops over white` : ""}; ${relative(step.files.webp.path)}`);
  }
  for (const item of published) log(`[${scenario.name}] published ${item.kind}: ${item.path} (${item.bytes} B)`);
  log(`[${scenario.name}] preview: ${relative(path.join(runDirectory, "preview.html"))}`);
  return report;
}

function previewHtml(report) {
  const escape = value => String(value).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const { width, height } = report.image;
  const summary = {
    time: report.time, observer: report.camera.planned.observer, look: report.camera.actual.look, sun: report.camera.actual.sun,
    reference: report.camera.actual.reference, scenery: { mode: report.scenery.mode, attribution: report.scenery.attribution?.credit },
    build: report.build.provenance.summary, files: { webp: report.files.webp.bytes, jpeg: report.files.jpeg?.bytes ?? null, original: report.files.original.bytes },
  };
  return `<!doctype html><meta charset="utf-8"><title>${escape(report.scenario)}</title>
<style>body{background:#0b0f18;color:#dde;font:14px/1.4 system-ui;margin:24px}img{display:block;max-width:none}h2{font-size:15px;margin:28px 0 8px}
.card{width:345px;height:345px;border-radius:16px;overflow:hidden;display:inline-block;vertical-align:top;margin:0 16px 16px 0;background:#0a1530}
.card img{width:100%;height:100%;object-fit:cover;object-position:50% 0%}.tablet{width:480px;height:200px}
.bracket{display:flex;flex-wrap:wrap;gap:16px}.bracket figure{margin:0;width:345px}.bracket figcaption{margin-top:6px;color:#aab}.bracket b{color:#fff}
.bracket .own .card{outline:2px solid #7af}code{font-size:12px;color:#cde;word-break:break-all}
pre{white-space:pre-wrap;background:#121826;padding:12px;border-radius:8px}.scroll{overflow:auto}</style>
<h1>${escape(report.scenario)}</h1><p>${escape(report.description ?? "")}</p>
<h2>As a card's background (345 × 345 and 480 × 200 CSS px, object-fit: cover, kept from the top)</h2>
<div class="card"><img src="final.webp" alt=""></div><div class="card tablet"><img src="final.webp" alt=""></div>
${bracketHtml(report, escape)}
<h2>final.webp at full size (${width}×${height}, ${report.files.webp.bytes} bytes)</h2><div class="scroll"><img src="final.webp" width="${width}" height="${height}" alt=""></div>
<h2>original.png (${report.files.original.bytes} bytes)</h2><div class="scroll"><img src="original.png" width="${width}" height="${height}" alt=""></div>
<h2>Summary</h2><pre>${escape(JSON.stringify(summary, null, 2))}</pre>`;
}

/** The bracket, darkest first, with the scenario's own exposure among it: each at card size, with what it shows and how to use it. */
function bracketHtml(report, escape) {
  if (!report.bracket) return "";
  const fixed = report.settings["sky.exposure.mode"] === "fixed";
  const own = { stops: 0, ...pick(report.sky), measured: report.image.measured, directory: ".", own: true };
  const ownCompensation = own.exposureCompensationEv ?? 0;
  const entries = [...report.bracket.steps, own].sort((a, b) => a.stops - b.stops);
  const figures = entries.map(entry => {
    const compensation = entry.own ? ownCompensation : entry.compensationEv;
    const webp = entry.own ? "final.webp" : `${entry.directory}/final.webp`;
    const m = entry.measured;
    const asFixed = fixed && !ownCompensation && fixedEvAllows(entry.effectiveEv100);
    const use = entry.own ? "the scenario's own exposure: what --publish publishes"
      : `--set settings.${report.bracket.setting}=${compensation}${asFixed ? `, or --set settings.sky.exposure.ev100=${Number(entry.effectiveEv100.toFixed(2))}` : ""}`;
    return `<figure class="${entry.own ? "own" : ""}"><a href="${escape(webp)}"><div class="card"><img src="${escape(webp)}" alt=""></div></a>
<figcaption><b>${entry.own ? "±0, the scenario's" : escape(stopsLabel(entry.stops))}</b> · EV ${typeof entry.effectiveEv100 === "number" ? entry.effectiveEv100.toFixed(1) : "?"}${typeof entry.sunStopsOverWhite === "number" ? ` · Sun ${entry.sunStopsOverWhite.toFixed(1)} stops over white` : ""}<br>
mean ${m.meanLuma} of 255 · ${(m.clippedFraction * 100).toFixed(1)}% clipped · ${Math.round(m.nearBlackFraction * 100)}% near black<br><code>${escape(use)}</code></figcaption></figure>`;
  });
  return `<h2>Exposure bracket: the same view at each exposure compensation, darkest first (+ is brighter; click for full size)</h2>
<div class="bracket">${figures.join("\n")}</div>`;

  function pick(sky) {
    const sun = sky.lensFlare?.sources?.find(source => source.id === "sun");
    return { exposureCompensationEv: sky.exposureCompensationEv, effectiveEv100: sky.effectiveEv100, sunStopsOverWhite: sun?.stopsOverWhite ?? null };
  }
}

let failed = false;
try {
  const scenarios = [];
  for (const argument of positionals) {
    const file = scenarioPath(argument, path.join(SCRIPT_DIRECTORY, "scenarios"));
    const scenario = await loadScenario(file, options.set);
    const outside = bracket.map(stops => compensationOf(scenario) + stops).filter(value => Math.abs(value) > COMPENSATION_LIMIT);
    if (outside.length) throw new Error(`[${scenario.name}] --bracket reaches a compensation of ${outside.join(", ")} stops; ${COMPENSATION_ID} allows −${COMPENSATION_LIMIT} to ${COMPENSATION_LIMIT}`);
    scenarios.push({ file, scenario });
  }
  const needsKey = scenarios.some(({ scenario }) => scenario.scenery.basemap === "google");
  const { key, origin: keyOrigin } = needsKey ? readGoogleKey({ files: KEY_FILES }) : { key: null, origin: null };
  if (needsKey && !key) throw new Error(`Google 3D Tiles need a key: set GOOGLE_3D_TILES_KEY or add it to one of ${KEY_FILES.join(", ")}. No other source is substituted.`);
  if (needsKey) log(`Google key: found (${keyOrigin === "environment" ? "environment" : relative(keyOrigin)}); not printed.`);

  await mkdir(WORK, { recursive: true });
  const build = await resolveBuild({
    appRoot: APP_ROOT, ownDist: path.join(WORK, "app-dist"), explicitDist: options["app-dist"] && path.resolve(options["app-dist"]),
    rebuild: options.rebuild, buildLog: path.join(WORK, "app-dist.build.log"), onChild: child => { owned.buildChild = child; }, log,
  });
  log(`Build: ${relative(build.directory)} (${build.how}), built ${build.provenance.built ?? "at an unknown time"}; ${build.provenance.verdict ?? "it does not record its source"}${build.provenance.stale ? ":" : ""}`);
  for (const line of build.provenance.summary) log(`  ${line}`);
  if (options["dry-run"]) {
    for (const { scenario } of scenarios) {
      log(`[${scenario.name}] ${JSON.stringify({ time: scenario.time, observer: scenario.observer, camera: scenario.camera, image: scenario.image, scenery: scenario.scenery, settings: scenario.settings })}`);
      if (bracket.length) log(`[${scenario.name}] bracket: ${COMPENSATION_ID} ${[0, ...bracket].map(stops => compensationOf(scenario) + stops).join(", ")} (stops ${[0, ...bracket].map(stopsText).join(", ")})`);
    }
  } else {
    owned.server = await serveBuild(build.directory, { port: Number(options.port) });
    log(`Serving the build at ${owned.server.origin}/app/ (this run only)`);
    const runRoot = options.out ? path.resolve(options.out) : path.join(WORK, "runs");
    for (const { file, scenario } of scenarios) await captureScenario(scenario, file, { origin: owned.server.origin, key, build, runRoot });
  }
} catch (error) {
  failed = true;
  console.error(error instanceof Error ? error.message : error);
} finally {
  await cleanup();
}
process.exit(failed ? 1 : 0);
