import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertNativeArchiveLimit } from './agent-release-limits.mjs';
import { packagePreviewReleaseArchives } from './preview-release-archives.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tag = process.argv[2];
if (!/^v\d+\.\d+\.\d+$/.test(tag ?? '')) throw new Error('Usage: node scripts/package-preview-release.mjs vX.Y.Z');
const read = async file => JSON.parse(await readFile(path.join(root, file), 'utf8'));
const preview = await read('dist/preview-npm/release.json');
const sdk = await read('dist/mobile-sdk/release.json');
const build = await read('docs/preview-build-sizes.json');
const packageMetadata = await read('packages/preview/package.json');
let native;
try { native = await read(`dist/github-release-native/${tag}/release.json`); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (native && native.previewVersion !== preview.version) throw new Error('Native CLI bundles use a different preview runtime');
if (preview.version !== packageMetadata.version || sdk.previewVersion !== preview.version || build.version !== preview.version) {
  throw new Error('Preview, mobile SDK and size reports must use the same runtime version');
}
const directory = path.join(root, 'dist/github-release', tag);
await mkdir(directory, { recursive: true });
if (process.argv.includes('--manifest-only')) {
  const report = await read('docs/preview-release-sizes.json');
  if (report.tag !== tag || report.components.preview !== preview.version || report.components.mobileSdk !== sdk.version) {
    throw new Error('Release report version mismatch');
  }
  for (const expected of report.assets) {
    const actual = await measure(expected.file, expected.kind, expected.unpackedBytes);
    if (actual.sha256 !== expected.sha256 || actual.bytes !== expected.bytes) throw new Error('Release payload changed after measurement');
  }
  await writeManifest(report);
  console.log(`Refreshed ${tag} source manifest and checksums without repackaging payloads`);
  process.exit(0);
}
const assets = await packagePreviewReleaseArchives({
  previewDirectory: path.join(root, 'packages/preview/dist'), releaseDirectory: directory,
  version: preview.version, tag, date: build.date, licensePath: path.join(root, 'LICENSE')
});
for (const item of sdk.packages) {
  await cp(path.join(root, 'dist/mobile-sdk', item.file), path.join(directory, item.file));
  const artifact = await measure(item.file, `source-sdk-${item.platform}`, item.unpackedBytes);
  if (artifact.sha256 !== item.sha256) throw new Error('SDK ZIP differs from the measured artifact');
  assets.push(artifact);
}
for (const item of native?.assets ?? []) {
  await cp(path.join(root, 'dist/github-release-native', tag, item.file), path.join(directory, item.file));
  const artifact = await measure(item.file, item.kind, item.unpackedBytes);
  if (artifact.sha256 !== item.sha256) throw new Error('Native CLI archive differs from the measured artifact');
  assets.push({ ...artifact, platform: item.platform, binaryBytes: item.binaryBytes });
}
// Full bundles contain preview/OCR resources; Lite keeps both optional.
// Keep npm launchers, platform dependencies and library modules on the registry;
// attach the DSH adapter as a distinct plugin download.
for (const source of ['dist/dsh-npm']) {
  const metadata = await read(`${source}/release.json`);
  for (const item of metadata.packages ?? [metadata]) {
    if (assets.some(asset => asset.file === item.file)) throw new Error(`Duplicate release asset: ${item.file}`);
    await cp(path.join(root, source, item.file), path.join(directory, item.file));
    const artifact = await measure(item.file, 'npm-package', item.unpackedBytes);
    if (artifact.sha256 !== item.sha256) throw new Error(`npm archive differs from the measured artifact: ${item.file}`);
    assets.push({ ...artifact, name: item.name, version: item.version ?? metadata.version });
  }
}
const tags = spawnSync('git', ['tag', '--list', '--sort=-v:refname'], { cwd: root, encoding: 'utf8' });
if (tags.status !== 0) throw new Error('Cannot identify the previous release');
const previousRelease = tags.stdout.trim().split('\n').find(value => value && value !== tag);
const report = { date: build.date, tag, previousRelease,
  components: { preview: preview.version, mobileSdk: sdk.version, ...(native ? { cli: native.version } : {}) },
  scope: 'Exact GitHub Release downloads and extracted file bytes. Mobile artifacts are source SDKs with offline assets, not AAR/XCFramework binaries. MiB = 1048576 bytes.', assets };
await writeFile(path.join(root, 'docs/preview-release-sizes.json'), `${JSON.stringify(report, null, 2)}\n`);
await writeManifest(report);
for (const item of assets) console.log(`${item.file}: ${(item.bytes / 1048576).toFixed(2)} MiB`);

async function measure(file, kind, unpackedBytes) {
  const bytes = await readFile(path.join(directory, file));
  assertNativeArchiveLimit({ file, kind, bytes: bytes.length });
  return { file, kind, bytes: bytes.length, ...(unpackedBytes === undefined ? {} : { unpackedBytes }),
    sha256: createHash('sha256').update(bytes).digest('hex') };
}
async function writeManifest(report) {
  const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  if (commit.status !== 0) throw new Error('Cannot identify release source commit');
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
  if (status.status !== 0) throw new Error('Cannot identify release source state');
  const manifestName = `filens-release-${tag}.json`;
  const manifest = { ...report, sourceCommit: commit.stdout.trim(), sourceDirty: Boolean(status.stdout.trim()),
    validation: await read('docs/preview-npm-validation.json') };
  await writeFile(path.join(directory, manifestName), `${JSON.stringify(manifest, null, 2)}\n`);
  const manifestAsset = await measure(manifestName, 'manifest');
  await writeFile(path.join(directory, 'SHA256SUMS'), [...report.assets, manifestAsset].map(item => `${item.sha256}  ${item.file}`).join('\n') + '\n');
}
