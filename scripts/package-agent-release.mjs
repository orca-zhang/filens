// Native, offline GitHub Release bundles built from the same npm components.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertReleaseDirectory } from './agent-release-privacy.mjs';
import { buildAgentBinary } from './agent-rust-build.mjs';
import { executableName, platformPackageName, supportedPlatforms } from './agent-platforms.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tag = process.argv[2];
if (!/^v\d+\.\d+\.\d+$/.test(tag ?? '')) throw new Error('Usage: node scripts/package-agent-release.mjs vX.Y.Z');
const read = async file => JSON.parse(await readFile(path.join(root, file), 'utf8'));
const release = await read('dist/npm/release.json');
const { version } = await read('packaging/agent-release.json');
const { version: previewVersion } = await read('packages/preview/package.json');
if (release.version !== version || supportedPlatforms.some(platform => !release.targets.includes(platform))) {
  throw new Error('Build all current CLI npm components before packaging native bundles');
}
const directory = path.join(root, 'dist/github-release-native', tag);
await mkdir(directory, { recursive: true });
const assets = [];
for (const platform of supportedPlatforms) {
  const core = path.join(root, 'dist/npm', platformPackageName('cli', platform));
  const ocr = path.join(root, 'dist/npm', platformPackageName('ocr', platform));
  const binary = executableName(platform);
  const label = platform.replace('darwin-', 'macos-').replace('win32-', 'windows-');
  for (const profile of ['lite', 'full']) {
    const name = `filens-${version}-${label}-${profile}`;
    const target = path.join(directory, name);
    await rm(target, { recursive: true, force: true });
    await mkdir(target, { recursive: true });
    for (const file of [binary, 'converter-text.wasm.gz', 'converter-image.wasm.gz', 'pdfium.wasm.gz',
      'LICENSE', 'THIRD-PARTY-NOTICES.md', 'licenses']) {
      await cp(path.join(core, file), path.join(target, file), { recursive: true });
    }
    if (profile === 'full') {
      await buildAgentBinary(path.join(target, binary), { platform });
      for (const file of ['native', 'models']) await cp(path.join(ocr, file), path.join(target, file), { recursive: true });
    }
    await chmod(path.join(target, binary), 0o755);
    await cp(path.join(root, 'packages/preview/dist/all-in-one'), path.join(target, 'preview'), { recursive: true });
    await cp(path.join(root, 'skills/filens'), path.join(target, 'skills/filens'), { recursive: true });
    await writeFile(path.join(target, 'VERSION'), `${version}\n`);
    await writeFile(path.join(target, 'README.md'), `# FiLens CLI ${version} (${label}, ${profile})\n\nExtract the entire bundle and run ${binary}. Keep the WASM resources beside the executable. No Node.js, npm or Python is needed. ${profile === 'full' ? 'Native OCR and verified models are included.' : 'OCR is optional; use the Full bundle for an offline OCR installation.'}\n\nExamples: ${binary} capacity --json; ${binary} read report.pdf --json; ${binary} preview report.pdf --no-open --output preview.html. The offline preview runtime is filens-preview ${previewVersion}; retain its archive sidecars to browse RAR/7z.\n\nmacOS requires 12+ arm64; Linux requires glibc 2.17+; Windows requires Windows 10/11 x64. Native execution was tested on macOS arm64; Linux/Windows bundles are cross-built. Keep all license notices when redistributing.\n`);
    await assertReleaseDirectory(target);
    const file = `${name}.${platform.startsWith('win32-') ? 'zip' : 'tar.gz'}`;
    await rm(path.join(directory, file), { force: true });
    const windows = platform.startsWith('win32-');
    const metadata = process.platform === 'darwin' ? ['--uid=0', '--gid=0', '--uname=root', '--gname=root'] : ['--owner=0', '--group=0'];
    const packed = spawnSync(windows ? 'zip' : 'tar', windows ? ['-X', '-q', '-r', file, name]
      : [...metadata, '-czf', file, name], { cwd: directory, env: { ...process.env, COPYFILE_DISABLE: '1' }, encoding: 'utf8' });
    if (packed.status !== 0) throw new Error(`Native bundle failed: ${packed.stderr}`);
    const verified = spawnSync(windows ? 'unzip' : 'tar', windows ? ['-tq', file] : ['-tzf', file], { cwd: directory, encoding: 'utf8' });
    if (verified.status !== 0) throw new Error(`Native archive integrity check failed: ${file}`);
    const bytes = await readFile(path.join(directory, file));
    assets.push({ file, kind: `cli-${profile}`, platform, bytes: bytes.length, unpackedBytes: await totalBytes(target),
      binaryBytes: (await stat(path.join(target, binary))).size, sha256: createHash('sha256').update(bytes).digest('hex') });
    console.log(`${file}: ${(bytes.length / 1048576).toFixed(2)} MiB`);
  }
}
await writeFile(path.join(directory, 'release.json'), `${JSON.stringify({ version, previewVersion, assets }, null, 2)}\n`);

async function totalBytes(directory) {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    total += entry.isDirectory() ? await totalBytes(file) : (await stat(file)).size;
  }
  return total;
}
