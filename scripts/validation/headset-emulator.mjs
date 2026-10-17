#!/usr/bin/env node
/**
 * VR on an emulated headset: headless Chrome opens the app from the dev server
 * with `?headsetEmulator=quest3` (vite/headsetEmulator.ts) and goes through a
 * visit as a headset would: the VR tab offered, Enter VR, both eyes drawn,
 * looking around, a snap turn, a photograph opened from the map with the
 * trigger, a link followed, the grip back to the map, and the session ended.
 *
 *   npm run check:headset [-- --url=http://127.0.0.1:5173/app/] [--scene=<id>|page] [--binary=<chrome>] [--output=build/headset/<name>]
 *
 * Without --url it starts the app's dev server on a free port. --url takes any
 * page that mounts the app from a dev server with the headset emulator, such as
 * a tour's; --scene=page keeps that page's own scene in place of the linked
 * example pair. The report and
 * screenshots go to a new directory under build/headset/. It needs a Chrome
 * with WebGL 2 and, for the map and photographs, the network.
 */
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const SCENE = 'campus-pair';
export const LIMITS = Object.freeze({ startupMs: 90000, conditionMs: 30000, commandMs: 30000, closeMs: 10000 });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function parseOptions(argv, env = process.env, exists = existsSync) {
  const values = new Map();
  for (const arg of argv) {
    const match = /^--(url|scene|binary|output)=(.+)$/.exec(arg);
    if (!match || values.has(match[1])) throw new Error(`Unknown or repeated option: ${arg.split('=')[0]}`);
    values.set(match[1], match[2]);
  }
  const binary = values.get('binary') ?? env.CHROME_BINARY ?? (exists(MAC_CHROME) ? MAC_CHROME : null);
  if (!binary) throw new Error('Name a Chrome with --binary= or CHROME_BINARY.');
  const url = values.has('url') ? new URL(values.get('url')) : null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const output = path.resolve(APP_ROOT, values.get('output') ?? path.join('build', 'headset', stamp));
  if (!output.startsWith(path.join(APP_ROOT, 'build') + path.sep)) throw new Error('The output goes under build/.');
  return { url, scene: values.get('scene') ?? SCENE, binary, output };
}

