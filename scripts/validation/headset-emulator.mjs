#!/usr/bin/env node
/**
 * VR on an emulated headset. Headless Chrome opens the app from the dev server
 * with `?headsetEmulator=` (vite/headsetEmulator.ts). This file enters VR,
 * checks both eyes and the head, then runs one visit: the controller visit
 * (headset-controller.mjs) for Quest 2, Quest 3, and Quest Pro, or the
 * controllerless visit (headset-controllerless.mjs) for Vision Pro. It drives
 * the headset with `window.__fossEarthHeadset` (src/dev/headsetEmulator.ts).
 *
 *   npm run check:headset [-- --device=quest2|quest3|questPro|visionpro] [-- --comprehensive]
 *     [--url=http://127.0.0.1:3600/app/] [--scene=<id>|page] [--binary=<chrome>] [--output=build/headset/<name>]
 *
 * The default device is Quest 2. --comprehensive runs Quest 2, then Quest 3,
 * then Vision Pro, and stops at the first failure. It cannot be combined with
 * --device. Without --url the check starts the app's dev server. --url takes
 * any page that mounts the app from a dev server with the headset emulator,
 * such as a tour's; --scene=page keeps that page's own scene. The report and
 * screenshots go under build/headset/. It needs a Chrome with WebGL 2 and,
 * for the map and photographs, the network.
 */
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { controllerVisit } from './headset-controller.mjs';
import { controllerlessVisit } from './headset-controllerless.mjs';

const APP_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const SCENE = 'campus-pair';
export const LIMITS = Object.freeze({ startupMs: 90000, conditionMs: 30000, commandMs: 30000, closeMs: 10000 });
export const HEADSET_DEVICES = Object.freeze(['quest2', 'quest3', 'questPro', 'visionpro']);
export const DEVICE_NAMES = Object.freeze({
  quest2: 'Meta Quest 2', quest3: 'Meta Quest 3', questPro: 'Meta Quest Pro', visionpro: 'Apple Vision Pro',
});
export const DEVICE_BRANCH = Object.freeze({
  quest2: 'controller', quest3: 'controller', questPro: 'controller', visionpro: 'controllerless',
});
const COMPREHENSIVE_DEVICES = ['quest2', 'quest3', 'visionpro'];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function parseOptions(argv, env = process.env, exists = existsSync) {
  const values = new Map();
  let comprehensive = false;
  for (const arg of argv) {
    if (arg === '--comprehensive') {
      if (comprehensive) throw new Error('Unknown or repeated option: --comprehensive');
      comprehensive = true;
      continue;
    }
    const match = /^--(url|scene|binary|output|device)=(.+)$/.exec(arg);
    if (!match || values.has(match[1])) throw new Error(`Unknown or repeated option: ${arg.split('=')[0]}`);
    values.set(match[1], match[2]);
  }
  if (comprehensive && values.has('device')) throw new Error('--comprehensive and --device together are an error.');
  const device = values.get('device') ?? 'quest2';
  if (!HEADSET_DEVICES.includes(device)) throw new Error(`Unknown device "${device}". Known: ${HEADSET_DEVICES.join(', ')}.`);
  const binary = values.get('binary') ?? env.CHROME_BINARY ?? (exists(MAC_CHROME) ? MAC_CHROME : null);
  if (!binary) throw new Error('Name a Chrome with --binary= or CHROME_BINARY.');
  const url = values.has('url') ? new URL(values.get('url')) : null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const output = path.resolve(APP_ROOT, values.get('output') ?? path.join('build', 'headset', stamp));
  if (!output.startsWith(path.join(APP_ROOT, 'build') + path.sep)) throw new Error('The output goes under build/.');
  return { url, scene: values.get('scene') ?? SCENE, binary, output, device, comprehensive };
}

/**
 * The page address: the app with the emulated headset, its test hooks and the
 * scene, or the page's own with "page". The + menu is the dropdown picker.
 * The app's own default opens a new tab instead, and the visits open a window
 * from that menu.
 */
export function pageUrl(base, scene = SCENE, device = 'quest2') {
  const url = new URL(base);
  url.searchParams.set('headsetEmulator', device);
  url.searchParams.set('panoramaTest', '1');
  url.searchParams.set('set.interface.windows.tabPicker', 'dropdown');
  if (scene !== 'page') url.searchParams.set('scene', scene);
  return url;
}

