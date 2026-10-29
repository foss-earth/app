#!/usr/bin/env node
/** Earth assertions only. Browser protocols/lifecycle belong to the installed shared owner. */
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const APP_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TEST = 'window.__fossEarthPanoramaTest';
const APP = 'window.__fossEarthBench';
export const LIMITS = Object.freeze({ startupMs: 60000, conditionMs: 30000, commandMs: 15000, totalMs: 300000, closeMs: 10000 });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function canonicalUrl(value, port) {
  const url = new URL(value);
  if (url.origin !== `http://127.0.0.1:${port}` || url.pathname !== '/app/' || url.username || url.password || url.hash || url.search) {
    throw new Error(`Expected the explicit canonical http://127.0.0.1:${port}/app/ URL.`);
  }
  return url;
}

export function parseOptions(argv) {
  const values = new Map();
  const names = new Set(['browser', 'backend', 'url', 'landing-url', 'output', 'binary', 'playwright-root', 'playwright-cache', 'source-revision', 'compiled-sha256', 'compiled-manifest-sha256', 'helper-version']);
  for (const arg of argv) {
    const match = /^--([^=]+)=(.+)$/.exec(arg);
    if (!match || !names.has(match[1]) || values.has(match[1])) throw new Error(`Unknown, duplicate or empty option: ${arg.split('=')[0]}`);
    values.set(match[1], match[2]);
  }
  const need = name => { const value = values.get(name); if (!value) throw new Error(`Missing --${name}.`); return value; };
  const browser = need('browser');
  if (!['chrome', 'firefox', 'webkit'].includes(browser)) throw new Error('The browser must be chrome, firefox or webkit.');
  const backend = need('backend');
  if (!['webgl1', 'webgl2'].includes(backend)) throw new Error('Select the explicit required WebGL 1 or WebGL 2 functional backend.');
  const sourceRevision = need('source-revision'), compiledSha256 = need('compiled-sha256'), compiledManifestSha256 = need('compiled-manifest-sha256');
  if (!/^[a-f0-9]{40}$/.test(sourceRevision) || !/^[a-f0-9]{64}$/.test(compiledSha256) || !/^[a-f0-9]{64}$/.test(compiledManifestSha256)) throw new Error('Exact source, compiled archive and manifest pins are required.');
  const output = path.resolve(need('output'));
  if (!output.startsWith(path.join(APP_ROOT, 'build') + path.sep)) throw new Error('Output must be an owned ignored directory below the canonical app build directory.');
  return { browser, backend, appUrl: canonicalUrl(need('url'), 4180), landingUrl: canonicalUrl(need('landing-url'), 4181), output, sourceRevision, compiledSha256, compiledManifestSha256,
    helperVersion: need('helper-version'), binary: browser === 'webkit' ? undefined : need('binary'),
    playwright: browser === 'webkit' ? { packageRoot: path.resolve(need('playwright-root')), browserCachePath: path.resolve(need('playwright-cache')),
      expectedVersion: '1.55.0', expectedCoreVersion: '1.55.0', expectedWebkitRevision: '2203' } : undefined };
}

