import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertReleaseArchive, assertReleaseDirectory } from './agent-release-privacy.mjs';
import { npmInvocation } from './agent-platforms.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist/preview-split-npm');
const stage = path.join(output, 'package');
const source = path.join(root, 'packages/preview');
const { version, license, repository, homepage } = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'));

await rm(output, { recursive: true, force: true });
if (!process.argv.includes('--no-build')) {
  const build = spawnSync(process.execPath, [path.join(root, 'scripts/build-preview.mjs')], { cwd: root, stdio: 'inherit' });
  if (build.status !== 0) throw new Error('Preview build failed');
}

await mkdir(path.join(stage, 'dist/split'), { recursive: true });
await cp(path.join(source, 'dist/split'), path.join(stage, 'dist/split'), { recursive: true });
await cp(path.join(source, 'dist/index.d.ts'), path.join(stage, 'dist/index.d.ts'));
await cp(path.join(source, 'LICENSE'), path.join(stage, 'LICENSE'));
await writeFile(path.join(stage, 'README.md'), [
  '# filens-preview-split', '',
  'A split-module browser preview runtime. It loads format engines and WASM only when the selected file needs them.', '',
  '```sh', 'npm install filens-preview-split', '```', '',
  '```js', "import { createPreview } from 'filens-preview-split';", '',
  "const viewer = createPreview('#preview', { src: file, name: file.name });", '```', '',
  'This package contains the split runtime, declarations, license and third-party notices. Use `filens-preview` for the package that also exposes the all-in-one entry.', ''
].join('\n'));
await writeFile(path.join(stage, 'package.json'), `${JSON.stringify({
  name: 'filens-preview-split', version, license, type: 'module',
  description: 'Browser-local file previews with split, lazy-loaded format modules.',
  main: './dist/split/filens.js', module: './dist/split/filens.js', types: './dist/index.d.ts',
  exports: { '.': { types: './dist/index.d.ts', import: './dist/split/filens.js' }, './split/*': './dist/split/*', './package.json': './package.json' },
  files: ['dist', 'README.md', 'LICENSE'], sideEffects: true, repository, homepage,
  publishConfig: { access: 'public', registry: 'https://registry.npmjs.org/' }
}, null, 2)}
`);

await assertReleaseDirectory(stage);
const npm = npmInvocation(['pack', '--json', '--ignore-scripts', '--pack-destination', output]);
const packed = spawnSync(npm.command, npm.args, { cwd: stage, encoding: 'utf8' });
if (packed.status !== 0) throw new Error(`Split preview npm pack failed: ${packed.stderr}`);
const artifact = JSON.parse(packed.stdout)[0];
assert.equal(artifact.name, 'filens-preview-split');
assert.equal(artifact.version, version);
assert(artifact.files.some(file => file.path === 'dist/split/filens.js'));
assert(artifact.files.some(file => file.path === 'dist/index.d.ts'));
assert(artifact.files.some(file => file.path === 'dist/split/THIRD-PARTY-NOTICES.txt'));
assert(!artifact.files.some(file => file.path.includes('all-in-one')));
const file = path.join(output, artifact.filename);
assertReleaseArchive(file);
const bytes = await readFile(file);
const release = { name: artifact.name, version, file: artifact.filename, bytes: artifact.size,
  unpackedBytes: artifact.unpackedSize, sha256: createHash('sha256').update(bytes).digest('hex'),
  integrity: artifact.integrity, files: artifact.files.map(({ path: name, size }) => ({ path: name, bytes: size })),
  privacyChecked: true };
await writeFile(path.join(output, 'release.json'), `${JSON.stringify(release, null, 2)}\n`);
await writeFile(path.join(root, 'docs/preview-split-package-sizes.json'), `${JSON.stringify({
  date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()),
  scope: 'Exact npm pack artifact containing only the split runtime, declarations, README and license notices. Excludes the all-in-one build, npm cache and filesystem allocation overhead.',
  ...release
}, null, 2)}\n`);
console.log(`${release.name}@${version}: ${(release.bytes / 1048576).toFixed(2)} MiB packed, ${(release.unpackedBytes / 1048576).toFixed(2)} MiB installed; not published.`);