/**
 * Installed in the page as `window.__headsetProbe`: what the check reads and
 * does there. Stringified, so it uses nothing from this module.
 */
function installProbe() {
  const test = window.__fossEarthPanoramaTest, device = window.__fossEarthHeadsetEmulator;
  const { scene, engine } = test.runtime;
  let frames = 0;
  scene.onAfterRenderObservable.add(() => { frames++; });
  const anchor = () => scene.getTransformNodeByName('headset-space');
  const camera = () => scene.getCameraByName('headset-camera');
  const Vector3 = scene.activeCamera.position.constructor;
  const toArray = v => [v.x, v.y, v.z];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const len = a => Math.hypot(a[0], a[1], a[2]);
  const unit = a => { const s = len(a) || 1; return [a[0] / s, a[1] / s, a[2] / s]; };
  const angleDeg = (a, b) => { a = unit(a); b = unit(b); return Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180 / Math.PI; };
  /** A world point in the session's local space, where the emulator's look_at takes its target. */
  const toLocal = point => {
    const inverse = anchor().getWorldMatrix().clone().invert();
    return toArray(Vector3.TransformCoordinates(new Vector3(point[0], point[1], point[2]), inverse));
  };
  const worldAxis = (node, axis) => toArray(Vector3.TransformNormal(new Vector3(axis[0], axis[1], axis[2]), node.getWorldMatrix()));
  const status = () => {
    const value = test.scenes.handle()?.status;
    return value ? { phase: value.phase, active: value.active, target: value.target, entries: value.entries.map(entry => ({ id: entry.id, preview: entry.preview, placement: entry.placement })) } : null;
  };
  window.__headsetProbe = {
    frames: () => frames,
    afterFrames(count) {
      const until = frames + count;
      return new Promise(resolve => { const observer = scene.onAfterRenderObservable.add(() => { if (frames >= until) { scene.onAfterRenderObservable.remove(observer); resolve(frames); } }); });
    },
    state: () => ({ headset: test.headset.state, branch: test.headset.branch ?? null, reason: test.headset.reason, session: Boolean(device.activeSession), activeCamera: scene.activeCamera?.name ?? null, frames, status: status(), sources: [...device.inputSources].map(source => source.targetRayMode) }),
    renderer: () => ({ mode: test.runtime.renderer.mode ?? null, webGPU: Boolean(engine.isWebGPU), webGLVersion: engine.webGLVersion ?? null }),
    tab() {
      const panel = document.querySelector('.foss-earth-headset');
      const button = panel?.querySelector('button');
      const rect = button?.getBoundingClientRect();
      return { shown: Boolean(panel && panel.getClientRects().length), button: button?.textContent ?? null, disabled: button?.disabled ?? null,
        status: panel?.querySelector('[role="status"]')?.textContent ?? null, center: rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null };
    },
    eyes() {
      const xr = camera();
      return xr ? { rigs: xr.rigCameras.map(rig => ({ x: rig.viewport.x, width: rig.viewport.width })), layerMask: xr.layerMask } : null;
    },
    /** Both eyes' images, read back inside a frame: each half's brightness and spread, and how far apart the halves are. */
    pixels() {
      return new Promise(resolve => {
        const observer = scene.onAfterRenderObservable.add(() => {
          scene.onAfterRenderObservable.remove(observer);
          const gl = engine._gl;
          const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
          const data = new Uint8Array(width * height * 4);
          gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data);
          const half = Math.floor(width / 2), step = 4;
          const stats = [0, 1].map(side => {
            let sum = 0, squares = 0, count = 0;
            for (let y = 0; y < height; y += step) for (let x = side * half; x < (side + 1) * half; x += step) {
              const i = (y * width + x) * 4, value = (data[i] + data[i + 1] + data[i + 2]) / 3;
              sum += value; squares += value * value; count++;
            }
            const mean = sum / count;
            return { mean, spread: Math.sqrt(Math.max(0, squares / count - mean * mean)) };
          });
          let difference = 0, count = 0;
          for (let y = 0; y < height; y += step) for (let x = 0; x < half; x += step) {
            const left = (y * width + x) * 4, right = (y * width + x + half) * 4;
            difference += Math.abs(data[left] - data[right]) + Math.abs(data[left + 1] - data[right + 1]) + Math.abs(data[left + 2] - data[right + 2]);
            count += 3;
          }
          resolve({ width, height, left: stats[0], right: stats[1], eyeDifference: difference / count });
        });
      });
    },
    headForward: () => { const xr = camera(); return xr ? worldAxis(xr, [0, 0, -1]) : null; },
    spaceForward: () => { const node = anchor(); return node ? worldAxis(node, [0, 0, -1]) : null; },
    angleDeg,
    /**
     * A photograph on the map the headset can see: a sweep of directions from
     * the eye until the renderer's own ray pick names one, then the middle of
     * the directions that hit it.
     */
    findPhotograph(skip = []) {
      const renderer = test.renderer, xr = camera();
      if (!renderer || !xr) return null;
      const eye = toArray(xr.globalPosition);
      const hits = new Map();
      for (let pitch = -89; pitch <= 89; pitch += 1) for (let yaw = 0; yaw < 360; yaw += 1) {
        const p = pitch * Math.PI / 180, h = yaw * Math.PI / 180;
        const local = new Vector3(Math.sin(h) * Math.cos(p), Math.sin(p), -Math.cos(h) * Math.cos(p));
        const direction = toArray(Vector3.TransformNormal(local, anchor().getWorldMatrix()).normalize());
        const hit = renderer.pickRay(eye, direction, () => false)[0];
        if (!hit || skip.includes(hit.id.slice(hit.id.indexOf(':') + 1))) continue;
        const entry = hits.get(hit.id) ?? { sum: [0, 0, 0], depth: 0, count: 0 };
        entry.sum = entry.sum.map((value, i) => value + direction[i]);
        entry.depth += hit.depthMeters;
        entry.count++;
        hits.set(hit.id, entry);
      }
      const [drawId, best] = [...hits].sort((a, b) => b[1].count - a[1].count)[0] ?? [];
      if (!best) return null;
      const direction = unit(best.sum), depth = best.depth / best.count;
      const target = eye.map((value, i) => value + direction[i] * depth);
      return { id: drawId.slice(drawId.indexOf(':') + 1), drawId, depthMeters: depth, directions: best.count, local: toLocal(target) };
    },
    links() {
      return scene.meshes.filter(mesh => /^headset-link-(?!label-)/.test(mesh.name) && mesh.isEnabled())
        .map(mesh => ({ id: mesh.name.slice('headset-link-'.length), local: toLocal(toArray(mesh.position)), scale: mesh.scaling.x }));
    },
    /** Whether the scene finishes loading what it shows within `timeoutMs`. */
    settled(timeoutMs) {
      const handle = test.scenes.handle();
      return handle ? Promise.race([handle.whenSettled().then(() => true), new Promise(resolve => setTimeout(() => resolve(false), timeoutMs))]) : false;
    },
    lasers: () => scene.meshes.filter(mesh => mesh.name.startsWith('headset-laser-') && mesh.isEnabled()).length,
    endSession() { return device.activeSession?.end(); },
    canvasRestored() { const canvas = engine.getRenderingCanvas(); return Boolean(canvas && !canvas.closest('[data-webxr_runtime]')); },
  };
  return true;
}

