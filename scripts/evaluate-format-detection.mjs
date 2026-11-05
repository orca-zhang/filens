// Opt-in experiment: never rewrites production routes or downloads samples/models.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { build } from 'vite';
import { privateRustBuildEnv, privacyIssues } from './agent-release-privacy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const crate = path.join(root, 'wasm/converter-core-rust');
const outputIndex = process.argv.indexOf('--output');
const output = path.resolve(root, outputIndex < 0 ? 'benchmarks/format-detection' : process.argv[outputIndex + 1]);
const temp = await mkdtemp(path.join(os.tmpdir(), 'filens-format-detection-'));
const env = privateRustBuildEnv(root);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const ratio = (n, d) => d ? n / d : null;
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const canonical = extension => ({ jpeg: 'jpg', tif: 'tiff', htm: 'html', stp: 'step', mpeg: 'mpg', bzip2: 'bz2', zstd: 'zst' })[extension] ?? extension;

async function run(command, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, ...options });
    const out = [], err = [];
    child.stdout?.on('data', bytes => out.push(bytes));
    child.stderr?.on('data', bytes => err.push(bytes));
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`${command} exited with ${code}: ${Buffer.concat(err).toString()}`)));
  });
}

async function walk(directory) {
  const files = [];
  for (const entry of (await readdir(path.join(root, directory), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await walk(relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

// Coarse matches are published separately; none count as exact format recovery.
function compatible(expected, detection) {
  const container = detection.container;
  const format = detection.format;
  if (container === 'zip' && new Set(['zip', 'zipx', 'docx', 'dotx', 'docm', 'dotm', 'xlsx', 'xlsm', 'xltx', 'xltm', 'xlam', 'xlsb', 'pptx', 'ppsx', 'potx', 'pptm', 'ppsm', 'potm', 'odt', 'ott', 'ods', 'ots', 'odp', 'otp', 'odg', 'otg', 'odm', 'oth', 'epub', 'cbz', 'apk', 'ipa', 'jar', 'war', 'ear', 'xpi', 'key', 'pages', 'numbers', '3mf', 'kmz', 'sxw', 'stw', 'sxg', 'sxc', 'stc', 'sxi', 'sti', 'sxd', 'std']).has(expected)) return true;
  if (container === 'cfb' && new Set(['doc', 'dot', 'wbk', 'wps', 'wpt', 'xls', 'xlt', 'xla', 'xlk', 'et', 'ett', 'ppt', 'pps', 'pot', 'dps', 'dpt', 'msg', 'oft', 'docx', 'xlsx', 'pptx']).has(expected)) return true;
  if (container === 'tiff' && new Set(['tiff', 'dng', 'nef', 'nrw', 'arw', 'pef', 'cr2', 'rw2', '3fr', 'erf', 'iiq', 'kdc', 'mef', 'mos', 'rwl', 'sr2', 'srf', 'srw']).has(expected)) return true;
  if (container === 'ebml' && ['mkv', 'webm'].includes(expected)) return true;
  if (container === 'ogg' && ['ogg', 'oga', 'ogv', 'opus'].includes(expected)) return true;
  if (format === 'gz' && ['tgz', 'svgz'].includes(expected)) return true;
  if (format === 'bz2' && ['tbz', 'tbz2'].includes(expected)) return true;
  if (format === 'xz' && ['txz'].includes(expected)) return true;
  if (format === 'zst' && ['tzst'].includes(expected)) return true;
  if (format === 'rar' && expected === 'cbr' || format === '7z' && expected === 'cb7' || format === 'tar' && expected === 'cbt') return true;
  if (format === 'ar' && expected === 'deb' || format === 'wim' && ['esd', 'swm'].includes(expected)) return true;
  if (format === 'pdf' && expected === 'ai' || format === 'ps' && ['eps', 'ai'].includes(expected)) return true;
  if (format === 'mp4' && ['m4v', '360v', 'insv', 'lrv', 'lrf'].includes(expected)) return true;
  if (format === 'jpg' && ['pano', 'insp'].includes(expected)) return true;
  if (format === 'ppm' && expected === 'pnm') return true;
  if (format === 'json' && ['gltf', 'ipynb', 'avsc'].includes(expected)) return true;
  if (format === 'html' && ['shtml', 'xhtml', 'xht', 'xhtm'].includes(expected)) return true;
  if (format === 'xml' && ['xhtml', 'xht', 'xhtm', 'svg', 'fb2', 'fodt', 'fods', 'fodp', 'fodg', 'atom', 'rss', 'kml', 'gpx', 'plist', 'pom', 'wsdl', 'xsd', 'xsl', 'xslt', 'csproj', 'fsproj', 'vbproj', 'props', 'targets', 'ttml', 'dfxp'].includes(expected)) return true;
  return false;
}

function classify(sample, detection) {
  if (canonical(detection.format) === sample.expected) return 'exact';
  if (compatible(sample.expected, detection)) return 'containerOrFamily';
  if (!detection.format && !detection.container) return 'unresolved';
  return 'disagreement';
}

function metrics(samples, rows) {
  const counts = { exact: 0, containerOrFamily: 0, unresolved: 0, disagreement: 0 };
  let predictions = 0;
  for (let index = 0; index < samples.length; index++) {
    counts[classify(samples[index], rows[index])]++;
    if (rows[index].format) predictions++;
  }
  return { files: samples.length, ...counts, specificPredictions: predictions,
    exactLabelAgreement: ratio(counts.exact, samples.length),
    exactLabelPrecisionAmongSpecificPredictions: ratio(counts.exact, predictions) };
}

try {
  await mkdir(output, { recursive: true });
  await build({ configFile: false, logLevel: 'silent', build: { outDir: path.join(temp, 'js'), minify: true,
    lib: { entry: { formats: path.join(root, 'packages/core/src/preview/formats.ts'), host: path.join(root, 'packages/converter-client/src/wasi-runner.ts') }, formats: ['es'], fileName: (_format, name) => `${name}.mjs` } } });
  const { listPreviewFormats, inferExtensionFromName, resolveFormatRoute } = await import(pathToFileURL(path.join(temp, 'js/formats.mjs')));
  const { createWasmCoreRunner } = await import(pathToFileURL(path.join(temp, 'js/host.mjs')));
  const supported = new Set(listPreviewFormats().map(row => row.extension));
  const jobs = JSON.parse(await readFile(path.join(root, 'examples/go-wazero-converter/fixtures/manifest.json'))).jobs;
  const declared = new Map(jobs.map(job => [path.posix.normalize(`examples/go-wazero-converter/${job.inputPath}`), job.sourceFormat]));
  const samples = [];
  for (const directory of ['apps/demo/public/samples', 'examples/go-wazero-converter/fixtures']) {
    for (const file of await walk(directory)) {
      const base = path.basename(file);
      if (/^(README|SOURCES|LICENSE|NOTICE)(\.|$)/i.test(base) || /LICENSE/i.test(base) || ['manifest.json', 'formats.json'].includes(base)) continue;
      const label = declared.get(file) ?? inferExtensionFromName(base);
      if (!supported.has(label)) continue;
      const bytes = await readFile(path.join(root, file));
      samples.push({ path: file, label, expected: canonical(label), bytes: bytes.length, sha256: sha256(bytes),
        origin: file.includes('/fixtures/real/') ? 'upstream-real' : file.startsWith('apps/') ? 'demo-mixed' : 'controlled-fixture' });
    }
  }
  const batch = path.join(temp, 'paths.json');
  await writeFile(batch, JSON.stringify(samples.map(row => path.join(root, row.path))));
  const variants = {};
  for (const [variant, feature] of [['signatures', 'format-detection'], ['containers', 'format-detection-containers']]) {
    console.log(`Building ${variant} detector...`);
    const args = ['build', '--locked', '--release', '--manifest-path', path.join(crate, 'Cargo.toml'), '--no-default-features', '--features', feature, '--bin', 'converter-detect'];
    await run('cargo', args);
    const executable = path.join(temp, `detect-${variant}${process.platform === 'win32' ? '.exe' : ''}`);
    await copyFile(path.join(crate, 'target/release', process.platform === 'win32' ? 'converter-detect.exe' : 'converter-detect'), executable);
    const timings = [];
    let rows;
    for (let repeat = 0; repeat < 8; repeat++) {
      const start = performance.now();
      const next = JSON.parse((await run(executable, ['--batch', batch])).toString());
      const elapsed = performance.now() - start;
      rows ??= next;
      assert.deepEqual(next, rows);
      if (repeat) timings.push(elapsed);
    }
    assert.equal(rows.length, samples.length);
    assert(rows.every(row => row.bytesRead <= 256 * 1024));
    await run('cargo', [...args, '--target', 'wasm32-wasip1']);
    const wasm = path.join(output, `converter-detect-${variant}.wasm`);
    await run(process.execPath, [path.join(root, 'node_modules/binaryen/bin/wasm-opt'), path.join(crate, 'target/wasm32-wasip1/release/converter-detect.wasm'), '-Oz', '--enable-bulk-memory', '--enable-nontrapping-float-to-int', '--strip-debug', '--strip-producers', '-o', wasm]);
    const bytes = await readFile(wasm);
    assert.deepEqual(privacyIssues(bytes), []);
    const runner = createWasmCoreRunner({ wasm: bytes });
    // Run every byte-identical sample through the frontend in-memory WASI host.
    // Generic filenames prevent extensions from leaking into content predictions.
    const wasmTimings = [];
    const moduleStart = performance.now();
    await WebAssembly.compile(bytes);
    const compileMs = performance.now() - moduleStart;
    for (let index = 0; index < samples.length; index++) {
      const input = await readFile(path.join(root, samples[index].path));
      const start = performance.now();
      const result = await runner({ args: ['converter-detect', '--input', '/work/input'], files: { '/work/input': input }, captureStdio: true });
      wasmTimings.push(performance.now() - start);
      assert.equal(result.exitCode, 0, result.stderr);
      const [detected] = JSON.parse(result.stdout);
      const { path: _nativePath, ...native } = rows[index];
      const { path: _wasmPath, ...web } = detected;
      assert.deepEqual(web, native, samples[index].path);
    }
    const resultRows = samples.map((sample, index) => ({ ...sample, detection: Object.fromEntries(Object.entries(rows[index]).filter(([key]) => key !== 'path')), outcome: classify(sample, rows[index]) }));
    const byOrigin = Object.fromEntries(['controlled-fixture', 'demo-mixed', 'upstream-real'].map(origin => {
      const indexes = samples.flatMap((sample, index) => sample.origin === origin ? [index] : []);
      return [origin, metrics(indexes.map(index => samples[index]), indexes.map(index => rows[index]))];
    }));
    const byFormat = Object.fromEntries([...new Set(samples.map(row => row.expected))].sort().map(format => {
      const indexes = samples.flatMap((sample, index) => sample.expected === format ? [index] : []);
      return [format, metrics(indexes.map(index => samples[index]), indexes.map(index => rows[index]))];
    }));
    const policies = {};
    for (const scenario of ['original-name', 'no-extension', 'unknown-extension', 'wrong-supported-extension']) {
      const counts = { extensionOnly: 0, extensionThenContent: 0, contentThenExtension: 0 };
      for (let index = 0; index < samples.length; index++) {
        const sample = samples[index], detected = rows[index];
        const name = scenario === 'original-name' ? path.basename(sample.path) : scenario === 'no-extension' ? 'download' : scenario === 'unknown-extension' ? 'download.unknown' : sample.expected === 'png' ? 'download.pdf' : 'download.png';
        const byName = resolveFormatRoute({ name })?.sourceFormat;
        const byContent = detected.format && resolveFormatRoute({ extension: detected.format })?.sourceFormat;
        if (canonical(byName) === sample.expected) counts.extensionOnly++;
        if (canonical(byName || byContent) === sample.expected) counts.extensionThenContent++;
        if (canonical(byContent || byName) === sample.expected) counts.contentThenExtension++;
      }
      policies[scenario] = { files: samples.length, exactLabelMatches: counts };
    }
    variants[variant] = {
      ...metrics(samples, rows), byOrigin, byFormat, policies,
      macroExactLabelAgreement: Object.values(byFormat).reduce((sum, row) => sum + row.exactLabelAgreement, 0) / Object.keys(byFormat).length,
      artifact: { file: path.basename(wasm), sha256: sha256(bytes), rawBytes: bytes.length, gzip9Bytes: gzipSync(bytes, { level: 9 }).length,
        brotli11Bytes: brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length },
      nativeTiming: { scope: 'warm filesystem, whole batch including process startup and JSON output', warmup: 1, repeats: 7, batchMs: timings, medianBatchMs: median(timings), medianMsPerFile: median(timings) / samples.length },
      wasmTiming: { scope: 'Node V8 using frontend in-memory WASI host, one instance per file; input read excluded, input host setup included; one pass in corpus order', compileMs, medianMs: median(wasmTimings), p95Ms: [...wasmTimings].sort((a, b) => a - b)[Math.floor(wasmTimings.length * 0.95)] },
      sampling: { medianBytesRead: median(rows.map(row => row.bytesRead)), maxBytesRead: Math.max(...rows.map(row => row.bytesRead)) },
      disagreements: resultRows.filter(row => row.outcome === 'disagreement'), rows: resultRows,
    };
    console.log(`${variant}: ${samples.length} files; exact ${variants[variant].exact}; unresolved ${variants[variant].unresolved}; disagreements ${variants[variant].disagreement}; gzip ${variants[variant].artifact.gzip9Bytes} bytes`);
  }
  const report = {
    schemaVersion: 1, productionRoutingChanged: false, extraProductionBytes: 0, dependenciesAdded: 0,
    environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model, rust: (await run('rustc', ['--version'])).toString().trim() },
    corpus: { files: samples.length, uniqueContents: new Set(samples.map(row => row.sha256)).size, formats: new Set(samples.map(row => row.expected)).size,
      manifestSha256: sha256(JSON.stringify(samples)),
      labeling: 'Existing conversion manifest sourceFormat, otherwise fixture filename; aliases jpeg/jpg, tif/tiff, htm/html, stp/step, mpeg/mpg, bzip2/bz2, zstd/zst normalized. Labels are not an independent content audit.',
      limitations: ['Development corpus, not a held-out accuracy test. Includes generated and duplicate samples.', 'Original-name extension success is by construction against extension-derived labels, not successful rendering or validation.', 'Label disagreements need review; a filename may itself be wrong.', 'Container/family matches and generic text abstentions do not count as exact matches.', 'Renamed scenarios reuse the same bytes and predictions, not additional independent samples.', 'No MIME hints in routing scenarios; recognized incorrect extensions remain authoritative in extension-first policy.', 'Specific predictions indicate format evidence, not whole-file validation.'],
      developmentReview: ['Initial XML-root rule classified ReadingCard.vue as XML. Added declaration/namespace requirement for generic XML; Vue now abstains. This corpus informed development.', 'sample.shtml/sample.xhtml/sample.xht/sample.xhtm contain HTML doctype/root without an XHTML namespace; HTML is a family match, not exact suffix recovery.', 'No declared 0-disagreement result should be read as a measured zero false-positive rate on independent data.'] },
    variants,
  };
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  const pct = value => `${(100 * value).toFixed(1)}%`;
  const lines = ['# 自研格式识别器原型评估', '',
    '默认预览、CLI 和 Go 路由保持原有行为。识别器是按需编译的独立 WASM，当前生产包新增体积为 0。无模型、无新增依赖。', '',
    `本地语料：${report.corpus.files} 个文件、${report.corpus.uniqueContents} 份不同内容、${report.corpus.formats} 个规范化后缀。标签来自既有转换清单和文件名，因此以下是标签一致率，不能直接宣称为真实世界准确率。`, '',
    '| 原型 | 精确标签一致 | 仅容器/族匹配 | 未确定 | 标签冲突 | WASM 原始 | gzip -9 | Brotli 11 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...Object.entries(variants).map(([name, row]) => `| ${name} | ${row.exact}/${row.files} (${pct(row.exactLabelAgreement)}) | ${row.containerOrFamily} | ${row.unresolved} | ${row.disagreement} | ${row.artifact.rawBytes} B | ${row.artifact.gzip9Bytes} B | ${row.artifact.brotli11Bytes} B |`), '',
    '容器增强版三种路由策略的精确标签匹配数量：', '',
    '| 文件名情形 | 后缀 | 后缀优先、内容兜底 | 内容优先、后缀兜底 |', '| --- | --- | --- | --- |',
    ...Object.entries(variants.containers.policies).map(([name, row]) => `| ${name} | ${row.exactLabelMatches.extensionOnly}/${row.files} | ${row.exactLabelMatches.extensionThenContent}/${row.files} | ${row.exactLabelMatches.contentThenExtension}/${row.files} |`), '',
    `正常文件名后缀命中 ${variants.containers.policies['original-name'].exactLabelMatches.extensionOnly}/${samples.length} 是基于后缀标签构造出来的路由匹配结果，不代表文件内容验证通过或全部预览成功。内容优先会把部分明确后缀降为外层容器/格式族；这些也没有计为精确匹配。`, '',
    '开发中曾把 ReadingCard.vue 误判为 XML，已增加声明/命名空间要求后返回未确定；因此本语料参与了规则修正。HTML/XHTML 等同族标签差异单列统计。没有独立留出集，不能据此推断真实文件的误判率。', '',
    '所有样本都通过前端内存 WASI 宿主运行，并与原生识别输出逐项比对一致。每次读取最多 256 KiB；只有 ZIP 才进入容器检查。ZIP 复用转换核心已有解析器，限制元数据解压长度。', '',
    '当前限制：TIFF/RAW、OLE、EBML、Ogg 只识别容器；不猜测源码语言和 Markdown；ZIP 缺少足够类型声明时返回歧义；压缩的 TAR 仅识别外层压缩格式。签名识别不代替完整文件解析。', '',
    '时延口径：原生统计包含进程启动和整个批次 JSON 输出，文件系统已预热；WASM 使用 Node V8 和真实前端内存宿主，不代表浏览器冷启动或远程下载耗时。编译、每次实例化数据见 report.json。', '',
    '结论：保留已识别后缀的快速路径。此原型适合评估无后缀/未知后缀兜底；暂不按内容自动覆盖正常后缀。后续需独立标注、未参与开发的真实文件集，核实冲突后再决定是否接入。', '',
    '复现：`node scripts/evaluate-format-detection.mjs --output benchmarks/format-detection`。完整逐文件结果、来源分组、按格式宏平均、冲突和产物哈希均在 report.json。', ''];
  await writeFile(path.join(output, 'README.zh-CN.md'), lines.join('\n'));
  console.log(`Report: ${path.relative(root, path.join(output, 'report.json'))}`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
