// Package the universal DSH adapter; native CLI/OCR remain npm dependencies.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertReleaseArchive } from './agent-release-privacy.mjs';
import { npmInvocation } from './agent-platforms.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'integrations/deepseek-harness');
const output = path.join(root, 'dist/dsh-npm');
await mkdir(output, { recursive: true });
const build = spawnSync(process.execPath, ['scripts/build.mjs'], { cwd: source, stdio: 'inherit' });
if (build.error) throw build.error;
if (build.status !== 0) throw new Error('DSH preview build failed');
const npm = npmInvocation(['pack', '--json', '--ignore-scripts', '--pack-destination', output]);
const packed = spawnSync(npm.command, npm.args, { cwd: source, encoding: 'utf8', maxBuffer: 8 << 20 });
if (packed.error) throw packed.error;
if (packed.status !== 0) throw new Error(`DSH npm pack failed: ${packed.stderr}`);
const pkg = JSON.parse(packed.stdout)[0];
const archive = path.join(output, pkg.filename);
assertReleaseArchive(archive);
const support = JSON.parse(await readFile(path.join(source, 'lib/support.json'), 'utf8'));
const metadata = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'));
const release = {
  name: pkg.name, version: pkg.version, file: pkg.filename,
  bytes: pkg.size, unpackedBytes: pkg.unpackedSize,
  sha256: createHash('sha256').update(await readFile(archive)).digest('hex'), integrity: pkg.integrity,
  cliVersion: metadata.dependencies['filens-cli'], previewVersion: support.previewVersion,
  previewSHA256: createHash('sha256').update(await readFile(path.join(source, 'lib/runtime/filens.js'))).digest('hex'),
  extensions: support.extensions.length, privacyChecked: true,
};
await writeFile(path.join(output, 'release.json'), JSON.stringify(release, null, 2) + '\n');
await writeFile(path.join(root, 'docs/dsh-plugin-package.json'), JSON.stringify(release, null, 2) + '\n');
console.log(`${release.name}@${release.version}: ${release.bytes} bytes; CLI ${release.cliVersion}, preview ${release.previewVersion}`);
