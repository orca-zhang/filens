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
const split = build.builds.split, single = build.builds['all-in-one'];
const table = [
  '| Runtime | Raw MB | gzip MB | Brotli MB |', '| --- | ---: | ---: | ---: |',
  ...[['Split main runtime', split.main], ['All-in-one main JS', single.main],
    ['Optional archive WASM + worker (either build)', split.archive],
    ['Split with archive assets', split.total], ['All-in-one with archive assets', single.total]]
    .map(([label, sizes]) => `| ${label} | ${mb(sizes.raw)} | ${mb(sizes.gzip)} | ${mb(sizes.brotli)} |`)
].join('\n');
for (const [file, language] of [['README.md', 'en'], ['README.zh-CN.md', 'zh']]) {
  let source = await readFile(path.join(root, file), 'utf8');
  const text = language === 'zh'
    ? `预览 ${version} 主运行时按分包合计 **${mb(split.main.brotli)} MB Brotli**，单 JS 版为 **${mb(single.main.brotli)} MB Brotli / ${mb(single.main.gzip)} MB gzip / ${mb(single.main.raw)} MB 原始体积**；可选压缩包引擎及 Worker 在两种构建中均另计 **${mb(split.archive.brotli)} MB Brotli / ${mb(split.archive.gzip)} MB gzip / ${mb(split.archive.raw)} MB 原始体积**。主运行时已包含 Vue、样式、文档 / 图片 / STEP WASM 与相关 Worker。媒体优先使用浏览器原生支持`
    : `Preview ${version} main runtimes: **${mb(split.main.brotli)} MB Brotli** summed across split files, or **${mb(single.main.brotli)} MB Brotli / ${mb(single.main.gzip)} MB gzip / ${mb(single.main.raw)} MB raw** for the all-in-one JS. Optional archive WASM and worker add **${mb(split.archive.brotli)} MB Brotli / ${mb(split.archive.gzip)} MB gzip / ${mb(split.archive.raw)} MB raw** to either build. Main runtimes include Vue, styles, document/image/STEP WASM and their workers. Media uses browser codecs`;
  const pattern = language === 'zh' ? /预览 \d+\.\d+\.\d+ (?:主)?运行时.*?媒体优先使用浏览器原生支持/
    : /Preview \d+\.\d+\.\d+ (?:main runtimes|runtime):.*?Media uses browser codecs/;
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

let report = `# Preview ${version} and mobile SDK sizes\n\nMeasured ${build.date}. Runtime rows use **MB = 1,000,000 bytes**. gzip level 9 and Brotli quality 11 measure build artifacts; actual HTTP transfer depends on hosting. Main runtimes include Vue, styles, workers and document/image/STEP WASM. Archive sidecars always stay external. Runtime rows exclude HTML, types, README and notices.\n\n${table}\n\n[Exact runtime bytes](preview-build-sizes.json).\n`;
const packed = await read('docs/preview-package-sizes.json');
if (packed.version === version) {
  report += `\n## npm package\n\n| Package | Compressed download | Installed file bytes |\n| --- | ---: | ---: |\n| filens-preview ${version} | ${mib(packed.bytes)} MiB | ${mib(packed.unpackedBytes)} MiB |\n\nThe npm package includes **both** complete runtime directories, archive assets, types, documentation and license notices. MiB = 1,048,576 bytes; excludes the npm cache and filesystem allocation overhead. [Exact package bytes and SHA-256](preview-package-sizes.json).\n`;
}
try {
  const sdk = await read('docs/mobile-sdk-sizes.json');
  if (sdk.previewVersion === version) {
    report += `\n## Mobile source SDKs ${sdk.version}\n\nEach SDK includes the complete offline split runtime ${version}; these are source SDK ZIPs rather than precompiled AAR/XCFramework files.\n\n| SDK | ZIP download | Extracted file bytes |\n| --- | ---: | ---: |\n${sdk.packages.map(item => `| ${item.platform === 'ios' ? 'iOS / Swift Package' : 'Android / Java Library'} | ${mib(item.bytes)} MiB | ${mib(item.unpackedBytes)} MiB |`).join('\n')}\n\nExcludes build tools, build caches and filesystem allocation overhead. [Exact SDK bytes and SHA-256](mobile-sdk-sizes.json).\n`;
  }
} catch (error) { if (error.code !== 'ENOENT') throw error; }
report += '\nCLI 0.5.0 and ZimaOS 0.5.1 retain their previous release measurements; this preview/SDK release does not rebuild those components.\n\nReproduce: `npm run build:preview`, `npm run report:preview-sizes`, `node scripts/package-preview-npm.mjs --no-build`, `npm run package:sdk:mobile`, then `npm run report:preview-sizes`.\n';
await writeFile(path.join(root, 'docs/preview-sizes.md'), report);
console.log(`Updated preview ${version} size summaries and docs/preview-sizes.md`);
