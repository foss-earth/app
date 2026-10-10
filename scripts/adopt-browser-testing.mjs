// Explicit owner development-package adoption; never part of setup or runtime.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, copyFile, mkdir, realpath, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
assert.equal(process.argv.length, 4);
assert.equal(process.argv[2], '--release');
const descriptorPath = path.resolve(process.argv[3]);
const release = JSON.parse(await readFile(descriptorPath, 'utf8'));
assert.equal(release.package, '@foss-earth/browser-testing');
assert.equal(release.version, '0.1.0');
assert.match(release.revision, /^[a-f0-9]{40}$/);
assert.match(release.sha256, /^[a-f0-9]{64}$/);
assert.equal(release.remoteAdmissionVerified, false);
const archive = path.resolve(release.archive);
assert.equal(await realpath(archive), archive);
assert((await lstat(archive)).isFile());
const bytes = await readFile(archive);
assert.equal(bytes.length, release.sizeBytes);
assert.equal(createHash('sha256').update(bytes).digest('hex'), release.sha256);
assert.deepEqual(release.dependencies, {});
for (const entry of ['.', './core', './chrome', './firefox', './page']) {
  assert(release.exports[entry]?.types && release.exports[entry]?.import);
}
const stamp = 'browser-testing-' + release.revision;
const output = path.join(root, 'build/adoption', stamp);
await mkdir(path.dirname(output), { recursive: true });
assert.equal(await realpath(path.dirname(output)), path.dirname(output));
await mkdir(output, { recursive: false });
const manifestPath = path.join(root, 'package.json');
const original = await readFile(manifestPath);
await writeFile(path.join(output, 'package.before.json'), original);
await writeFile(path.join(output, 'package-lock.before.json'), await readFile(path.join(root, 'package-lock.json')));
const pkg = JSON.parse(original);
assert(!pkg.dependencies['@foss-earth/browser-testing'], 'Helper must remain development-only');
assert(!pkg.devDependencies['@foss-earth/browser-testing'], 'Preserve a prior adoption; do not silently overwrite it');
const relativeArchive = 'deps/foss-earth-browser-testing-' + release.revision + '.tgz';
const target = path.join(root, relativeArchive);
await copyFile(archive, target, 1); // COPYFILE_EXCL: preserve a conflicting existing artifact.
pkg.devDependencies['@foss-earth/browser-testing'] = 'file:' + relativeArchive;
pkg.fossEarthBrowserTesting = {
  ...pkg.fossEarthBrowserTesting,
  developmentOnly: true,
  revision: release.revision,
  artifactPath: relativeArchive,
  artifactSha256: release.sha256,
  sizeBytes: release.sizeBytes,
  exports: release.exports,
  installedFiles: release.files,
  status: 'Exact checked local artifact adopted; app assertions/remote acceptance require their own receipts',
};
await writeFile(manifestPath, JSON.stringify(pkg, null, 2) + '\n');
await writeFile(path.join(output, 'receipt.json'), JSON.stringify({
  schemaVersion: 1, descriptorPath, releaseRevision: release.revision,
  archiveSha256: release.sha256, bytes: release.sizeBytes, artifactPath: relativeArchive,
  originalManifestSha256: createHash('sha256').update(original).digest('hex'),
  nextStep: 'Explicit offline lock reconciliation then exact npm ci under the same grant',
  browserAccepted: false,
}, null, 2) + '\n');
console.log(JSON.stringify({ adopted: relativeArchive, developmentOnly: true, receipt: path.join(output, 'receipt.json') }));
