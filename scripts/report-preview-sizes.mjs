import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = async file => JSON.parse(await readFile(path.join(root, file), 'utf8'));
const build = await read('docs/preview-build-sizes.json');
const { version } = await read('packages/preview/package.json');
if (build.version !== version) throw new Error('Rebuild preview runtimes before reporting sizes');
const mb = bytes => (bytes / 1000000).toFixed(2);
const mib = bytes => (bytes / 1048576).toFixed(2);
const split = build.builds.split, recordedSingle = build.builds['all-in-one'];
const delivered = recordedSingle.delivery ?? recordedSingle.main;
const single = { ...recordedSingle, main: delivered, total: { ...recordedSingle.total,
  gzip: recordedSingle.total.gzip - recordedSingle.main.gzip + delivered.gzip,
  brotli: recordedSingle.total.brotli - recordedSingle.main.brotli + delivered.brotli } };
const table = [
  '| Runtime | Raw MB | gzip MB | Brotli MB |', '| --- | ---: | ---: | ---: |',
  ...[['Split main runtime', split.main], ['All-in-one main JS (precompressed)', single.main],
    ['Optional archive WASM + worker (either build)', split.archive],
    ['Split with archive assets', split.total], ['All-in-one with archive assets', single.total]]
    .map(([label, sizes]) => `| ${label} | ${mb(sizes.raw)} | ${mb(sizes.gzip)} | ${mb(sizes.brotli)} |`)
].join('\n');
for (const [file, language] of [['README.md', 'en'], ['README.zh-CN.md', 'zh']]) {
  let source = await readFile(path.join(root, file), 'utf8');
  const text = language === 'zh'
    ? `预览 ${version} 源码构建的主运行时按分包合计 **${mb(split.main.brotli)} MB Brotli**，单 JS 版预压缩产物为 **${mb(single.main.brotli)} MB Brotli / ${mb(single.main.gzip)} MB gzip / ${mb(single.main.raw)} MB 原始体积**；可选压缩包引擎及 Worker 在两种构建中均另计 **${mb(split.archive.brotli)} MB Brotli / ${mb(split.archive.gzip)} MB gzip / ${mb(split.archive.raw)} MB 原始体积**。主运行时已包含 Vue、样式、文档 / 图片 / STEP WASM 与相关 Worker。媒体优先使用浏览器原生支持`
    : `Preview ${version} source-build main runtimes: **${mb(split.main.brotli)} MB Brotli** summed across split files, or **${mb(single.main.brotli)} MB Brotli / ${mb(single.main.gzip)} MB gzip / ${mb(single.main.raw)} MB raw** for the supplied precompressed all-in-one JS. Optional archive WASM and worker add **${mb(split.archive.brotli)} MB Brotli / ${mb(split.archive.gzip)} MB gzip / ${mb(split.archive.raw)} MB raw** to either build. Main runtimes include Vue, styles, document/image/STEP WASM and their workers. Media uses browser codecs`;
  const pattern = language === 'zh' ? /预览 \d+\.\d+\.\d+ (?:源码构建的)?(?:主)?运行时.*?媒体优先使用浏览器原生支持/
    : /Preview \d+\.\d+\.\d+ (?:source-build )?(?:main runtimes|runtime):.*?Media uses browser codecs/;
  if (!pattern.test(source)) throw new Error(`Missing preview size summary: ${file}`);
  source = source.replace(pattern, text);
  await writeFile(path.join(root, file), source);
}
const previewPath = path.join(root, 'packages/preview/README.md');
let preview = await readFile(previewPath, 'utf8');
const start = '<!-- preview-runtime-sizes:start -->', end = '<!-- preview-runtime-sizes:end -->';
const a = preview.indexOf(start), b = preview.indexOf(end);
if (a < 0 || b < a) throw new Error('Missing runtime size table markers');
preview = preview.slice(0, a) + `${start}\n${table}\n${end}` + preview.slice(b + end.length);
await writeFile(previewPath, preview);

let report = `# Preview ${version} source builds and published package sizes\n\nSource runtimes measured ${build.date}; these include current checkout changes and can differ from the published package with the same base version. Runtime rows use **MB = 1,000,000 bytes**. All-in-one rows use the supplied Zopfli gzip and Brotli quality 11 files; other rows use gzip level 9 and Brotli quality 11. Serve the precompressed files with Content-Encoding to obtain these transfer sizes. Main runtimes include Vue, styles, workers and document/image/STEP WASM. Archive sidecars always stay external. Runtime rows exclude HTML, types, README and notices.\n\n${table}\n\n[Exact runtime bytes](preview-build-sizes.json).\n`;
const packed = await read('docs/preview-package-sizes.json');
if (packed.version === version) {
  report += `\n## Published npm package snapshot\n\n| Package | Compressed download | Installed file bytes |\n| --- | ---: | ---: |\n| filens-preview ${version} | ${mib(packed.bytes)} MiB | ${mib(packed.unpackedBytes)} MiB |\n\nThis immutable registry archive was measured separately; the source runtime table above does not describe its exact contents. The npm package includes **both** complete runtime directories, archive assets, types, documentation and license notices. MiB = 1,048,576 bytes; excludes the npm cache and filesystem allocation overhead. [Exact package bytes and SHA-256](preview-package-sizes.json).\n`;
}
try {
  const sdk = await read('docs/mobile-sdk-sizes.json');
  if (sdk.previewVersion === version) {
    report += `\n## Published mobile source SDKs ${sdk.version}\n\nThese release snapshots are measured separately from the current source build above. Each SDK includes the complete offline split runtime ${version}; these are source SDK ZIPs rather than precompiled AAR/XCFramework files.\n\n| SDK | ZIP download | Extracted file bytes |\n| --- | ---: | ---: |\n${sdk.packages.map(item => `| ${item.platform === 'ios' ? 'iOS / Swift Package' : 'Android / Java Library'} | ${mib(item.bytes)} MiB | ${mib(item.unpackedBytes)} MiB |`).join('\n')}\n\nExcludes build tools, build caches and filesystem allocation overhead. [Exact SDK bytes and SHA-256](mobile-sdk-sizes.json).\n`;
  }
} catch (error) { if (error.code !== 'ENOENT') throw error; }
report += '\nCLI measurements are recorded separately in [the npm artifact report](agent-cli-npm-release.json).\n\nRefresh source runtime measurements: `npm run build:preview && npm run report:preview-sizes`. Package and SDK rows use the existing release receipts; measure new release archives separately when preparing a new version.\n';
await writeFile(path.join(root, 'docs/preview-sizes.md'), report);
console.log(`Updated preview ${version} size summaries and docs/preview-sizes.md`);
