import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { assertGracefulExit, assertLiveGoogleActivation, assertMapHudLayout, assertMapSourceTypography, assertMenu, assertRenderedGlobe, canonicalUrl, parseOptions, runEarthSuite, sanitizeText } from './browser-functional.mjs';
import { checkedRelative, verifyCompiled } from '../../fixtures/browser-functional/serve.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const root = fileURLToPath(new URL('../../', import.meta.url));
const actualShape = { bootError: null, canvases: 1, canvasVisible: true, mode: 'webgl2', webGLVersion: 2, camera: true,
  frameId: 8, mapMeshes: ['fallback-globe'], pixels: { samples: 4096, distinct: 128, range: 80, nontransparent: 4096 } };

test('a shell, boot error, blank buffer and sky-only draw cannot qualify a working globe', () => {
  assert.doesNotThrow(() => assertRenderedGlobe(actualShape));
  for (const change of [{ bootError: 'renderer creation failed' }, { pixels: { samples: 4096, distinct: 1, range: 200, nontransparent: 4096 } },
    { mapMeshes: [] }, { camera: false }, { frameId: 0 }, { canvases: 2 }, { mode: 'webgl', webGLVersion: 1 }]) {
    assert.throws(() => assertRenderedGlobe({ ...actualShape, ...change }));
  }
});

test('Google activation rejects storage-only saves, missing source activation and host recreation', () => {
  const observed = { initiallyMissing: true, savedKeyAvailable: true, mode: 'google-tiles', sameRuntime: true, sameScene: true,
    sameEngine: true, sameDocument: true, canvases: 1 };
  assert.doesNotThrow(() => assertLiveGoogleActivation(observed));
  for (const change of [{ initiallyMissing: false }, { savedKeyAvailable: false }, { mode: 'fallback' }, { sameRuntime: false },
    { sameScene: false }, { sameEngine: false }, { sameDocument: false }, { canvases: 2 }]) {
    assert.throws(() => assertLiveGoogleActivation({ ...observed, ...change }));
  }
});

