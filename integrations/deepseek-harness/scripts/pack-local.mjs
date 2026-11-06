// Build a self-contained, unpublished package for this machine. Registry CLI
// 0.5.1 predates memory scratch storage; do not silently test that binary.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmod, copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAgentBinary, compressAgentWASM } from '../../../scripts/agent-rust-build.mjs';
import { setupOCR } from '../../../scripts/setup-agent-ocr.mjs';
import { writeRustLicenses } from '../../../scripts/agent-rust-licenses.mjs';
import { platformPackageName, executableName } from '../../../scripts/agent-platforms.mjs';
import { assertReleaseDirectory, assertReleaseArchive } from '../../../scripts/agent-release-privacy.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const repo = path.resolve(root, '../..');
const platform = `${process.platform}-${process.arch}`;
if (platform !== 'darwin-arm64') throw new Error('This local validation bundle currently targets macOS arm64 only');
const artifacts = path.join(root, 'artifacts');
await mkdir(artifacts, { recursive: true });
const stage = await mkdtemp(path.join(artifacts, 'local-pack-'));
const { version } = JSON.parse(await readFile(path.join(repo, 'packaging/agent-release.json'), 'utf8'));
const coreName = platformPackageName('cli', platform);
const ocrName = platformPackageName('ocr', platform);
const binaryName = executableName(platform);
const dist = path.join(repo, 'dist');
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
  return result.stdout;
}
async function copy(source, target) { await cp(source, target, { recursive: true }); }
try {
  run(process.execPath, ['scripts/build.mjs']);
  await buildAgentBinary(path.join(dist, binaryName));
  await compressAgentWASM(dist);
  await setupOCR(dist);
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  for (const name of pkg.files) await copy(path.join(root, name), path.join(stage, name));
  pkg.os = ['darwin'];
  pkg.cpu = ['arm64'];
  pkg.dependencies['filens-cli'] = version;
  pkg.optionalDependencies = { [coreName]: version, [ocrName]: version };
  pkg.bundledDependencies = [...(pkg.bundledDependencies ?? []), 'filens-cli', coreName, ocrName];
  await copy(path.join(root, 'workspace'), path.join(stage, 'node_modules/@filens/dsh-workspace'));
  delete pkg.scripts;
  delete pkg.devDependencies;
  const launcher = path.join(stage, 'node_modules/filens-cli');
  const core = path.join(stage, 'node_modules', coreName);
  const ocr = path.join(stage, 'node_modules', ocrName);
  for (const directory of [launcher, core, ocr]) await mkdir(directory, { recursive: true });
  const common = { version, type: 'module', license: 'MIT' };
  await writeFile(path.join(launcher, 'package.json'), JSON.stringify({ ...common, name: 'filens-cli', bin: { filens: 'cli.mjs' }, optionalDependencies: pkg.optionalDependencies }));
  await copyFile(path.join(repo, 'packaging/npm/cli.mjs'), path.join(launcher, 'cli.mjs'));
  for (const directory of [launcher, core, ocr]) {
    await copyFile(path.join(repo, 'LICENSE'), path.join(directory, 'LICENSE'));
    await copyFile(path.join(repo, 'packaging/agent-third-party.md'), path.join(directory, 'THIRD-PARTY-NOTICES.md'));
  }
  await mkdir(path.join(launcher, 'scripts'));
  for (const name of ['download-agent-models.mjs', 'model-download.mjs', 'agent-platforms.mjs']) await copyFile(path.join(repo, 'scripts', name), path.join(launcher, 'scripts', name));
  await mkdir(path.join(launcher, 'converter/rapidocr'), { recursive: true });
  await copyFile(path.join(repo, 'converter/rapidocr/models.json'), path.join(launcher, 'converter/rapidocr/models.json'));
  for (const [directory, name] of [[core, coreName], [ocr, ocrName]]) {
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ ...common, name, os: ['darwin'], cpu: ['arm64'] }));
  }
  for (const name of [binaryName, 'converter-text.wasm.gz', 'converter-image.wasm.gz', 'pdfium.wasm.gz']) await copyFile(path.join(dist, name), path.join(core, name));
  await chmod(path.join(core, binaryName), 0o755);
  await copy(path.join(repo, 'packaging/ncnn-licenses'), path.join(core, 'licenses'));
  await writeRustLicenses(path.join(core, 'licenses'));
  await copy(path.join(dist, 'native'), path.join(ocr, 'native'));
  await copy(path.join(repo, 'packaging/ncnn-licenses'), path.join(ocr, 'native/licenses'));
  await copy(path.join(dist, 'models/rapidocr-ncnn'), path.join(ocr, 'models/rapidocr-ncnn'));
  await rm(path.join(ocr, 'models/rapidocr-ncnn/download-report.json'), { force: true });
  const provenance = JSON.parse(await readFile(path.join(ocr, 'native/runtime.json'), 'utf8'));
  for (const artifact of provenance.artifacts ?? []) delete artifact.events;
  await writeFile(path.join(ocr, 'native/runtime.json'), JSON.stringify(provenance, null, 2) + '\n');
  const hash = async file => createHash('sha256').update(await readFile(file)).digest('hex');
  const support = JSON.parse(await readFile(path.join(stage, 'lib/support.json'), 'utf8'));
  pkg.filensLocalBuild = { platform, workspaceDefault: 'memory', workspaceModes: ['memory', 'disk'],
    preview: { version: support.previewVersion, source: support.previewSource, sha256: await hash(path.join(stage, 'lib/runtime/filens.js')) },
    cliSHA256: await hash(path.join(core, binaryName)), ocrSHA256: await hash(path.join(ocr, 'native/libzima_ncnn_runtime_v7.dylib')) };
  await writeFile(path.join(stage, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  await assertReleaseDirectory(stage);
  const packed = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', artifacts], stage))[0];
  const sha256 = await hash(path.join(artifacts, packed.filename));
  const filename = packed.filename.replace(/\.tgz$/, `-${sha256.slice(0, 12)}.tgz`);
  await copyFile(path.join(artifacts, packed.filename), path.join(artifacts, filename));
  await assertReleaseArchive(path.join(artifacts, filename));
  await writeFile(path.join(artifacts, 'local-package.json'), JSON.stringify({ file: filename, version: pkg.version, size: packed.size, sha256, ...pkg.filensLocalBuild }, null, 2) + '\n');
  console.log(path.join(artifacts, filename));
} finally { await rm(stage, { recursive: true, force: true }); }