/** The page address: the app with the emulated headset, its test hooks and the scene, or the page's own with "page". */
export function pageUrl(base, scene = SCENE) {
  const url = new URL(base);
  url.searchParams.set('headsetEmulator', 'quest3');
  url.searchParams.set('panoramaTest', '1');
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
    state: () => ({ headset: test.headset.state, reason: test.headset.reason, session: Boolean(device.activeSession), activeCamera: scene.activeCamera?.name ?? null, frames, status: status() }),
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
    aim(hand, local) { return device.remote.dispatch('look_at', { device: `controller-${hand}`, target: { x: local[0], y: local[1], z: local[2] } }); },
    /** Turns the head `yawDeg` to the left and `pitchDeg` up, as a level head turns and then tilts. */
    turnHead(yawDeg, pitchDeg = 0) {
      const h = yawDeg * Math.PI / 360, p = pitchDeg * Math.PI / 360;
      const [sy, cy, sp, cp] = [Math.sin(h), Math.cos(h), Math.sin(p), Math.cos(p)];
      return device.remote.dispatch('set_transform', { device: 'headset', orientation: { x: cy * sp, y: sy * cp, z: -sy * sp, w: cy * cp } });
    },
    button(hand, id, value) { device.controllers[hand].updateButtonValue(id, value); },
    stick(hand, x, y) { device.controllers[hand].updateAxes('thumbstick', x, y); },
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

export async function run(options, injected = {}) {
  await mkdir(options.output, { recursive: true });
  const report = { schemaVersion: 1, startedAt: new Date().toISOString(), scene: options.scene, checks: [], screenshots: [] };
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
    const press = async (id) => {
      await probe('button', 'right', id, 1);
      await probe('afterFrames', 3);
      await probe('button', 'right', id, 0);
    };
    const screenshot = async name => {
      const file = path.join(options.output, `${name}.png`);
      await writeFile(file, await page.screenshot());
      report.screenshots.push(path.relative(APP_ROOT, file));
    };

    const url = pageUrl(base, options.scene);
    report.url = url.href;
    await page.navigate(url);
    const emulator = await waitFor('The emulated headset answers WebXR', () => evaluate(`(async () => ({ device: window.__fossEarthHeadsetEmulator?.name ?? null, vr: await navigator.xr?.isSessionSupported('immersive-vr') }))()`),
      value => value.device && value.vr === true, LIMITS.startupMs);
    record('The emulated headset answers WebXR', true, emulator);
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
    await probe('turnHead', 90);
    await probe('afterFrames', 5);
    const after = await probe('headForward');
    const headTurn = await evaluate(`window.__headsetProbe.angleDeg(${JSON.stringify(before)}, ${JSON.stringify(after)})`);
    record('Turning the head turns the view', Math.abs(headTurn - 90) < 3, { headTurnDeg: headTurn });
    await probe('turnHead', 0, -60);
    const below = await waitFor('Looking down shows the map', () => probe('pixels'), value => value.left.spread > 12 && value.right.spread > 12);
    record('Looking down shows the map', true, below);
    await screenshot('2b-map-below-in-vr');
    await probe('turnHead', 0);
    await probe('afterFrames', 5);

    const spaceBefore = await probe('spaceForward');
    await probe('stick', 'right', 1, 0);
    await probe('afterFrames', 5);
    await probe('stick', 'right', 0, 0);
    await probe('afterFrames', 5);
    const spaceAfter = await probe('spaceForward');
    const snap = await evaluate(`window.__headsetProbe.angleDeg(${JSON.stringify(spaceBefore)}, ${JSON.stringify(spaceAfter)})`);
    record('The thumbstick turns 30°, once per push', Math.abs(snap - 30) < 1, { turnDeg: snap });
    await probe('stick', 'right', -1, 0);
    await probe('afterFrames', 5);
    await probe('stick', 'right', 0, 0);
    await probe('afterFrames', 5);
    record('Each controller has a pointer', await probe('lasers') >= 1, { lasers: await probe('lasers') });

    // A link shows in the headset where the scene says which way it lies: a
    // photograph without one is noted, and the grip goes back for the next.
    report.withoutHeadsetLinks = [];
    let photograph, links;
    for (let attempt = 0; ; attempt++) {
      photograph = await waitFor('A photograph on the map is in reach of the controller', () => probe('findPhotograph', report.withoutHeadsetLinks), Boolean);
      if (attempt === 0) record('A photograph on the map is in reach of the controller', true, photograph);
      await probe('aim', 'right', photograph.local);
      await probe('afterFrames', 5);
      await press('trigger');
      const entered = await waitFor('The trigger opens the photograph it points at', () => probe('state'), value => value.status?.active === photograph.id && value.status.phase === 'immersive');
      if (attempt === 0) record('The trigger opens the photograph it points at', true, entered.status);
      links = (await poll(() => probe('links'), value => value.length >= 1, 5000)).value;
      if (links.length) break;
      report.withoutHeadsetLinks.push(photograph.id);
      console.log(`     ${photograph.id} has no link the headset can show; trying another`);
      if (attempt === 4) record('The photograph\'s links float around the headset', false, { withoutHeadsetLinks: report.withoutHeadsetLinks });
      await press('squeeze');
      await waitFor('The grip goes back to the map', () => probe('state'), value => value.status?.active === null && value.status.phase === 'overview');
      await probe('afterFrames', 10);
    }
    record('The photograph\'s links float around the headset', true, { photograph: photograph.id, links });
    const photo = await waitFor('Both eyes show the photograph', () => probe('pixels'), value => value.left.spread > 12 && value.right.spread > 12 && value.eyeDifference < 12);
    report.photographSettled = await probe('settled', LIMITS.conditionMs);
    await probe('afterFrames', 10);
    record('Both eyes show the photograph', true, { ...photo, settled: report.photographSettled });
    await screenshot('3-photograph-in-vr');

    await probe('aim', 'right', links[0].local);
    const hovered = await waitFor('Pointing at a link marks it', () => probe('links'), value => value.find(link => link.id === links[0].id)?.scale > 1.2);
    record('Pointing at a link marks it', true, hovered);
    await press('trigger');
    const followed = await waitFor('The trigger follows the link', () => probe('state'), value => value.status?.active && value.status.active !== photograph.id && value.status.phase === 'immersive');
    record('The trigger follows the link', true, followed.status);

    await press('squeeze');
    const back = await waitFor('The grip goes back to the map', () => probe('state'), value => value.status?.active === null && value.status.phase === 'overview');
    record('The grip goes back to the map', true, back.status);

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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await run(parseOptions(process.argv.slice(2)));
  process.exitCode = report.ok ? 0 : 1;
}