test('actual map HUD geometry rejects misplaced, stretched, stacked and clipped defaults', () => {
  // Synthetic predicate controls, not a real browser receipt.
  const box = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
  const observed = { layout: 'compact', direction: 'row', viewport: { width: 1100, height: 560 }, worldEdges: null, hiddenCount: 0,
    bar: box(16, 516, 1068, 28), north: box(16, 516, 36, 28), slot: box(868, 516, 216, 28), group: box(868, 516, 216, 28),
    rail: box(872, 516, 41, 28), chip: box(920, 516, 164, 28),
    items: [{ id: 'northButton', ...box(16, 516, 36, 28) }, { id: 'helpButton', ...box(55, 516, 40, 28) }] };
  assert.doesNotThrow(() => assertMapHudLayout(observed));
  for (const change of [{ slot: box(16, 516, 216, 28) }, { direction: 'column' },
    { rail: box(872, 486, 208, 28) }, { rail: box(872, 516, 120, 28) }, { chip: box(920, 516, 200, 28) }]) {
    assert.throws(() => assertMapHudLayout({ ...observed, ...change }));
  }
  const expanded = { ...observed, layout: 'expanded', direction: 'column', bar: box(16, 485, 1068, 59),
    slot: box(796, 485, 288, 59), group: box(796, 485, 288, 59), rail: box(800, 485, 280, 28), chip: box(796, 516, 288, 28) };
  assert.doesNotThrow(() => assertMapHudLayout(expanded, 'expanded'));
  assert.throws(() => assertMapHudLayout(expanded));
  assert.throws(() => assertMapHudLayout({ ...expanded, rail: box(800, 485, 41, 28) }, 'expanded'));
  const flush = { layout: 'compact', direction: 'row', viewport: { width: 1100, height: 560 }, worldEdges: 'flush', hiddenCount: 0,
    bar: box(0, 532, 1100, 28), north: box(0, 532, 30, 28), slot: box(860, 532, 240, 28), group: box(860, 532, 240, 28),
    chip: box(860, 532, 240, 28), rail: box(865, 532, 41, 28),
    items: [{ id: 'northButton', ...box(0, 532, 30, 28) }, { id: 'helpButton', ...box(30, 532, 30, 28) }] };
  assert.doesNotThrow(() => assertMapHudLayout(flush));
  assert.throws(() => assertMapHudLayout({ ...flush, rail: box(800, 532, 41, 28) }));
  const attached = { ...flush, viewport: { width: 800, height: 560 }, hiddenCount: 2, bar: box(0, 532, 400, 28),
    slot: box(60, 532, 180, 28), group: box(60, 532, 180, 28), chip: box(60, 532, 180, 28), rail: box(66, 532, 41, 28) };
  assert.doesNotThrow(() => assertMapHudLayout(attached));
  assert.throws(() => assertMapHudLayout({ ...attached, slot: box(220, 532, 180, 28), group: box(220, 532, 180, 28), chip: box(220, 532, 180, 28), rail: box(226, 532, 41, 28) }));
  const flushExpanded = { ...flush, layout: 'expanded', direction: 'column', bar: box(0, 504, 1100, 56),
    north: box(0, 532, 30, 28), items: [{ id: 'northButton', ...box(0, 532, 30, 28) }],
    slot: box(700, 504, 400, 56), group: box(700, 504, 400, 56), chip: box(700, 504, 400, 56), rail: box(706, 505, 388, 28) };
  assert.doesNotThrow(() => assertMapHudLayout(flushExpanded, 'expanded'));
  // The wrapped bug: buttons lift off the bottom-left and the provider sits on a row under them.
  // The slot still meets the bar's bottom-right, which the old check accepted.
  const wrapped = { ...flush, viewport: { width: 800, height: 560 }, hiddenCount: 2, bar: box(0, 504, 800, 56),
    north: box(0, 504, 30, 28), items: [{ id: 'northButton', ...box(0, 504, 30, 28) }, { id: 'helpButton', ...box(30, 504, 30, 28) }],
    slot: box(560, 532, 240, 28), group: box(560, 532, 240, 28), chip: box(560, 532, 240, 28), rail: box(566, 532, 41, 28) };
  assert.throws(() => assertMapHudLayout(wrapped));
});

test('basemap typography rejects missing styles and browser-default button text', () => {
  // Synthetic negative controls; real computed styles are read by the browser suite.
  const font = { family: 'Menlo, monospace', size: 11, lineHeight: '12.1px', colour: 'rgb(239, 246, 255)' };
  const observed = { typography: { chip: font, provider: { ...font }, label: { ...font } }, providerDisplay: 'inline-flex', labelText: 'World imagery' };
  assert.doesNotThrow(() => assertMapSourceTypography(observed));
  assert.throws(() => assertMapSourceTypography({ ...observed, providerDisplay: 'inline-block' }));
  assert.throws(() => assertMapSourceTypography({ ...observed, labelText: '' }));
  for (const change of [{ family: 'Arial' }, { size: 13.333 }, { lineHeight: 'normal' }, { colour: 'rgb(0, 0, 0)' }]) {
    assert.throws(() => assertMapSourceTypography({ ...observed, typography: { ...observed.typography, provider: { ...font, ...change } } }));
    assert.throws(() => assertMapSourceTypography({ ...observed, typography: { ...observed.typography, label: { ...font, ...change } } }));
  }
});

