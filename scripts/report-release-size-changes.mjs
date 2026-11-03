import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = async file => JSON.parse(await readFile(path.join(root, file), 'utf8'));
const previous = file => JSON.parse(execFileSync('git', ['show', `v0.6.0:${file}`], { cwd: root, encoding: 'utf8' }));
const delta = (before, after) => ({ before, after, bytes: after - before, percent: (after / before - 1) * 100 });
const mib = value => (value / 1048576).toFixed(2);
const percent = value => `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
const build = await read('docs/preview-build-sizes.json');
const oldBuild = previous('docs/preview-build-sizes.json');
const artifacts = await read('docs/preview-release-sizes.json');
const oldArtifacts = previous('docs/preview-release-sizes.json');
const cli = await read('docs/agent-cli-npm-release.json');
const oldCli = previous('docs/agent-cli-npm-release.json');
const rows = oldArtifacts.assets.map(item => {
  const current = artifacts.assets.find(asset => asset.kind === item.kind);
  return { kind: item.kind, file: current.file, download: delta(item.bytes, current.bytes), installed: delta(item.unpackedBytes, current.unpackedBytes) };
});
const runtime = Object.fromEntries(Object.entries(build.builds).map(([mode, value]) => [mode,
  Object.fromEntries(['raw', 'gzip', 'brotli'].map(key => [key, delta(oldBuild.builds[mode].main[key], value.main[key])]))]));
const targets = cli.targets.map(item => {
  const before = oldCli.targets.find(target => target.platform === item.platform);
  return { platform: item.platform, executable: delta(before.binaryBytes, item.binaryBytes),
    lite: delta(before.lite.installedBytes, item.lite.installedBytes), full: delta(before.full.installedBytes, item.full.installedBytes) };
});
let optimization;
if (process.argv[2]) {
  const directory = process.argv[2];
  const before = await read(`${directory}/before/preview-build-sizes.json`);
  const npm = (await read(`${directory}/before/npm-pack.json`))[0];
  const packed = await read('docs/preview-package-sizes.json');
  const iwork = (await read(`${directory}/iwork-before-pack.json`))[0];
  const modules = await read('dist/workspace-npm/release.json');
  const currentIwork = modules.packages.find(pkg => pkg.name === '@filens/iwork');
  optimization = {
    scope: 'Current working-tree build before this review versus the final candidate. Includes small media state continuity changes; package measurements include metadata and notices.',
    singleJs: delta(before.builds['all-in-one'].main.raw, build.builds['all-in-one'].main.raw),
    previewDownload: delta(npm.size, packed.bytes), previewInstalled: delta(npm.unpackedSize, packed.unpackedBytes),
    iworkDownload: delta(iwork.size, currentIwork.bytes), iworkInstalled: delta(iwork.unpackedSize, currentIwork.unpackedBytes)
  };
} else {
  try { optimization = (await read('docs/release-size-changes.json')).optimization; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const report = { date: build.date, tag: artifacts.tag, baseline: 'v0.6.0 (preview/SDK), CLI 0.5.0', unit: 'bytes', runtime, artifacts: rows, cli: targets, optimization };
await writeFile(path.join(root, 'docs/release-size-changes.json'), `${JSON.stringify(report, null, 2)}\n`);
let text = `# Release size changes: ${artifacts.tag}\n\nMeasured ${build.date}. All tables use MiB (1,048,576 bytes). Compare the exact published v0.6.0 preview/SDK artifacts and CLI 0.5.0 with current candidates. Download compression and installed file bytes are separate; filesystem overhead and caches are excluded.\n\n| Artifact | Previous download | Current download | Change | Previous installed | Current installed | Change |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: |\n`;
text += rows.map(row => `| ${row.kind} | ${mib(row.download.before)} | ${mib(row.download.after)} | ${percent(row.download.percent)} | ${mib(row.installed.before)} | ${mib(row.installed.after)} | ${percent(row.installed.percent)} |`).join('\n');
text += '\n\nRuntime rows exclude notices, HTML and archive sidecars. Compression uses gzip level 9 and Brotli quality 11; actual HTTP transfer depends on the server.\n\n| Main runtime | Raw MiB before / after | gzip MiB before / after | Brotli MiB before / after |\n| --- | ---: | ---: | ---: |\n';
text += Object.entries(runtime).map(([mode, sizes]) => `| ${mode} | ${mib(sizes.raw.before)} / ${mib(sizes.raw.after)} | ${mib(sizes.gzip.before)} / ${mib(sizes.gzip.after)} | ${mib(sizes.brotli.before)} / ${mib(sizes.brotli.after)} |`).join('\n');
text += '\n\n| CLI platform | Executable before / after | Lite installed before / after | Full installed before / after |\n| --- | ---: | ---: | ---: |\n';
text += targets.map(row => `| ${row.platform} | ${mib(row.executable.before)} / ${mib(row.executable.after)} | ${mib(row.lite.before)} / ${mib(row.lite.after)} | ${mib(row.full.before)} / ${mib(row.full.after)} |`).join('\n');
if (optimization) {
  text += '\n\n## Savings from this review\n\nThe published release predates HEIF color handling and optional browser video recovery. Those additions still increase compressed preview downloads. Compare the same current source before and after optimization to isolate the savings below.\n\n| Measurement | Before review | Final candidate | Change |\n| --- | ---: | ---: | ---: |\n';
  text += Object.entries(optimization).filter(([, value]) => typeof value === 'object').map(([name, value]) => `| ${name} | ${mib(value.before)} | ${mib(value.after)} | ${percent(value.percent)} |`).join('\n');
}
text += '\n\nOptimizations: compact final standalone JS without changing the existing chunk graph; gzip level 9 for CLI resources; protobuf interface types instead of huge literal declarations; omit debug maps and their references from production module tarballs. Local builds retain their maps. Mobile SDKs remain source SDKs with offline assets, rather than AAR/XCFramework binaries.\n\nshare-front review: FiLens already carries the current canonical Media Engine inputs, including binary-search keyframe lookup and bounded range reads. Ported playback position, paused state, volume, mute and speed continuity at native-to-MSE recovery. No new runtime dependency. Receiver reconnect-specific deadlines and additional audio codec plugins remain outside this adapter.\n\n[Exact byte deltas](release-size-changes.json) · [Runtime measurements](preview-build-sizes.json) · [CLI measurements](agent-cli-npm-release.json).\n\nReproduce current comparisons: `npm run report:release-size-changes`. The optional script argument records a saved before-review measurement directory; the report retains that snapshot for later regeneration.\n';
await writeFile(path.join(root, 'docs/release-size-changes.md'), text);
console.log(`Updated ${artifacts.tag} size comparisons`);
