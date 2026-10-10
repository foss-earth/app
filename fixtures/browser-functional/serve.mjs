#!/usr/bin/env node
/** Explicit test server over canonical compiled bytes. It never builds or acquires tools. */
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const APP_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const HERE = fileURLToPath(new URL('.', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.wasm': 'application/wasm' };

export function checkedRelative(value) {
  if (typeof value !== 'string' || !value || value.startsWith('/') || value.includes('\\') || value.split('/').some(part => !part || part === '.' || part === '..') || /[\x00-\x1f]/.test(value)) throw new Error('Unsafe compiled file path.');
  return value;
}

export async function verifyCompiled(root, manifest) {
  if (manifest.schemaVersion !== 1 || manifest.owner !== 'foss-earth/app' || manifest.base !== '/app/' || !/^[a-f0-9]{40}$/.test(manifest.sourceRevision) || !/^[a-f0-9]{64}$/.test(manifest.archive?.sha256) || !Array.isArray(manifest.files) || !manifest.files.length) throw new Error('Invalid exact compiled app manifest.');
  const map = new Map();
  for (const file of manifest.files) {
    const relative = checkedRelative(file.path);
    if (map.has(relative) || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0) throw new Error('Invalid or duplicate compiled file receipt.');
    const target = path.join(root, relative);
    if (!(await lstat(target)).isFile() || await realpath(target) !== target) throw new Error('Compiled inputs must be regular canonical files, without symbolic links.');
    const bytes = await readFile(target);
    if (bytes.length !== file.sizeBytes || hash(bytes) !== file.sha256) throw new Error(`Compiled byte receipt mismatch: ${relative}`);
    map.set(relative, file);
  }
  if (!map.has('index.html') || !map.has('foss-earth-sw.js')) throw new Error('This real-origin floor requires a compiled app and its app-scoped service worker.');
  const byteMapSha256 = hash(JSON.stringify([...map.values()].sort((a, b) => a.path.localeCompare(b.path))));
  return { map, receipt: { schemaVersion: 1, owner: 'foss-earth/app', sourceRevision: manifest.sourceRevision, compiledArchiveSha256: manifest.archive.sha256, byteMapSha256, verifiedFiles: map.size } };
}

export function requestPath(url) {
  const parsed = new URL(url, 'http://127.0.0.1');
  const value = decodeURIComponent(parsed.pathname);
  if (value.includes('\\') || /[\x00-\x1f]/.test(value) || value.split('/').some(part => part === '.' || part === '..')) throw new Error('Unsafe request route.');
  return value;
}

export async function startFixtureServer({ mode, root, receiptPath, receiptSha256 }) {
  if (!['app', 'landing'].includes(mode)) throw new Error('Explicit --mode=app or --mode=landing required.');
  const port = mode === 'app' ? 4180 : 4181;
  const canonical = path.join(APP_ROOT, mode === 'app' ? 'dist' : '../foss-earth.github.io/dist');
  const resolvedRoot = await realpath(path.resolve(root));
  if (resolvedRoot !== path.resolve(canonical)) throw new Error('Only the canonical app/dist or canonical landing/dist may be served.');
  const manifestBytes = await readFile(receiptPath);
  if (!/^[a-f0-9]{64}$/.test(receiptSha256) || hash(manifestBytes) !== receiptSha256) throw new Error('Compiled manifest does not match its external trusted digest.');
  const manifest = JSON.parse(manifestBytes);
  const archivePath = path.join(path.dirname(path.resolve(receiptPath)), checkedRelative(manifest.archive?.path));
  if (!(await lstat(archivePath)).isFile() || await realpath(archivePath) !== archivePath) throw new Error('The compiled archive must be a regular canonical file.');
  const archiveBytes = await readFile(archivePath);
  if (archiveBytes.length !== manifest.archive.sizeBytes || hash(archiveBytes) !== manifest.archive.sha256) throw new Error('The compiled archive does not match its exact manifest pin.');
  const appRoot = mode === 'app' ? resolvedRoot : path.join(resolvedRoot, 'app');
  const verified = await verifyCompiled(appRoot, manifest);
  const receipt = { ...verified.receipt, compiledManifestSha256: receiptSha256, mode, url: `http://127.0.0.1:${port}/app/`, serverPid: process.pid,
    limits: { requests: 4000, requestBytes: 16 * 1024 * 1024, lifetimeMs: 1200000 }, syntheticTerrain: 'No DEM endpoint; failures retain coarse bounds and are not terrain accuracy evidence.' };
  let requests = 0;
  const server = createServer(async (request, response) => {
    try {
      if (++requests > receipt.limits.requests) { response.writeHead(429); response.end('Bounded fixture request limit'); return; }
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
      const route = requestPath(request.url);
      if (route === '/__earth_test__/server-receipt.json') { response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(receipt)); return; }
      if (route === '/app') { response.writeHead(308, { Location: '/app/' }); response.end(); return; }
      let file, expected;
      if (route === '/__earth_test__/scene.json') file = path.join(HERE, 'scene.json');
      else if (route.startsWith('/app/')) {
        const relative = checkedRelative(route.slice('/app/'.length) || 'index.html');
        if (!verified.map.has(relative)) { response.writeHead(404); response.end(); return; }
        file = path.join(appRoot, relative); expected = verified.map.get(relative);
      } else if (mode === 'landing' && ['/', '/index.html', '/landing.css'].includes(route)) file = path.join(resolvedRoot, route === '/' ? 'index.html' : route.slice(1));
      else { response.writeHead(404); response.end(); return; }
      if (!(await lstat(file)).isFile() || await realpath(file) !== file) throw new Error('Requested route became a noncanonical file.');
      const bytes = await readFile(file);
      if (expected && (bytes.length !== expected.sizeBytes || hash(bytes) !== expected.sha256)) throw new Error('A served application file drifted after admission.');
      if (bytes.length > receipt.limits.requestBytes) throw new Error('Fixture response exceeds its byte bound.');
      response.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream', 'Content-Length': bytes.length, 'Cache-Control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch { response.writeHead(400); response.end('Invalid fixture request'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  let stopped = false;
  const stop = async () => {
    if (stopped) return; stopped = true; clearTimeout(timer);
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  };
  const timer = setTimeout(() => { void stop(); }, receipt.limits.lifetimeMs);
  return { server, receipt, stop };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const options = new Map(process.argv.slice(2).map(arg => { const found = /^--(mode|root|receipt|receipt-sha256)=(.+)$/.exec(arg); if (!found) throw new Error('Only explicit --mode, --root, --receipt and --receipt-sha256 options are allowed.'); return [found[1], found[2]]; }));
  if (options.size !== 4 || process.argv.slice(2).length !== 4) throw new Error('All four explicit server options are required exactly once.');
  const owned = await startFixtureServer({ mode: options.get('mode'), root: options.get('root'), receiptPath: options.get('receipt'), receiptSha256: options.get('receipt-sha256') });
  const close = signal => { void owned.stop().then(() => { process.stdout.write(JSON.stringify({ event: 'server closed', signal, pid: process.pid }) + '\n'); }); };
  process.once('SIGINT', () => close('SIGINT')); process.once('SIGTERM', () => close('SIGTERM'));
  process.stdout.write(JSON.stringify({ event: 'server ready', ...owned.receipt }) + '\n');
}