async function startDevServer() {
  const { createServer } = await import('vite');
  const server = await createServer({ root: APP_ROOT, configLoader: 'native', logLevel: 'warn', server: { host: '127.0.0.1', port: 0, strictPort: false } });
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (!url) { await server.close(); throw new Error('The dev server gave no local address.'); }
  return { url: new URL(url), close: () => server.close() };
}

async function runVisit(options, injected = {}) {
  await mkdir(options.output, { recursive: true });
  const report = { schemaVersion: 1, device: options.device, branch: DEVICE_BRANCH[options.device], startedAt: new Date().toISOString(), scene: options.scene, checks: [], screenshots: [] };
  const record = (name, ok, observed) => { report.checks.push({ name, ok, observed }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `: ${JSON.stringify(observed)}`}`); if (!ok) throw Object.assign(new Error(name), { recorded: true }); };
  let server = null, page = null;
  try {
    server = options.url ? null : await (injected.startDevServer ?? startDevServer)();
    const base = options.url ?? server.url;
    const { openHeadlessPage } = injected.openHeadlessPage ? injected : await import('@foss-earth/browser-testing/page');
    page = await openHeadlessPage('chrome', path.join(options.output, 'profile'), {
      mode: 'live', width: 1280, height: 800, binary: options.binary, workers: true,
      timeouts: { startupMs: LIMITS.startupMs, commandMs: LIMITS.commandMs, closeMs: LIMITS.closeMs, exitMs: 5000 },
    });
    report.browser = { product: page.product, facts: page.facts };
    const evaluate = expression => page.evaluate(expression);
    const probe = (call, ...args) => evaluate(`window.__headsetProbe.${call}(${args.map(arg => JSON.stringify(arg)).join(', ')})`);
    const headset = (call, ...args) => evaluate(`window.__fossEarthHeadset.${call}(${args.map(arg => JSON.stringify(arg)).join(', ')})`);
    /** The first value that passes, or the last one read once the time is up. */
    const poll = async (read, test, timeoutMs) => {
      const until = Date.now() + timeoutMs;
      for (;;) {
        let value;
        try { value = await read(); } catch (error) { value = { error: String(error?.message ?? error) }; }
        if (!value?.error && test(value)) return { ok: true, value };
        if (Date.now() > until) return { ok: false, value };
        await sleep(250);
      }
    };
    const waitFor = async (name, read, test, timeoutMs = LIMITS.conditionMs) => {
      const { ok, value } = await poll(read, test, timeoutMs);
      if (!ok) record(name, false, value);
      return value;
    };
    const press = id => headset('click', 'right', id);
    const screenshot = async name => {
      const file = path.join(options.output, `${name}.png`);
      await writeFile(file, await page.screenshot());
      // What the headset showed then: each panel, the part of the page it shows, and what each hand points at.
      const shown = await evaluate(`(() => { const state = window.__fossEarthHeadset?.state(); return state?.headset === 'presenting' ? { panels: state.panels.map(panel => ({ id: panel.id, floating: panel.floating, source: panel.source, center: panel.pose.center })), hands: state.hands } : null; })()`);
      report.screenshots.push(shown ? { file: path.relative(APP_ROOT, file), headset: shown } : path.relative(APP_ROOT, file));
    };

    const url = pageUrl(base, options.scene, options.device);
    report.url = url.href;
    await page.navigate(url);
    const emulator = await waitFor('The emulated headset answers WebXR', () => evaluate(`(async () => ({ device: window.__fossEarthHeadsetEmulator?.name ?? null, vr: await navigator.xr?.isSessionSupported('immersive-vr') }))()`),
      value => value.device && value.vr === true, LIMITS.startupMs);
    record('The emulated headset answers WebXR', emulator.device === DEVICE_NAMES[options.device] && emulator.vr === true, { ...emulator, expected: DEVICE_NAMES[options.device] });
    await waitFor('The app starts', () => evaluate(`Boolean(window.__fossEarthPanoramaTest?.runtime?.scene?.activeCamera)`), Boolean, LIMITS.startupMs);
    await evaluate(`(${installProbe.toString()})()`);

    const renderer = await probe('renderer');
    record('A VR device starts with WebGL 2', !renderer.webGPU && renderer.webGLVersion === 2, renderer);
    const tab = await waitFor('The VR tab opens by itself on a headset', () => probe('tab'), value => value.shown && value.button === 'Enter VR' && !value.disabled);
    record('The VR tab opens by itself on a headset', true, tab);
    const photographs = await waitFor('The scene\'s photographs are on the map', () => probe('state'),
      value => value.status?.entries.length >= (options.scene === SCENE ? 2 : 1) && value.status.entries.every(entry => entry.preview === 'ready' && entry.placement === 'placed'), LIMITS.startupMs);
    record('The scene\'s photographs are on the map', true, photographs.status);
    await screenshot('1-page');

    await page.clickAt(tab.center.x, tab.center.y);
    const presenting = await waitFor('Enter VR starts a session', () => probe('state'), value => value.headset === 'presenting' && value.session);
    record('Enter VR starts a session', true, presenting);
    const start = await probe('frames');
    await waitFor('The session keeps drawing', () => probe('frames'), frames => frames >= start + 30);
    const eyes = await probe('eyes');
    const state = await probe('state');
    record('The headset camera draws an image for each eye, side by side', state.activeCamera === 'headset-camera' && eyes?.rigs.length === 2
      && eyes.rigs[0].x === 0 && eyes.rigs[0].width === 0.5 && eyes.rigs[1].x === 0.5 && eyes.rigs[1].width === 0.5, { activeCamera: state.activeCamera, eyes });
    const pixels = await probe('pixels');
    // The globe is far: the eyes see nearly the same picture, never one picture across both.
    record('Both eyes show the globe', pixels.left.spread > 4 && pixels.right.spread > 4 && pixels.eyeDifference < 8, pixels);
    await screenshot('2-map-in-vr');

    const before = await probe('headForward');
    await headset('look', -90);
    await probe('afterFrames', 5);
    const after = await probe('headForward');
    const headTurn = await evaluate(`window.__headsetProbe.angleDeg(${JSON.stringify(before)}, ${JSON.stringify(after)})`);
    record('Turning the head turns the view', Math.abs(headTurn - 90) < 3, { headTurnDeg: headTurn });
    await headset('look', 0, -60);
    const below = await waitFor('Looking down shows the map', () => probe('pixels'), value => value.left.spread > 12 && value.right.spread > 12);
    record('Looking down shows the map', true, below);
    await screenshot('2b-map-below-in-vr');
    await headset('look', 0);
    await probe('afterFrames', 5);

    const expectedBranch = DEVICE_BRANCH[options.device];
    const shown = await evaluate(`(() => ({ branch: window.__fossEarthHeadset.state().branch, labels: [...document.querySelectorAll('.foss-earth-headset__controls dt')].map(term => term.textContent) }))()`);
    const labelsOk = expectedBranch === 'controller'
      ? shown.labels.includes('Trigger') && shown.labels.includes('Grip') && shown.labels.includes('Thumbstick left or right') && !shown.labels.includes('Pinch')
      : shown.labels[0] === 'Pinch' && !shown.labels.includes('Grip') && !shown.labels.some(label => String(label).startsWith('Thumbstick'));
    record(expectedBranch === 'controller' ? 'The controller list is the one showing' : 'The controllerless list is the one showing',
      shown.branch === expectedBranch && labelsOk, shown);

    const visit = { record, probe, headset, waitFor, poll, screenshot, evaluate, press, report };
    if (expectedBranch === 'controllerless') await controllerlessVisit(visit);
    else await controllerVisit(visit);

    await probe('endSession');
    const ended = await waitFor('Ending the session hands the page back', () => probe('state'), value => value.headset === 'ready' && !value.session && value.activeCamera !== 'headset-camera');
    const restored = await probe('canvasRestored');
    const afterExit = await probe('frames');
    await waitFor('The page draws again after VR', () => probe('frames'), frames => frames > afterExit, 10000);
    record('Ending the session hands the page back', restored, { ...ended, canvasRestored: restored });
    await screenshot('4-after-vr');

    const evidence = page.captureEvidence();
    const problems = evidence.console.filter(entry => /^(warn|warning|error)$/.test(entry.level) && (/^\[vr\]/.test(entry.text) || /webxr|\bxr|headset/i.test(entry.text)));
    record('No VR warnings or errors in the console', problems.length === 0, problems);
    report.ok = true;
  } catch (error) {
    report.ok = false;
    if (!error?.recorded) report.error = String(error?.stack ?? error);
    if (!error?.recorded) console.error(error);
  } finally {
    if (page) {
      report.console = page.captureEvidence().console.slice(-80);
      try { await page.close(); } catch (error) { report.closeError = String(error); }
    }
    if (server) await server.close();
    report.finishedAt = new Date().toISOString();
    await writeFile(path.join(options.output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`${report.ok ? 'Passed' : 'Failed'}: ${path.relative(APP_ROOT, path.join(options.output, 'report.json'))}`);
  }
  return report;
}

export async function run(options, injected = {}) {
  if (!options.comprehensive) return runVisit(options, injected);
  await mkdir(options.output, { recursive: true });
  const summary = { schemaVersion: 2, startedAt: new Date().toISOString(), scene: options.scene, devices: [], ok: true };
  for (const device of COMPREHENSIVE_DEVICES) {
    const output = path.join(options.output, device);
    const report = await runVisit({ ...options, device, output, comprehensive: false }, injected);
    summary.devices.push({ device, branch: DEVICE_BRANCH[device], ok: report.ok, report: path.relative(options.output, path.join(output, 'report.json')) });
    if (!report.ok) { summary.ok = false; break; }
  }
  summary.finishedAt = new Date().toISOString();
  await writeFile(path.join(options.output, 'report.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(`${summary.ok ? 'Passed' : 'Failed'}: ${path.relative(APP_ROOT, path.join(options.output, 'report.json'))}`);
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await run(parseOptions(process.argv.slice(2)));
  process.exitCode = report.ok ? 0 : 1;
}
