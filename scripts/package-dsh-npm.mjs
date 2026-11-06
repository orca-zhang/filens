// Package the universal DSH adapter; native CLI/OCR remain npm dependencies.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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
const metadata = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'));
const workspaceMetadata = JSON.parse(await readFile(path.join(source, 'workspace/package.json'), 'utf8'));
const stage = path.join(output, 'stage');
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
for (const file of metadata.files) await cp(path.join(source, file), path.join(stage, file), { recursive: true });
const workspaceStage = path.join(stage, 'node_modules/@filens/dsh-workspace');
await mkdir(workspaceStage, { recursive: true });
for (const file of workspaceMetadata.files) await cp(path.join(source, 'workspace', file), path.join(workspaceStage, file), { recursive: true });
await cp(path.join(root, 'LICENSE'), path.join(workspaceStage, 'LICENSE'));
await cp(path.join(source, 'workspace/README.md'), path.join(workspaceStage, 'README.md'));
await writeFile(path.join(workspaceStage, 'package.json'), JSON.stringify(workspaceMetadata, null, 2) + '\n');
// The private workspace ships inside the adapter, retaining its own DSH switch.
metadata.dependencies['@filens/dsh-workspace'] = workspaceMetadata.version;
delete metadata.scripts;
delete metadata.devDependencies;
await writeFile(path.join(stage, 'package.json'), JSON.stringify(metadata, null, 2) + '\n');
async function pack(directory) {
const npm = npmInvocation(['pack', '--json', '--ignore-scripts', '--pack-destination', output]);
const packed = spawnSync(npm.command, npm.args, { cwd: directory, encoding: 'utf8', maxBuffer: 8 << 20 });
if (packed.error) throw packed.error;
if (packed.status !== 0) throw new Error(`DSH npm pack failed: ${packed.stderr}`);
const pkg = JSON.parse(packed.stdout)[0];
const archive = path.join(output, pkg.filename);
assertReleaseArchive(archive);
return {
  name: pkg.name, version: pkg.version, file: pkg.filename,
  bytes: pkg.size, unpackedBytes: pkg.unpackedSize,
  sha256: createHash('sha256').update(await readFile(archive)).digest('hex'), integrity: pkg.integrity,
  privacyChecked: true,
};
}
const adapter = await pack(stage);
const support = JSON.parse(await readFile(path.join(source, 'lib/support.json'), 'utf8'));
const release = { ...adapter,
  cliVersion: metadata.dependencies['filens-cli'], previewVersion: support.previewVersion,
  previewSHA256: createHash('sha256').update(await readFile(path.join(source, 'lib/runtime/filens.js'))).digest('hex'),
  extensions: support.extensions.length, workspaceIncluded: true,
  packages: [adapter],
};
await writeFile(path.join(output, 'release.json'), JSON.stringify(release, null, 2) + '\n');
await writeFile(path.join(root, 'docs/dsh-plugin-package.json'), JSON.stringify(release, null, 2) + '\n');
console.log(`${release.name}@${release.version}: ${release.bytes} bytes; CLI ${release.cliVersion}, preview ${release.previewVersion}`);