test('tab composition, explicit Dev opt-in and short-window clipping are acceptance failures', () => {
  const labels = ['Location', 'Controls', 'Interface', 'Settings', 'Map', 'Renderer', 'Sky', 'Date and time', 'Scenes', 'About', 'Bug report', 'Browser data'];
  const menu = { labels, items: [{ label: 'About', left: 10, right: 120, top: 20, bottom: 60 }], width: 1100, limit: 520 };
  assert.doesNotThrow(() => assertMenu(menu, false));
  assert.throws(() => assertMenu({ ...menu, labels: labels.filter(label => label !== 'Scenes') }, false));
  assert.throws(() => assertMenu({ ...menu, labels: [...labels, 'Dev'] }, false));
  assert.doesNotThrow(() => assertMenu({ ...menu, labels: [...labels, 'Dev'] }, true));
  assert.throws(() => assertMenu({ ...menu, items: [{ ...menu.items[0], bottom: 560 }] }, false));
  assert.throws(() => assertMenu({ ...menu, labels: [...labels, 'Flight'] }, false));
});

test('only the frozen canonical routes and explicit WebGL1/WebGL2 floor are accepted', () => {
  assert.equal(canonicalUrl('http://127.0.0.1:4180/app/', 4180).pathname, '/app/');
  for (const value of ['http://localhost:4180/app/', 'http://127.0.0.1:4173/app/', 'http://127.0.0.1:4180/', 'https://example.test/app/',
    'http://user:secret@127.0.0.1:4180/app/', 'http://127.0.0.1:4180/app/?dev=1']) assert.throws(() => canonicalUrl(value, 4180));
  const argv = ['--browser=chrome', '--backend=webgl2', '--url=http://127.0.0.1:4180/app/', '--landing-url=http://127.0.0.1:4181/app/',
    `--output=${path.join(root, 'build', 'validation', 'browser-functional', 'pending-chrome')}`, '--binary=/explicit/chrome',
    `--source-revision=${'a'.repeat(40)}`, `--compiled-sha256=${'b'.repeat(64)}`, `--compiled-manifest-sha256=${'c'.repeat(64)}`, '--helper-version=0.1.0'];
  assert.equal(parseOptions(argv).backend, 'webgl2');
  assert.equal(parseOptions(argv.map(arg => arg === '--backend=webgl2' ? '--backend=webgl1' : arg)).backend, 'webgl1');
  assert.throws(() => parseOptions([...argv, '--browser=firefox']));
  assert.throws(() => parseOptions(argv.map(arg => arg === '--backend=webgl2' ? '--backend=webgpu' : arg)));
  assert.throws(() => parseOptions(argv.map(arg => arg.startsWith('--output=') ? '--output=/tmp/public-output' : arg)));
});

test('an explicit WebGL1 request requires its actual version and cannot pass on WebGL2', () => {
  assert.doesNotThrow(() => assertRenderedGlobe({ ...actualShape, mode: 'webgl', webGLVersion: 1 }, 'webgl1'));
  assert.throws(() => assertRenderedGlobe(actualShape, 'webgl1'));
  assert.throws(() => assertRenderedGlobe({ ...actualShape, mode: 'webgl', webGLVersion: 1 }, 'webgl2'));
});