/** Only this public installed export may supply browser machinery. No checkout fallback. */
export async function installedPageHelper(expectedVersion) {
  const entry = fileURLToPath(import.meta.resolve('@foss-earth/browser-testing/page'));
  const packageRoot = path.join(APP_ROOT, 'node_modules', '@foss-earth', 'browser-testing');
  if ((await lstat(packageRoot)).isSymbolicLink()) throw new Error('The shared helper must be an installed artifact, not a source link.');
  const installedRoot = await realpath(packageRoot), installedEntry = await realpath(entry);
  if (installedRoot !== packageRoot) throw new Error('The shared helper cannot resolve through a neighboring source link.');
  if (!installedEntry.startsWith(installedRoot + path.sep)) throw new Error('The public helper resolved outside its installed package.');
  const host = JSON.parse(await readFile(path.join(APP_ROOT, 'package.json'), 'utf8'));
  const pin = host.fossEarthBrowserTesting;
  if (!pin?.developmentOnly || !/^[a-f0-9]{40}$/.test(pin.revision ?? '') || !/^[a-f0-9]{64}$/.test(pin.artifactSha256 ?? '') || !pin.installedFiles || host.dependencies?.['@foss-earth/browser-testing'] || host.devDependencies?.['@foss-earth/browser-testing'] !== 'file:' + pin.artifactPath) throw new Error('An exact checked development-only helper adoption is required.');
  const archive = path.resolve(APP_ROOT, pin.artifactPath);
  if (!archive.startsWith(path.join(APP_ROOT, 'deps') + path.sep) || await realpath(archive) !== archive || !(await lstat(archive)).isFile()) throw new Error('The checked helper archive must be a canonical owned dependency file.');
  const archiveBytes = await readFile(archive);
  if (archiveBytes.length !== pin.sizeBytes || digest(archiveBytes) !== pin.artifactSha256) throw new Error('The adopted helper archive changed.');
  for (const [relative, expected] of Object.entries(pin.installedFiles)) {
    if (!/^[a-f0-9]{64}$/.test(expected) || relative.includes('\\') || relative.startsWith('/') || relative.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Unsafe installed helper file seal.');
    const target = path.join(installedRoot, relative);
    if (await realpath(target) !== target || !(await lstat(target)).isFile() || digest(await readFile(target)) !== expected) throw new Error('Installed helper bytes differ from the checked artifact: ' + relative);
  }
  const metadata = JSON.parse(await readFile(path.join(installedRoot, 'package.json'), 'utf8'));
  if (metadata.name !== '@foss-earth/browser-testing' || metadata.version !== expectedVersion || !Object.hasOwn(metadata.exports ?? {}, './page')) {
    throw new Error('The exact installed helper identity/public page export does not match.');
  }
  return { openHeadlessPage: (await import('@foss-earth/browser-testing/page')).openHeadlessPage, identity: { name: metadata.name, version: metadata.version, revision: pin.revision, artifactSha256: pin.artifactSha256, files: Object.keys(pin.installedFiles).length, entry: './page' } };
}

export function assertRenderedGlobe(observed, backend = 'webgl2') {
  const mode = backend === 'webgl1' ? 'webgl' : 'webgl2';
  const version = backend === 'webgl1' ? 1 : 2;
  if (!['webgl1', 'webgl2'].includes(backend) || !observed || observed.bootError || observed.canvases !== 1 || !observed.canvasVisible || observed.mode !== mode || observed.webGLVersion !== version || !observed.camera) {
    throw new Error(`The page did not establish one visible globe canvas and the required actual ${backend} camera/backend.`);
  }
  if (!observed.mapMeshes?.length || !Number.isFinite(observed.frameId) || observed.frameId < 1) throw new Error('No rendered globe/map surface was observed.');
  if (observed.pixels?.samples < 128 || observed.pixels.distinct < 8 || observed.pixels.range < 4 || observed.pixels.nontransparent < 128) {
    throw new Error('The actual rendered canvas readback was empty or uniform.');
  }
}

/** Real CSS-pixel geometry, never inferred from DOM order or class names. */
export function assertMapHudLayout(observed, expected = 'compact') {
  if (!['compact', 'expanded'].includes(expected) || observed?.layout !== expected) throw new Error('The map HUD did not use the requested layout.');
  const boxes = [observed.bar, observed.slot, observed.group, observed.rail, observed.chip, observed.north, ...(observed.items ?? [])];
  for (const box of boxes) {
    if (!box || ['left', 'right', 'top', 'bottom', 'width', 'height'].some(key => !Number.isFinite(box[key])) || box.width <= 0 || box.height <= 0) throw new Error('The map HUD has no visible finite geometry.');
    if (box.left < -1 || box.right > observed.viewport.width + 1 || box.top < -1 || box.bottom > observed.viewport.height + 1) throw new Error('Map controls are clipped outside the viewport.');
  }
  if (!Array.isArray(observed.items) || observed.items.length < 1 || !Number.isInteger(observed.hiddenCount) || observed.hiddenCount < 0) throw new Error('The toolbar did not report its shown and hidden controls.');
  if (Math.abs(observed.north.left - observed.bar.left) > 1.25 || Math.abs(observed.north.bottom - observed.bar.bottom) > 1.25) throw new Error('North is not at the toolbar\'s bottom-left corner.');
  for (const box of [...observed.items, observed.slot]) {
    if (Math.abs(box.bottom - observed.bar.bottom) > 1.25) throw new Error('A toolbar control left the bottom row.');
  }
  if (Math.abs(observed.slot.right - observed.bar.right) > 1.25 || Math.abs(observed.slot.bottom - observed.bar.bottom) > 1.25) throw new Error('The map controls are not at the bottom-right end.');
  const centre = box => (box.top + box.bottom) / 2;
  const railInside = observed.rail.left >= observed.chip.left - 1.25 && observed.rail.right <= observed.chip.right + 1.25 && observed.rail.right > observed.chip.left + 1;
  if (expected === 'compact') {
    if (observed.worldEdges === 'flush') {
      const overlap = Math.min(observed.rail.bottom, observed.chip.bottom) - Math.max(observed.rail.top, observed.chip.top);
      if (observed.direction !== 'row' || !railInside || overlap < observed.rail.height - 2 || Math.abs(observed.rail.width - 41) > 1.25) throw new Error('Flush map controls must keep the small rail inside the provider chip.');
    } else if (observed.direction !== 'row' || observed.rail.right > observed.chip.left + 1 || Math.abs(centre(observed.rail) - centre(observed.chip)) > 1.25 || Math.abs(observed.rail.width - 41) > 1.25) throw new Error('Default map controls must use the small horizontal rail before the provider.');
  } else if (observed.worldEdges === 'flush') {
    if (observed.direction !== 'column' || !railInside || observed.rail.width <= 82 || observed.rail.width > observed.group.width + 1.25 || Math.abs(observed.rail.top - observed.chip.top) > 4 || observed.rail.bottom > observed.chip.bottom - 8) throw new Error('Flush expanded map controls must keep a wider rail inside the chip, above the provider.');
  } else if (observed.direction !== 'column' || observed.rail.bottom > observed.chip.top + 1 || observed.rail.width <= 82 || observed.rail.width > observed.group.width + 1.25) throw new Error('Expanded map controls must use a wider rail above the provider.');
}

/** Catch a provider button falling back to the browser's unstyled typography. */
export function assertMapSourceTypography(observed) {
  const { chip, provider, label } = observed?.typography ?? {};
  if (!chip || !provider || !label || observed.providerDisplay !== 'inline-flex' || !observed.labelText?.trim()) {
    throw new Error('The basemap indicator is missing its styled provider text.');
  }
  if (!chip.family.includes('monospace') || Math.abs(chip.size - 11) > 0.25) {
    throw new Error('The basemap indicator lost the standard HUD typography.');
  }
  for (const text of [provider, label]) {
    if (text.family !== chip.family || text.size !== chip.size || text.lineHeight !== chip.lineHeight || text.colour !== chip.colour) {
      throw new Error('The basemap provider text did not inherit the chip font and colour.');
    }
  }
}

/** This function is serialized to the real page by the public page helper. */
export function observeMapHudLayout() {
  const box = element => {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
  };
  const group = document.querySelector('.map-source-hud');
  const chip = group?.querySelector('.map-source-hud__chip');
  const provider = group?.querySelector('.map-source-hud__provider');
  const label = group?.querySelector('.map-source-label');
  const font = element => {
    if (!element) return null;
    const style = getComputedStyle(element);
    return { family: style.fontFamily, size: Number.parseFloat(style.fontSize), lineHeight: style.lineHeight, colour: style.color };
  };
  const bar = document.querySelector('.hud-bar');
  const slot = document.querySelector('#mapSourceSlot');
  const items = [];
  const visit = element => {
    if (!element || element === slot) return;
    if (element.hasAttribute('data-hud-overflow-hidden') || element.hasAttribute('data-hud-choice-hidden') || element.closest('[hidden]')) return;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return;
    if (style.display === 'contents') { for (const child of element.children) visit(child); return; }
    const rect = box(element);
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    items.push({ id: element.id || element.dataset.perfMetric || '', ...rect });
  };
  if (bar) for (const child of bar.children) visit(child);
  items.sort((a, b) => a.left - b.left || a.top - b.top);
  return { viewport: { width: innerWidth, height: innerHeight }, worldEdges: document.documentElement.dataset.worldEdges ?? null,
    layout: group?.dataset.mapHudLayout ?? null, direction: group ? getComputedStyle(group).flexDirection : null,
    typography: { chip: font(chip), provider: font(provider), label: font(label) },
    providerDisplay: provider ? getComputedStyle(provider).display : null, labelText: label?.textContent ?? null,
    bar: box(bar), slot: box(slot), north: box(document.querySelector('#northButton')), items,
    hiddenCount: bar ? bar.querySelectorAll('[data-hud-overflow-hidden]').length : 0,
    group: box(group), rail: box(group?.querySelector('.map-detail-control')), chip: box(chip) };
}

export function assertMenu(observed, dev) {
  const required = ['Location', 'Controls', 'Interface', 'Settings', 'Map', 'Renderer', 'Sky', 'Date and time', 'Scenes', 'About', 'Bug report', 'Account', 'Browser data'];
  for (const label of required) if (!observed.labels.includes(label)) throw new Error(`The standard app is missing its ${label} tab.`);
  if (observed.labels.includes('Dev') !== dev) throw new Error('The Dev tab did not follow the explicit ?dev=1 opt-in.');
  if (observed.labels.some(label => label === 'Flight' || label === 'Aircraft' || label === 'Campus')) throw new Error('A consumer implementation appeared in Earth tab composition.');
  for (const item of observed.items) if (item.left < -0.5 || item.right > observed.width + 0.5 || item.top < -0.5 || item.bottom > observed.limit + 0.5) {
    throw new Error(`A tab menu item is clipped or under the HUD: ${item.label}`);
  }
}

export function sanitizeText(value) {
  return String(value).replace(/(?:\/Users\/|\/private\/|[A-Z]:\\)[^\s"'<>]+/g, '[private path]')
    .replace(/https?:\/\/[^\s"'<>]+/g, text => { try { const u = new URL(text); return `${u.protocol}//${u.host}${u.pathname}`; } catch { return '[URL]'; } })
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/\b(authorization)\s*[=:]\s*[^\r\n,;]+/gi, '$1=[redacted]')
    .replace(/((?:token|api[-_]?key|secret|password|authorization)\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]').slice(0, 2000);
}

export function assertGracefulExit(result, evidence) {
  if (!result || result.code !== 0 || result.signal !== null || evidence?.lifecycle?.some(item => ['signal', 'graceful-close-timeout', 'forced-close'].includes(item.event))) {
    throw new Error('The browser did not provide a clean observed graceful exit. Forced cleanup is retained as a failed acceptance result.');
  }
}

export function assertLiveGoogleActivation(observed) {
  if (!observed?.initiallyMissing || !observed.savedKeyAvailable || observed.mode !== 'google-tiles' ||
      !observed.sameRuntime || !observed.sameScene || !observed.sameEngine || !observed.sameDocument || observed.canvases !== 1) {
    throw new Error('Saving a previously absent key and selecting Google must activate its tile session in the existing app without a reload.');
  }
}

export async function runEarthSuite(options, injected = {}) {
  await mkdir(options.output, { recursive: false });
  const report = { schemaVersion: 1, owner: 'foss-earth/app', status: 'running', sourceRevision: options.sourceRevision, compiledArchiveSha256: options.compiledSha256, compiledManifestSha256: options.compiledManifestSha256,
    browser: options.browser, backendRequired: options.backend, mode: 'live', workers: true, startedAt: new Date().toISOString(), assertions: [], failures: [], screenshots: [],
    limitations: ['Synthetic DOM clicks and public app navigation hooks do not qualify physical mouse, touch or trackpad devices.',
      'Generated cardinal images and authored synthetic placement do not establish real-world terrain accuracy.',
      'This functional check does not measure GPU timings or performance, mobile Safari or WebGPU.'], close: { attempted: false, completed: false } };
  let page = null, deadlineTimer, evidence;
  const fetchUrl = injected.fetch ?? fetch;
  const controller = new AbortController();
  const execute = async () => {
    const helper = injected.openHeadlessPage ? { openHeadlessPage: injected.openHeadlessPage, identity: { testingInjection: true } } : await installedPageHelper(options.helperVersion);
    report.helper = helper.identity;
    // An unavailable explicit proxy refuses external provider requests. Loopback routes stay live, including workers.
    const launch = { browser: options.browser, mode: 'live', width: 1100, height: 560, binary: options.binary, workers: true, playwright: options.playwright,
      timeouts: { startupMs: 30000, commandMs: LIMITS.commandMs, closeMs: LIMITS.closeMs, exitMs: 5000 },
      chromeArgs: ['--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=127.0.0.1;localhost', '--disable-background-networking'],
      firefoxPrefs: { 'network.proxy.type': 1, 'network.proxy.http': '127.0.0.1', 'network.proxy.http_port': 9, 'network.proxy.ssl': '127.0.0.1', 'network.proxy.ssl_port': 9,
        'network.proxy.no_proxies_on': '127.0.0.1,localhost', 'network.proxy.allow_hijacking_localhost': false },
      proxy: { server: 'http://127.0.0.1:9', bypass: '127.0.0.1,localhost' } };
    page = await helper.openHeadlessPage(options.browser, path.join(options.output, 'profile'), launch);
    report.product = page.product; report.pid = page.facts?.pid ?? null;
    const evaluate = expression => { controller.signal.throwIfAborted(); return page.evaluate(expression); };
    const until = async (expression, label, timeoutMs = LIMITS.conditionMs) => {
      const end = Date.now() + timeoutMs;
      for (;;) {
        controller.signal.throwIfAborted();
        const value = await evaluate(expression);
        if (value) return value;
        if (Date.now() >= end) throw new Error(`Timed out waiting for ${label}.`);
        await sleep(200);
      }
    };
    const check = (name, value, assertion) => { assertion(value); report.assertions.push({ name, observed: value }); };
    const screenshot = async label => {
      controller.signal.throwIfAborted();
      const bytes = await page.screenshot(), file = `${label}.png`;
      await writeFile(path.join(options.output, file), bytes, { flag: 'wx' });
      report.screenshots.push({ path: file, sha256: digest(bytes), sizeBytes: bytes.length });
    };
    const testUrl = (base, dev = false) => {
      const url = new URL(base); url.searchParams.set('panoramaTest', '1'); url.searchParams.set('bench', '1'); url.searchParams.set('renderer', options.backend === 'webgl1' ? 'webgl' : 'webgl2');
      url.searchParams.set('set.app.checkPublished', 'false'); if (dev) url.searchParams.set('dev', '1'); return url.href;
    };
    const startup = async (base, dev = false) => {
      await page.navigate(testUrl(base, dev));
      await until(`(() => { const error = document.querySelector('.boot-error'); if (error) throw new Error(error.textContent); return Boolean(${TEST}?.runtime && ${APP} && document.querySelector('.hud-bar')); })()`, 'actual application runtime', LIMITS.startupMs);
      // A fixed globe view keeps the coarse no-provider fallback visible and
      // avoids treating legitimate uniform close-up imagery as a blank renderer.
      await evaluate(`${APP}.setViewState({ latDeg: 0, lonDeg: 0, headingDeg: 0, pitchDeg: 0, zoomMeters: 8000000 }); true`);
      return evaluate(`new Promise((resolve, reject) => {
        const app = ${APP}, runtime = ${TEST}.runtime, scene = runtime.scene, engine = scene.getEngine();
        const timer = setTimeout(() => { scene.onAfterRenderObservable.remove(observer); reject(new Error('No rendered frame')); }, 10000);
        const observer = scene.onAfterRenderObservable.addOnce(async () => {
          clearTimeout(timer);
          try {
            const width = engine.getRenderWidth(), height = engine.getRenderHeight();
            const readback = await engine.readPixels(0, 0, width, height), rgba = new Uint8Array(readback.buffer, readback.byteOffset, readback.byteLength), step = Math.max(4, Math.floor(rgba.length / 4096 / 4) * 4);
            const colors = new Set(); let min = 255, max = 0, samples = 0, nontransparent = 0;
            for (let p = 0; p + 3 < rgba.length; p += step) { samples++; if (rgba[p + 3]) nontransparent++; colors.add(rgba[p] + ',' + rgba[p + 1] + ',' + rgba[p + 2]); min = Math.min(min, rgba[p], rgba[p + 1], rgba[p + 2]); max = Math.max(max, rgba[p], rgba[p + 1], rgba[p + 2]); }
            const active = scene.getActiveMeshes(), canvas = document.querySelector('#globeCanvas'), rect = canvas.getBoundingClientRect();
            resolve({ bootError: document.querySelector('.boot-error')?.textContent ?? null, canvases: document.querySelectorAll('#root canvas.globe-canvas').length,
              canvasVisible: rect.width > 100 && rect.height > 100 && getComputedStyle(canvas).visibility === 'visible', mode: runtime.renderer.mode, webGLVersion: engine.webGLVersion,
              camera: Boolean(scene.activeCamera), frameId: scene.getFrameId(), mapMeshes: active.data.slice(0, active.length).filter(mesh => mesh.name === 'fallback-globe' || mesh.metadata?.mapSurface).map(mesh => mesh.name),
              pixels: { samples, distinct: colors.size, range: max - min, nontransparent }, renderSize: { width, height }, info: engine.getInfo?.() ?? null,
              fallbackReason: runtime.renderer.fallbackReason ?? null, view: app.getViewState() });
          } catch (error) { reject(error); }
        });
        runtime.requestRender();
      })`);
    };
    const plus = `document.querySelector('[data-side="right"] [aria-label="Open new tab"], [aria-label="Open right panel"], [aria-label="Open new tab"]')`;
    const menu = async dev => {
      await evaluate(`${plus}.click(); true`);
      await until(`Boolean(document.querySelector('[role="menu"]')) && getComputedStyle(document.querySelector('[role="menu"]')).visibility !== 'hidden'`, 'the tab menu');
      const observed = await evaluate(`(() => { const items = [...document.querySelectorAll('[role="menuitem"]')].map(item => ({ label: item.textContent.trim(), ...(() => { const r = item.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; })() }));
        return { labels: [...new Set([...items.map(item => item.label), ...[...document.querySelectorAll('.foss-earth-tab-button')].map(item => item.textContent.trim())])], items, width: innerWidth, limit: Math.min(innerHeight, document.querySelector('.hud-bar').getBoundingClientRect().top) }; })()`);
      check(dev ? 'Dev opted in and standard tabs present' : 'Standard tabs and Dev absent', observed, value => assertMenu(value, dev));
      return observed;
    };
    const openTab = async label => {
      await evaluate(`(() => { const label = ${JSON.stringify(label)}; const button = [...document.querySelectorAll('[role="menuitem"], .foss-earth-tab-button')].find(item => item.textContent.trim() === label); if (!button) throw new Error('Tab unavailable: ' + label); button.click(); return true; })()`);
      await until(`Boolean([...document.querySelectorAll('.foss-earth-tab-shell-selected .foss-earth-tab-button')].find(item => item.textContent.trim() === ${JSON.stringify(label)}))`, `${label} selected`);
    };
    const compiledReceipt = await fetchUrl(new URL('/__earth_test__/server-receipt.json', options.appUrl), { signal: controller.signal }).then(response => { if (!response.ok) throw new Error('Missing canonical fixture server receipt.'); return response.json(); });
    check('Canonical app compiled byte map', compiledReceipt, value => { if (value.mode !== 'app' || value.sourceRevision !== options.sourceRevision || value.compiledArchiveSha256 !== options.compiledSha256 || value.compiledManifestSha256 !== options.compiledManifestSha256 || value.verifiedFiles < 1) throw new Error('The canonical server is not bound to the requested exact compiled application.'); });
    const initial = await startup(options.appUrl);
    const driver = JSON.stringify(initial.info ?? {});
    report.graphics = { driver: initial.info, software: /SwiftShader|llvmpipe|software raster/i.test(driver) ? true : 'unknown', hardwareGpuConfirmed: false, gpuTiming: 'not measured' };
    check('One actual rendered globe', initial, value => assertRenderedGlobe(value, options.backend)); await screenshot('app-startup');
    const initialMapHud = await evaluate(`(${observeMapHudLayout.toString()})()`);
    check('Default map controls: actual compact geometry', initialMapHud, value => assertMapHudLayout(value, 'compact'));
    check('Basemap provider: actual styled text', initialMapHud, assertMapSourceTypography);
    // The shared page driver cannot resize the window, and this check runs at 1100×560.
    await evaluate(`document.documentElement.style.setProperty('--foss-hud-right', '400px'); true`);
    const narrowMapHud = await until(`(() => { const value = (${observeMapHudLayout.toString()})(); return value.bar && Math.abs(value.bar.right - (value.viewport.width - 400)) < 2 ? value : null; })()`, 'narrow toolbar');
    check('Narrow toolbar: north stays at the bottom-left and the provider stays on that row', narrowMapHud, value => assertMapHudLayout(value, 'compact'));
    await evaluate(`document.documentElement.style.removeProperty('--foss-hud-right'); true`);
    await until(`(() => { const bar = document.querySelector('.hud-bar'); return bar && bar.getBoundingClientRect().right > innerWidth - 30; })()`, 'toolbar width restored');

    // Exercise the actual Map controls before unrelated navigation assertions.
    // The external proxy remains closed: this proves session activation and
    // lifecycle reuse, not successful requests with a valid Google credential.
    await menu(false); await openTab('Map');
    const liveGoogle = await evaluate(`(() => {
      const runtime = ${TEST}.runtime, scene = runtime.scene, engine = runtime.engine;
      const origin = performance.timeOrigin, root = document.querySelector('#root');
      const initiallyMissing = !runtime.status.googleApiKeyProvided;
      const row = document.querySelector('[data-parameter="map.source.googleKey"]');
      const input = row?.querySelector('input[type="password"]');
      const save = [...(row?.querySelectorAll('button') ?? [])].find(button => button.textContent === 'Save');
      const google = document.querySelector('input[name="foss-earth-map-source"][value="google"]');
      if (!input || !save || !google || input.disabled || save.disabled || google.disabled) throw new Error('Missing or disabled Google key/source controls.');
      input.value = 'earth-browser-synthetic-key'; save.click();
      const savedKeyAvailable = runtime.status.googleApiKeyProvided;
      google.click();
      return { initiallyMissing, savedKeyAvailable, mode: runtime.status.mode, sameRuntime: ${TEST}.runtime === runtime,
        sameScene: ${TEST}.runtime.scene === scene, sameEngine: ${TEST}.runtime.engine === engine,
        sameDocument: performance.timeOrigin === origin && document.querySelector('#root') === root,
        canvases: document.querySelectorAll('#root canvas.globe-canvas').length };
    })()`);
    check('Google key save and selection activate without reload', liveGoogle, assertLiveGoogleActivation);
    await evaluate(`(() => {
      document.querySelector('input[name="foss-earth-map-source"][value="usgs-imagery-topo"]').click();
      const row = document.querySelector('[data-parameter="map.source.googleKey"]');
      [...row.querySelectorAll('button')].find(button => button.textContent === 'Clear').click();
      return true;
    })()`);
    check('Synthetic Google credential cleared', await evaluate(`!${TEST}.runtime.status.googleApiKeyProvided`), value => { if (!value) throw new Error('The synthetic Google credential was not cleared.'); });
    const before = initial.view;
    await evaluate(`${APP}.setViewState({ latDeg: 44.9, lonDeg: -93.1, headingDeg: 35, pitchDeg: 30, zoomMeters: 8000000 }); true`);
    const after = await until(`(() => { const view = ${APP}.getViewState(); return view && Math.abs(view.headingDeg - 35) < 0.1 && view.zoomMeters > 7000000 ? view : null; })()`, 'public application camera navigation');
    check('Navigation changes the live camera', { before, after }, value => { if (JSON.stringify(value.before) === JSON.stringify(value.after)) throw new Error('Camera navigation did not change the rendered view.'); });
    await screenshot('app-navigation');
    const wheelBefore = await evaluate(`${APP}.getViewState().zoomMeters`);
    await evaluate(`(() => { const canvas = document.querySelector('#globeCanvas'), rect = canvas.getBoundingClientRect(); canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, deltaX: 0, deltaMode: 0, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, bubbles: true, cancelable: true })); return true; })()`);
    const wheelAfter = await until(`(() => { const zoom = ${APP}.getViewState().zoomMeters; return Math.abs(zoom - ${JSON.stringify(wheelBefore)}) > 1 ? zoom : null; })()`, 'synthetic wheel navigation');
    report.assertions.push({ name: 'Synthetic wheel input reaches the live camera', observed: { beforeMeters: wheelBefore, afterMeters: wheelAfter, input: 'synthetic DOM wheel, not physical device input' } });
    await menu(false); await screenshot('app-menu');
    await evaluate(`(document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); true`);
    check('Escape closes the menu', await until(`!document.querySelector('[role="menu"]')`, 'menu dismissal'), value => { if (!value) throw new Error('Escape failed.'); });
    await menu(false); await openTab('About');
    const about = await until(`(() => { const element = document.querySelector('.foss-earth-about__tree'); return element && { text: element.textContent, built: JSON.parse(document.getElementById('foss-earth-built-from').textContent) }; })()`, 'About source composition');
    check('About names exact app owner', about, value => { if (!JSON.stringify(value.built.app).includes(options.sourceRevision) || !JSON.stringify(value.built.app).includes('foss-earth/app')) throw new Error('About did not name the exact application source owner.'); });
    await screenshot('app-about');
    await menu(false); await openTab('Map');
    const mapPanel = await until(`(() => { const bodies = [...document.querySelectorAll('.foss-earth-dock-panel-body')].filter(element => element.getBoundingClientRect().height > 0); const element = bodies.find(body => body.textContent.includes('Basemap')); return element ? { text: element.textContent, inputs: element.querySelectorAll('input,select,button').length } : null; })()`, 'the Map tab controls');
    check('Map owns the source and detail settings', mapPanel, value => { if (!value.text.includes('Detail') || value.inputs < 1) throw new Error('The Map tab did not show its detail controls.'); });
    await screenshot('app-map-settings');
    await evaluate(`document.querySelector('#themeButton').click(); true`);
    const theme = await evaluate(`({ visible: document.documentElement.dataset.theme, saved: JSON.parse(localStorage.getItem('foss-earth.settings.v1')).values['interface.theme'] })`);
    check('Theme toolbar persists the shared setting', theme, value => { if (!['light', 'dark'].includes(value.visible) || value.saved !== value.visible) throw new Error('Theme did not persist.'); });
    const reloaded = await startup(options.appUrl);
    check('Reload still renders the globe', reloaded, value => assertRenderedGlobe(value, options.backend));
    check('Saved theme survives reload', await evaluate(`document.documentElement.dataset.theme`), value => { if (value !== theme.visible) throw new Error('Reload lost the theme.'); });

    const mapLayout = async expected => {
      const observed = await until(`(() => { const value = (${observeMapHudLayout.toString()})(); return value.layout === ${JSON.stringify(expected)} ? value : null; })()`, `map HUD ${expected} layout`);
      check(`Map controls: ${expected} geometry and bottom-right placement`, observed, value => assertMapHudLayout(value, expected));
      check(`Basemap text: ${expected} layout`, observed, assertMapSourceTypography);
    };
    const chooseMapLayout = async choice => {
      await menu(false); await openTab('Interface');
      await evaluate(`(() => {
        const input = document.querySelector('[data-parameter="interface.mapHud.layout"] input[value="${choice}"]');
        if (!input) throw new Error('Missing map-control layout setting.');
        const section = input.closest('details.foss-earth-panel-section');
        if (section && !section.open) section.querySelector('summary').click();
        return true;
      })()`);
      await until(`(() => { const input = document.querySelector('[data-parameter="interface.mapHud.layout"] input[value="${choice}"]'); return input && input.getBoundingClientRect().width > 0; })()`, 'visible map-control layout choice');
      await evaluate(`document.querySelector('[data-parameter="interface.mapHud.layout"] input[value="${choice}"]').click(); true`);
      await mapLayout(choice);
    };
    await chooseMapLayout('expanded'); await screenshot('map-controls-expanded');
    const expandedReload = await startup(options.appUrl);
    check('Expanded reload retains one globe', expandedReload, value => assertRenderedGlobe(value, options.backend));
    await mapLayout('expanded');
    await chooseMapLayout('compact'); await screenshot('map-controls-compact');
    const compactReload = await startup(options.appUrl);
    check('Compact reload retains one globe', compactReload, value => assertRenderedGlobe(value, options.backend));
    await mapLayout('compact');

    // This source is test metadata over the existing generated JPEG; no second runtime or local image implementation.
    await evaluate(`(() => { const runtime = ${TEST}.runtime;
      runtime.setTerrainSource({ id: 'earth-browser-no-dem', label: 'No DEM fixture', provider: 'Earth test', urlTemplate: location.origin + '/__earth_test__/no-dem/{z}/{x}/{y}.png', maxZoom: 0, attribution: 'No elevation data; coarse bounds only' });
      runtime.setMapSource({ id: 'earth-browser-cardinal', label: 'Cardinal image fixture', provider: 'Earth test', protocol: 'xyz',
        urlTemplate: location.origin + '/app/examples/panorama-scenes/media/cardinal-grid/preview-256/px.jpg', kind: 'photographic', version: '1',
        tileSize: { width: 256, height: 256 }, requestPolicy: { prefetch: false, maxConcurrent: 2 }, minZoom: 0, maxZoom: 2,
        attribution: 'Generated cardinal and grid test panorama, FOSS Earth' }); return true; })()`);
    await until(`${TEST}.runtime.status.displayedRasterBaseMap?.id === 'earth-browser-cardinal'`, 'local fixture imagery adoption');
    report.assertions.push({ name: 'Local image fixture adopted by the existing map runtime', observed: await evaluate(`({ mode: ${TEST}.runtime.status.mode, source: ${TEST}.runtime.status.displayedRasterBaseMap.id, renderer: ${TEST}.runtime.renderer.mode })`) });
    await evaluate(`${TEST}.scenes.load(location.origin + '/__earth_test__/scene.json'); true`);
    const preview = await until(`(() => { const status = ${TEST}.scenes.handle()?.status; return status?.entries[0]?.preview === 'ready' && status.entries[0].placement === 'placed' ? { sceneId: status.sceneId, entries: status.entries.map(entry => ({ id: entry.id, preview: entry.preview, placement: entry.placement })) } : null; })()`, 'scene image preview and placement');
    check('Scene fixture uses the existing preview/image owners', preview, value => { if (value.sceneId !== 'earth-browser-cardinal' || value.entries.length !== 1) throw new Error('Wrong fixture scene.'); });
    const entered = await evaluate(`(async () => { const result = await ${TEST}.scenes.handle().enter('cardinal-orb'); return { result, status: ${TEST}.scenes.handle().status }; })()`);
    check('Scene enters an actual image', entered, value => { if (!value.result.ok || value.status.active !== 'cardinal-orb' || value.status.phase !== 'immersive' || !value.status.renderingAvailable) throw new Error('The image did not enter immersion.'); });
    const imageDraw = await until(`(() => { const renderer = ${TEST}.renderer; return renderer?.drawRecords().some(record => record.target === 'immersion') ? { records: renderer.drawRecords().slice(-4) } : null; })()`, 'actual immersion shader draw');
    report.assertions.push({ name: 'The shared viewer rendered immersion', observed: imageDraw }); await screenshot('app-immersion');
    const exited = await evaluate(`(async () => { const result = await ${TEST}.scenes.handle().exit(); return { result, status: ${TEST}.scenes.handle().status }; })()`);
    check('Scene exits and releases image navigation', exited, value => { if (!value.result.ok || value.status.active !== null || value.status.phase !== 'overview') throw new Error('Image navigation was not released.'); });
    await evaluate(`${TEST}.scenes.unload(); true`);
    check('Scene unload removes the current handle', await until(`!${TEST}.scenes.handle()`, 'scene unload'), value => { if (!value) throw new Error('Scene handle remained.'); });

    const optedIn = await startup(options.appUrl, true); check('Dev startup retains one rendered globe', optedIn, value => assertRenderedGlobe(value, options.backend));
    await menu(true); await openTab('Dev');
    const contribution = await until(`(() => { const section = document.querySelector('[data-contribution-id="earth-runtime"]'); const body = section?.querySelector('pre'); return body ? { title: section.querySelector('h3').textContent, data: JSON.parse(body.textContent) } : null; })()`, 'Earth host Dev contribution');
    check('Dev mounts the host contribution', contribution, value => { if (value.title !== 'Earth runtime' || value.data.renderer !== (options.backend === 'webgl1' ? 'webgl' : 'webgl2') || !value.data.resources) throw new Error('Dev did not mount host observations.'); });
    await screenshot('app-dev');

    const siteReceipt = await fetchUrl(new URL('/__earth_test__/server-receipt.json', options.landingUrl), { signal: controller.signal }).then(response => response.json());
    check('Landing serves the exact app bytes', siteReceipt, value => { if (value.mode !== 'landing' || value.sourceRevision !== options.sourceRevision || value.compiledArchiveSha256 !== options.compiledSha256 || value.compiledManifestSha256 !== options.compiledManifestSha256 || value.byteMapSha256 !== compiledReceipt.byteMapSha256) throw new Error('Landing changed the exact app artifact.'); });
    const landed = await startup(options.landingUrl); check('Landing /app/ starts the same actual app', landed, value => assertRenderedGlobe(value, options.backend)); await screenshot('landing-app-startup');
    await evaluate(`${TEST}.settings.set('app.keepFiles', true); true`);
    const worker = await until(`(async () => { if (!navigator.serviceWorker) throw new Error('Service workers unavailable in this live browser'); const registration = await navigator.serviceWorker.getRegistration('/app/'); return registration?.active && navigator.serviceWorker.controller ? { scope: registration.scope, script: registration.active.scriptURL, controlledBy: navigator.serviceWorker.controller.scriptURL } : null; })()`, 'the live app service worker', 45000);
    check('Live worker is confined to /app/', worker, value => { const expected = new URL('/app/', options.landingUrl).href; if (value.scope !== expected || value.script !== expected + 'foss-earth-sw.js' || value.controlledBy !== value.script) throw new Error('Worker scope or controlling script escaped /app/.'); });
    const assets = await evaluate(`performance.getEntriesByType('resource').map(entry => entry.name).filter(name => new URL(name).origin === location.origin).map(name => new URL(name).pathname)`);
    check('Actual application assets resolve below /app/', assets, value => { if (!value.some(name => name.startsWith('/app/assets/') && name.endsWith('.js')) || value.some(name => name.startsWith('/assets/'))) throw new Error('Actual compiled asset routes escaped /app/.'); });
    controller.signal.throwIfAborted();
    await page.navigate(new URL('/', options.landingUrl).href);
    const landing = await until(`document.readyState === 'complete' && document.querySelector('a[href="/app/"]') ? { title: document.title, canvases: document.querySelectorAll('canvas').length, controlled: Boolean(navigator.serviceWorker?.controller), text: document.body.textContent, appLink: document.querySelector('a[href="/app/"]').href } : null`, 'thin landing root');
    check('Landing root is independent of the app worker', landing, value => { if (value.canvases !== 0 || value.controlled || value.appLink !== options.landingUrl.href) throw new Error('Landing root was composed or controlled by the app.'); });
    const rootWorker = await fetchUrl(new URL('/foss-earth-sw.js', options.landingUrl), { signal: controller.signal });
    check('No root app worker is published', rootWorker.status, value => { if (value !== 404) throw new Error('A root-scoped app worker was published.'); });
    await screenshot('landing-root');
    report.status = 'passed';
  };
  try {
    // Abort the next bounded command/condition rather than leave an orphaned execute() promise racing cleanup.
    deadlineTimer = setTimeout(() => controller.abort(new Error('The bounded Earth browser run exceeded 300 seconds.')), LIMITS.totalMs);
    await execute();
  } catch (error) {
    report.status = 'failed'; report.failures.push(sanitizeText(error instanceof Error ? error.message : error));
    if (page) { try { const bytes = await page.screenshot(); await writeFile(path.join(options.output, 'failure.png'), bytes, { flag: 'wx' }); report.screenshots.push({ path: 'failure.png', sha256: digest(bytes), sizeBytes: bytes.length }); } catch (error) { report.failures.push(`Failure screenshot: ${sanitizeText(error)}`); } }
  } finally {
    clearTimeout(deadlineTimer);
    if (page) {
      report.close.attempted = true;
      try { const result = await page.close(); report.close.completed = true; report.close.exit = result ?? null; } catch (error) { report.status = 'failed'; report.failures.push(`Browser close: ${sanitizeText(error)}`); }
      try { evidence = page.captureEvidence(); } catch (error) { report.status = 'failed'; report.failures.push(`Evidence snapshot: ${sanitizeText(error)}`); }
      if (report.close.completed) { try { assertGracefulExit(report.close.exit, evidence); report.close.graceful = true; } catch (error) { report.status = 'failed'; report.close.graceful = false; report.failures.push(sanitizeText(error.message)); } }
    }
    if (evidence) { report.browserFacts = evidence.facts; await writeFile(path.join(options.output, 'browser-evidence.json'), JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' }); }
    report.finishedAt = new Date().toISOString();
    await writeFile(path.join(options.output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  }
  return report;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const report = await runEarthSuite(parseOptions(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify({ owner: report.owner, status: report.status, browser: report.product ?? report.browser, assertions: report.assertions.length, failures: report.failures, close: report.close })}\n`);
  process.exitCode = report.status === 'passed' ? 0 : 1;
}
