import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertReleaseDirectory } from './agent-release-privacy.mjs';
import { packMobileRuntime, stageRuntimeDecoder } from './mobile-runtime-pack.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(await readFile(path.join(root, 'sdk/release.json'), 'utf8'));
const { version: previewVersion } = JSON.parse(await readFile(path.join(root, 'packages/preview/package.json'), 'utf8'));
const output = path.join(root, 'dist/mobile-sdk');
await mkdir(output, { recursive: true });
const distribution = await packMobileRuntime(path.join(root, 'sdk/ios/Sources/FilensPreview/Resources/filens'), path.join(output, '.runtime-build'));
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
  for (const file of ['filens.js.br', 'mobile.html', 'mobile.js', 'archive/7zz.wasm.br', 'xlsx/pcre2.wasm.br', 'THIRD-PARTY-NOTICES.txt.br']) {
    await stat(path.join(runtime, file));
  }
  await rm(runtime, { recursive: true, force: true });
  await mkdir(runtime, { recursive: true });
  await writeFile(path.join(runtime, 'README.txt'), 'Run node prepare-runtime.mjs at the SDK ZIP root before building the app. All offline assets are included in runtime.zpaq.\n');
  await cp(distribution.archivePath, path.join(directory, 'runtime.zpaq'));
  await cp(distribution.indexPath, path.join(directory, 'runtime-index.json'));
  await cp(path.join(root, 'sdk/mobile/prepare-runtime.mjs'), path.join(directory, 'prepare-runtime.mjs'));
  await stageRuntimeDecoder(path.join(directory, 'tooling'));
  const notices = path.relative(directory, path.join(runtime, 'THIRD-PARTY-NOTICES.txt.br')).replaceAll(path.sep, '/');
  await writeFile(path.join(directory, 'LICENSE'), await readFile(path.join(root, 'LICENSE'), 'utf8') +
    `\nThird-party components\n\nComplete copyright notices and license texts are preserved in runtime.zpaq and restored to ${notices} by node prepare-runtime.mjs. The host-only decoder's notices are in tooling/COPYING.\n\nUpstream: https://github.com/orca-zhang/filens\nAndroid Brotli: https://github.com/google/brotli\n`);
  for (const guide of ['README.md', 'README.zh-CN.md']) {
    await cp(path.join(root, 'sdk', guide), path.join(directory, 'sdk', guide));
  }
  await writeFile(path.join(directory, 'manifest.json'), `${JSON.stringify({
    version, previewVersion, platform, kind: 'source-sdk-with-offline-assets', assetEncoding: 'br', preparationRequired: true, watermark: 'FiLens'
  }, null, 2)}\n`);
  const instructions = platform === 'ios'
    ? 'After preparing assets, add sdk/ios as a local Swift Package in Xcode and link FilensPreview. Requires iOS 15+ and Swift 5.9+.'
    : 'Include sdk/android/filens-preview as an Android Library module, or run gradle -p sdk/android :filens-preview:assembleRelease using JDK 17+, Gradle 8.9 and Android SDK 35. Requires Android API 26+ and a current Android System WebView. The offline runtime is already included. This is a source SDK; it is not a precompiled AAR.';
  await writeFile(path.join(directory, 'README.md'), `# FiLens ${platform === 'ios' ? 'iOS' : 'Android'} SDK ${version}\n\nFirst run \`node prepare-runtime.mjs\` once at this directory. Requires Node.js 18+ and a C++17 compiler (included in Xcode Command Line Tools; clang++ / g++ also work). All asset data and decoder source are included; preparation works offline. It runs on the developer computer, never in the phone app. Later runs reuse prepared assets.\n\n${instructions}\n\nRuntime: filens-preview ${previewVersion}. Complete offline formats, shared frontend/WASM, default FiLens watermark. The app uses fast streamed assets. Keep LICENSE and full THIRD-PARTY-NOTICES.txt.br after preparation.\n\n[Integration guide](sdk/README.md) · [简体中文](sdk/README.zh-CN.md). Full AAR/IPA builds and physical-device validation remain pending.\n`);
  await assertReleaseDirectory(directory);
  const file = `${name}.zip`;
  await rm(path.join(output, file), { force: true });
  const result = spawnSync('zip', ['-9', '-X', '-q', '-r', file, name], { cwd: output, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`SDK ZIP failed: ${result.stderr}`);
  const verified = spawnSync('unzip', ['-tq', path.join(output, file)], { encoding: 'utf8' });
  if (verified.status !== 0) throw new Error('SDK ZIP integrity check failed');
  const bytes = await readFile(path.join(output, file));
  if (bytes.length >= 3 * 1048576) throw new Error(`${file} exceeds the mobile SDK ZIP budget of 3 MiB: ${bytes.length} bytes`);
  const item = { platform, file, bytes: bytes.length, unpackedBytes: await totalBytes(directory),
    runtimeBytes: distribution.archiveBytes, preparedRuntimeBytes: distribution.preparedBytes, decodedRuntimeBytes: distribution.index.bytes,
    sha256: createHash('sha256').update(bytes).digest('hex') };
  packages.push(item);
  console.log(`${file}: ${(item.bytes / 1048576).toFixed(2)} MiB transfer / ${(item.unpackedBytes / 1048576).toFixed(2)} MiB extracted`);
}
const report = { date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()),
  version, previewVersion, assetEncoding: 'br', distributionEncoding: 'zpaq-host-only', preparationRequired: true, zipLimitBytes: 3 * 1048576,
  scope: 'Complete offline source SDK ZIPs smaller than 3 MiB. Run the included node prepare-runtime.mjs on the developer computer before integration; all asset data and C++ decoder sources are included. Strong decompression never runs on the phone. runtimeBytes measures the distribution payload, preparedRuntimeBytes the app-ready Brotli assets, decodedRuntimeBytes their decoded contents. Native apps retain streamed reads, lazy modules and all offline formats. Not precompiled AAR/XCFramework artifacts. Excludes external build tools and filesystem allocation overhead.', packages };
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