test('actual runner startup failure closes the acquired page once and retains a cleanup failure', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'earth-browser-close-causal-'));
  let closed = 0;
  try {
    const options = { output: path.join(folder, 'run'), browser: 'chrome', backend: 'webgl2', sourceRevision: 'a'.repeat(40), compiledSha256: 'b'.repeat(64), compiledManifestSha256: 'c'.repeat(64), appUrl: new URL('http://127.0.0.1:4180/app/') };
    const page = { product: 'Causal fake, not a browser acceptance receipt', facts: {}, async navigate() {}, async evaluate() { throw new Error('missing rendered globe'); },
      async screenshot() { throw new Error('no screenshot available'); }, async close() { closed++; throw new Error('browser process did not exit'); },
      captureEvidence() { return { facts: { fixture: true } }; } };
    const report = await runEarthSuite(options, { openHeadlessPage: async () => page,
      fetch: async () => ({ ok: true, json: async () => ({ mode: 'app', sourceRevision: options.sourceRevision, compiledArchiveSha256: options.compiledSha256, compiledManifestSha256: options.compiledManifestSha256, verifiedFiles: 1 }) }) });
    assert.equal(closed, 1); assert.equal(report.status, 'failed'); assert.equal(report.close.attempted, true); assert.equal(report.close.completed, false);
    assert.ok(report.failures.some(value => value.includes('missing rendered globe'))); assert.ok(report.failures.some(value => value.includes('browser process did not exit')));
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('observed forced cleanup or an unknown browser exit cannot pass graceful lifecycle acceptance', () => {
  assert.doesNotThrow(() => assertGracefulExit({ code: 0, signal: null }, { lifecycle: [{ event: 'exit', code: 0, signal: null }] }));
  for (const result of [undefined, { code: 1, signal: null }, { code: null, signal: 'SIGTERM' }, { code: null, signal: 'SIGKILL' }]) assert.throws(() => assertGracefulExit(result));
  for (const event of ['signal', 'graceful-close-timeout', 'forced-close']) assert.throws(() => assertGracefulExit({ code: 0, signal: null }, { lifecycle: [{ event, signal: 'SIGTERM' }, { event: 'exit', code: 0, signal: null }] }));
});

test('constructor failure writes a failed receipt without pretending there was a browser or screenshot', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'earth-browser-causal-'));
  try {
    const options = { output: path.join(parent, 'run'), browser: 'chrome', backend: 'webgl2', sourceRevision: 'a'.repeat(40), compiledSha256: 'b'.repeat(64) };
    const report = await runEarthSuite(options, { openHeadlessPage: async () => { throw new Error('explicit browser binary missing'); } });
    assert.equal(report.status, 'failed'); assert.deepEqual(report.close, { attempted: false, completed: false }); assert.deepEqual(report.screenshots, []);
    assert.equal(JSON.parse(await readFile(path.join(options.output, 'report.json'), 'utf8')).status, 'failed');
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test('the static server rejects altered compiled bytes, duplicate maps and linked files before it listens', async () => {
  const folder = await realpath(await mkdtemp(path.join(os.tmpdir(), 'earth-compiled-causal-')));
  try {
    const entries = [['index.html', '<!doctype html>compiled app'], ['foss-earth-sw.js', 'self.fixture = true;']];
    for (const [name, bytes] of entries) await writeFile(path.join(folder, name), bytes);
    const manifest = { schemaVersion: 1, owner: 'foss-earth/app', base: '/app/', sourceRevision: 'a'.repeat(40), archive: { sha256: 'b'.repeat(64) },
      files: entries.map(([name, bytes]) => ({ path: name, sizeBytes: Buffer.byteLength(bytes), sha256: sha(bytes) })) };
    assert.equal((await verifyCompiled(folder, manifest)).receipt.verifiedFiles, 2);
    await assert.rejects(verifyCompiled(folder, { ...manifest, files: [...manifest.files, manifest.files[0]] }), /duplicate/);
    await writeFile(path.join(folder, 'index.html'), 'unexpected replacement');
    await assert.rejects(verifyCompiled(folder, manifest), /mismatch/);
    await rm(path.join(folder, 'index.html')); await symlink(path.join(folder, 'foss-earth-sw.js'), path.join(folder, 'index.html'));
    await assert.rejects(verifyCompiled(folder, manifest), /regular canonical/);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('unsafe receipt paths and credential-bearing messages are rejected or sanitized', () => {
  for (const value of ['../index.html', '/index.html', 'a/../b', 'a\\b', 'a//b', 'a\0b']) assert.throws(() => checkedRelative(value));
  assert.equal(checkedRelative('assets/worker-12345678.js'), 'assets/worker-12345678.js');
  const text = sanitizeText('https://user:password@example.test/a?token=private#secret /Users/private/project token=hidden');
  assert.equal(text.includes('password@'), false); assert.equal(text.includes('?token'), false); assert.equal(text.includes('/Users/'), false); assert.equal(text.includes('hidden'), false);
});
