import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertReleaseDirectory } from './agent-release-privacy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(await readFile(path.join(root, 'sdk/release.json'), 'utf8'));
const { version: previewVersion } = JSON.parse(await readFile(path.join(root, 'packages/preview/package.json'), 'utf8'));
const output = path.join(root, 'dist/mobile-sdk');
await mkdir(output, { recursive: true });
const packages = [];
for (const platform of ['ios', 'android']) {
  const name = `filens-${platform}-sdk-${version}`;
  const directory = path.join(output, name);
  await rm(directory, { recursive: true, force: true });
  const target = path.join(directory, 'sdk', platform);
  await mkdir(target, { recursive: true });
  const paths = platform === 'ios' ? ['Package.swift', 'Sources', 'Tests']
    : ['settings.gradle.kts', 'build.gradle.kts', 'filens-preview/build.gradle.kts',
      'filens-preview/consumer-rules.pro', 'filens-preview/src'];
  for (const file of paths) {
    await mkdir(path.dirname(path.join(target, file)), { recursive: true });
    await cp(path.join(root, 'sdk', platform, file), path.join(target, file), { recursive: true });
  }
  const runtime = path.join(target, platform === 'ios' ? 'Sources/FilensPreview/Resources/filens' : 'filens-preview/src/main/assets/filens');
  for (const file of ['filens.js', 'mobile.html', 'mobile.js', 'archive/7zz.wasm', 'THIRD-PARTY-NOTICES.txt']) {
    await stat(path.join(runtime, file));
  }
  await cp(path.join(root, 'LICENSE'), path.join(directory, 'LICENSE'));
  for (const guide of ['README.md', 'README.zh-CN.md']) {
    await cp(path.join(root, 'sdk', guide), path.join(directory, 'sdk', guide));
  }
  await writeFile(path.join(directory, 'manifest.json'), `${JSON.stringify({
    version, previewVersion, platform, kind: 'source-sdk-with-offline-assets', watermark: 'FiLens © IceWhale'
  }, null, 2)}\n`);
  const instructions = platform === 'ios'
    ? 'Add sdk/ios as a local Swift Package in Xcode and link FilensPreview. Requires iOS 15+ and Swift 5.9+. The offline runtime is already included; npm is not needed to integrate this archive.'
    : 'Include sdk/android/filens-preview as an Android Library module, or run gradle -p sdk/android :filens-preview:assembleRelease using JDK 17+, Gradle 8.9 and Android SDK 35. Requires Android API 26+ and a current Android System WebView. The offline runtime is already included. This is a source SDK; it is not a precompiled AAR.';
  await writeFile(path.join(directory, 'README.md'), `# FiLens ${platform === 'ios' ? 'iOS' : 'Android'} SDK ${version}\n\n${instructions}\n\nRuntime: filens-preview ${previewVersion}. Files are previewed locally with the shared frontend and WASM. Default watermark: FiLens © IceWhale.\n\nSee [the integration guide](sdk/README.md) ([简体中文](sdk/README.zh-CN.md)) for API examples and platform settings. Its source-build instructions refer to the full repository: https://github.com/orca-zhang/filens. Keep LICENSE and the runtime's THIRD-PARTY-NOTICES.txt when redistributing.\n\nNative device validation remains pending; see the integration guide for the exact compile and browser checks.\n`);
  await assertReleaseDirectory(directory);
  const file = `${name}.zip`;
  await rm(path.join(output, file), { force: true });
  const result = spawnSync('zip', ['-X', '-q', '-r', file, name], { cwd: output, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`SDK ZIP failed: ${result.stderr}`);
  const verified = spawnSync('unzip', ['-tq', path.join(output, file)], { encoding: 'utf8' });
  if (verified.status !== 0) throw new Error('SDK ZIP integrity check failed');
  const bytes = await readFile(path.join(output, file));
  const item = { platform, file, bytes: bytes.length, unpackedBytes: await totalBytes(directory),
    runtimeBytes: await totalBytes(runtime), sha256: createHash('sha256').update(bytes).digest('hex') };
  packages.push(item);
  console.log(`${file}: ${(item.bytes / 1048576).toFixed(2)} MiB download / ${(item.unpackedBytes / 1048576).toFixed(2)} MiB extracted`);
}
const report = { date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()),
  version, previewVersion, scope: 'Source SDK ZIPs with complete offline split runtime, archive sidecars, platform source, integration guide and notices. Not precompiled AAR/XCFramework artifacts. Excludes build tools and filesystem allocation overhead.', packages };
await writeFile(path.join(output, 'release.json'), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(path.join(root, 'docs/mobile-sdk-sizes.json'), `${JSON.stringify(report, null, 2)}\n`);

async function totalBytes(directory) {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) total += await totalBytes(file);
    else total += (await stat(file)).size;
  }
  return total;
}
