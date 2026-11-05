import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rm, copyFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import { parseArgs } from 'node:util';
import { build } from 'vite';
import { chromium } from '@playwright/test';
import { privateRustBuildEnv, privacyIssues } from './agent-release-privacy.mjs';
import { canonical, outcome, metrics } from './format-detection-metrics.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = path.join(root, 'benchmarks/format-detection');
const { values } = parseArgs({ options: { output: { type: 'string' }, reference: { type: 'string' }, 'current-inputs': { type: 'boolean' }, simd: { type: 'boolean' } } });
const output = values.output ? path.resolve(root, values.output) : path.join(base, 'expanded');
const referenceDirectory = values.reference ? path.resolve(root, values.reference) : null;
assert.notEqual(output, referenceDirectory, 'Comparison artifacts must not overwrite the reference');
const crate = path.join(root, 'wasm/converter-core-rust');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'filens-expanded-detection-'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
async function sourceHashes() {
  const hashes = {};
  for (const source of ['wasm/converter-core-rust/src/format_detection.rs', 'wasm/converter-core-rust/src/format_detection/probes.rs', 'wasm/converter-core-rust/src/format_detection/signatures.rs', 'wasm/converter-core-rust/src/format_detection/text_scan.rs', 'wasm/converter-core-rust/examples/detect_web.rs', 'packages/converter-client/src/format-detector.ts', 'scripts/evaluate-expanded-detection.mjs', 'scripts/prepare-format-detection-corpus.py', 'scripts/format-detection-metrics.mjs', 'wasm/converter-core-rust/Cargo.toml', 'wasm/converter-core-rust/Cargo.lock']) hashes[source] = sha256(await readFile(path.join(root, source)));
  return hashes;
}
const env = { ...privateRustBuildEnv(root), CARGO_INCREMENTAL: '0' };
let browser;
async function run(command, args) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [], err = [];
    child.stdout.on('data', bytes => out.push(bytes)); child.stderr.on('data', bytes => err.push(bytes));
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`${command} exited ${code}: ${Buffer.concat(err)}`)));
  });
}
async function buildVariant(feature, file, batch) {
  const simd128 = feature.split(',').includes('format-detection-simd');
  const args = ['build', '--locked', '--release', '--manifest-path', path.join(crate, 'Cargo.toml'), '--no-default-features', '--features', feature];
  await run('cargo', [...args, '--bin', 'converter-detect']);
  const native = path.join(crate, 'target/release', process.platform === 'win32' ? 'converter-detect.exe' : 'converter-detect');
  const nativeRows = JSON.parse((await run(native, ['--batch', batch])).toString());
  await run('cargo', [...args, '--example', 'detect-web', '--target', 'wasm32-wasip1']);
  const wasmPath = path.join(output, file);
  const optimizer = path.join(root, 'node_modules/binaryen/bin/wasm-opt');
  await run(process.execPath, [optimizer, path.join(crate, 'target/wasm32-wasip1/release/examples/detect_web.wasm'), '-Oz', '--converge', '--enable-bulk-memory', '--enable-nontrapping-float-to-int', ...(simd128 ? ['--enable-simd'] : []), '--strip-debug', '--strip-producers', '-o', wasmPath]);
  const bytes = await readFile(wasmPath);
  assert.deepEqual(privacyIssues(bytes), []);
  if (simd128) {
    const wat = (await run(process.execPath, [optimizer, wasmPath, '--enable-simd', '--enable-bulk-memory', '--enable-nontrapping-float-to-int', '--print'])).toString();
    assert.match(wat, /i8x16\.bitmask/, 'SIMD implementation must contain vector instructions');
  }
  return { bytes, nativeRows, artifact: { file, rawBytes: bytes.length, gzip9Bytes: gzipSync(bytes, { level: 9 }).length,
    brotli11Bytes: brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length, sha256: sha256(bytes) } };
}
function compareTimings(samples, previous, current) {
  assert(samples.length > 0, 'Timing group must contain inputs');
  let repetitions = 1;
  const median = numbers => [...numbers].sort((a, b) => a - b)[Math.floor(numbers.length / 2)];
  const measure = detector => {
    let checksum = 0;
    const start = performance.now();
    for (let repetition = 0; repetition < repetitions; repetition++) {
      for (const bytes of samples) {
        const result = detector.detect(bytes);
        checksum += result.bytesRead + (result.format?.length ?? 0);
      }
    }
    return { ms: (performance.now() - start) / repetitions, checksum };
  };
  for (let warmup = 0; warmup < 3; warmup++) { measure(previous); measure(current); }
  repetitions = Math.max(1, Math.min(128, Math.ceil(10 / measure(previous).ms)));
  const oldTimes = [], newTimes = [];
  for (let trial = 0; trial < 11; trial++) {
    const order = trial % 2 ? ['current', 'previous'] : ['previous', 'current'];
    const checksums = [];
    for (const name of order) {
      const result = measure(name === 'previous' ? previous : current);
      (name === 'previous' ? oldTimes : newTimes).push(result.ms);
      checksums.push(result.checksum);
    }
    assert.equal(checksums[0], checksums[1]);
  }
  return { files: samples.length, trials: oldTimes.length, repetitionsPerTrial: repetitions, previousBatchMs: oldTimes, currentBatchMs: newTimes,
    previousMedianBatchMs: median(oldTimes), currentMedianBatchMs: median(newTimes),
    medianChange: median(newTimes) / median(oldTimes) - 1 };
}
try {
  const sources = await sourceHashes();
  await mkdir(output, { recursive: true });
  let sourceManifestBytes;
  if (referenceDirectory) {
    try { sourceManifestBytes = await readFile(path.join(referenceDirectory, 'corpus-manifest.json')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  sourceManifestBytes ??= await readFile(path.join(base, 'corpus/manifest.json'));
  let manifestBytes = sourceManifestBytes;
  const manifest = JSON.parse(sourceManifestBytes);
  // Revision annotations belong to their comparison, not the next one.
  manifest.files = manifest.files.map(({ previousSha256: _previous, ...row }) => row);
  const inputPaths = manifest.files.map(row => path.join(root, row.path));
  const inputRevisions = [];
  if (values['current-inputs']) {
    // Freeze both native builds and all WASM runs on identical current bytes.
    const snapshot = path.join(temporary, 'inputs');
    await mkdir(snapshot);
    for (let index = 0; index < manifest.files.length; index++) {
      const row = manifest.files[index], original = inputPaths[index];
      inputPaths[index] = path.join(snapshot, String(index));
      // Clone on supporting filesystems; each snapshot remains independent when
      // a source fixture changes, without duplicating the whole corpus on disk.
      await copyFile(original, inputPaths[index], fsConstants.COPYFILE_FICLONE);
      const data = await readFile(inputPaths[index]), hash = sha256(data);
      if (hash !== row.sha256) {
        inputRevisions.push({ path: row.path, previousSha256: row.sha256, currentSha256: hash });
        manifest.files[index] = { ...row, sha256: hash, bytes: data.length, previousSha256: row.sha256 };
      }
    }
    manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  }
  await writeFile(path.join(output, 'corpus-manifest.json'), manifestBytes);
  const previousReport = JSON.parse(await readFile(path.join(base, 'optimized/report.json')));
  const reference = previousReport.variants.containers.optimizedArtifact;
  const oldWasm = await readFile(path.join(base, 'optimized', reference.file));
  assert.equal(sha256(oldWasm), reference.sha256);
  await build({ configFile: false, logLevel: 'silent', build: { outDir: temporary, emptyOutDir: false, minify: true,
    lib: { entry: path.join(root, 'packages/converter-client/src/format-detector.ts'), formats: ['es'], fileName: () => 'format-detector.mjs' } } });
  const binding = await readFile(path.join(temporary, 'format-detector.mjs'));
  await writeFile(path.join(output, 'format-detector.mjs'), binding);
  const { createFormatDetector } = await import(pathToFileURL(path.join(temporary, 'format-detector.mjs')));
  console.log(`Building expanded detector for ${manifest.files.length} files...`);
  const batch = path.join(temporary, 'paths.json');
  await writeFile(batch, JSON.stringify(inputPaths));
  const fullBuild = await buildVariant('format-detection-compound', 'converter-detect-expanded.wasm', batch);
  const lightBuild = await buildVariant('format-detection-expanded', 'converter-detect-expanded-light.wasm', batch);
  const simdBuild = values.simd ? await buildVariant('format-detection-expanded,format-detection-simd', 'converter-detect-expanded-light-simd.wasm', batch) : null;
  const bytes = fullBuild.bytes;
  const detector = await createFormatDetector(bytes), lightDetector = await createFormatDetector(lightBuild.bytes), baseline = await createFormatDetector(oldWasm);
  const simdDetector = simdBuild ? await createFormatDetector(simdBuild.bytes) : null;
  let simd;
  if (simdBuild) simd = { optional: true, defaultBuildRequiresSimd: false, requiresWasmSimd128: true, vectorInstructionsVerified: true,
    feature: 'format-detection-expanded,format-detection-simd', artifact: simdBuild.artifact, referenceArtifact: lightBuild.artifact,
    nativeWasmChecks: 0, unchangedOutputs: 0, randomNegatives: 0, generatedBoundaryChecks: 0, browserSamples: 0 };
  let indexComparison, referenceRows;
  const referenceDetectors = {};
  if (referenceDirectory) {
    const referenceBytes = await readFile(path.join(referenceDirectory, 'report.json'));
    const referenceReport = JSON.parse(referenceBytes);
    assert.equal(referenceReport.corpus.manifestSha256, sha256(sourceManifestBytes));
    referenceRows = new Map(referenceReport.rows.map(row => [row.path, row]));
    indexComparison = { referenceReport: path.relative(root, path.join(referenceDirectory, 'report.json')),
      referenceReportSha256: sha256(referenceBytes),
      implementation: 'One compile-time stable sorted table for both phases; one binary search on a two-byte prefix retains each phase\'s first full-signature/length/guard match. BMFF uses a single ranked brand scan; ZIP/CFB/XML/text avoid temporary collections.',
      fixedSignatures: { base: 38, expanded: 28, tables: 1, binarySearchesPerHeader: 1, maximumBucketCandidates: 2 }, runtimeIndexAllocations: 0, inputRevisions,
      timingScope: 'Warm Node V8 WASM and shared browser ABI; excludes file reads, compilation and instantiation. Alternate previous/current order after three warmups, eleven trials per group. Repeat each trial in batches targeting 10 ms, at most 128 repetitions, and normalize to one corpus sweep. Includes sampling, structural parsing, host calls and output decoding; not an isolated lookup benchmark or browser cold-start measurement.',
      environment: { node: process.versions.node, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model }, variants: {} };
    for (const variant of ['light', 'expanded']) {
      const artifact = referenceReport[variant].artifact;
      const previousBytes = await readFile(path.join(referenceDirectory, artifact.file));
      assert.equal(sha256(previousBytes), artifact.sha256);
      referenceDetectors[variant] = await createFormatDetector(previousBytes);
      indexComparison.variants[variant] = { previousArtifact: artifact, unchangedOutputs: 0 };
    }
  }
  const rows = [];
  const benchmarkInputs = [];
  for (let index = 0; index < manifest.files.length; index++) {
    const sample = manifest.files[index], input = await readFile(inputPaths[index]);
    assert.equal(sha256(input), sample.sha256, sample.path);
    const expanded = detector.detect(input), light = lightDetector.detect(input), old = baseline.detect(input);
    if (simdDetector) {
      const actual = simdDetector.detect(input), { path: _path, ...native } = simdBuild.nativeRows[index];
      assert.deepEqual(actual, light, `SIMD: ${sample.path}`);
      assert.deepEqual(actual, native, `SIMD/native: ${sample.path}`);
      simd.nativeWasmChecks++; simd.unchangedOutputs++;
    }
    for (const [prediction, nativeRows] of [[expanded, fullBuild.nativeRows], [light, lightBuild.nativeRows]]) {
      const { path: _path, ...native } = nativeRows[index];
      assert.deepEqual(prediction, native, sample.path);
      assert(prediction.bytesRead <= 256 * 1024, sample.path);
    }
    if (indexComparison) {
      assert.equal(referenceRows.get(sample.path)?.sha256, sample.previousSha256 ?? sample.sha256);
      for (const [variant, current] of [['light', light], ['expanded', expanded]]) {
        const previous = referenceDetectors[variant].detect(input);
        if (!sample.previousSha256) assert.deepEqual(previous, referenceRows.get(sample.path)[variant], sample.path);
        assert.deepEqual(current, previous, `${variant}: ${sample.path}`);
        indexComparison.variants[variant].unchangedOutputs++;
      }
      benchmarkInputs.push(input);
    }
    if (simdDetector && !indexComparison) benchmarkInputs.push(input);
    rows.push({ ...sample, baseline: old, light, expanded, baselineOutcome: outcome(sample.label, old), lightOutcome: outcome(sample.label, light), expandedOutcome: outcome(sample.label, expanded) });
  }
  // Deterministic unrelated data and signature lookalikes, published separately.
  const negatives = [];
  let state = 0x81f20e43;
  for (let index = 0; index < 2048; index++) {
    const input = new Uint8Array(16 + index % 1024);
    for (let p = 0; p < input.length; p++) { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; input[p] = state & 255; }
    for (const [variant, instance] of [['expanded', detector], ['light', lightDetector]]) {
      const detected = instance.detect(input);
      if (detected.format || detected.container) negatives.push({ index, variant, sha256: sha256(input), detection: detected });
    }
    if (simdDetector) {
      assert.deepEqual(simdDetector.detect(input), lightDetector.detect(input), `SIMD random ${index}`);
      simd.randomNegatives++;
    }
  }
  const misleading = ['AC10 is a sentence', 'BZhello world', 'normal text mentioning word/ and PK', '<template><p>Photo</p></template>', '{"broken":', 'BEGIN:VCALENDAR is mentioned in prose', 'SQLite format is discussed here'];
  const lookalikes = misleading.map(text => ({ text, baseline: baseline.detect(new TextEncoder().encode(text)), light: lightDetector.detect(new TextEncoder().encode(text)), expanded: detector.detect(new TextEncoder().encode(text)) }));
  assert.equal(negatives.length, 0, 'Random binary negatives should abstain');
  for (const row of lookalikes) for (const variant of ['light', 'expanded']) {
    assert.equal(row[variant].format, null, row.text);
    assert.equal(row[variant].container, null, row.text);
  }
  if (simdDetector) {
    const check = input => {
      assert.deepEqual(simdDetector.detect(input), lightDetector.detect(input), `SIMD boundary ${simd.generatedBoundaryChecks}`);
      simd.generatedBoundaryChecks++;
    };
    // Every byte value around vector/sample boundaries, not just random noise.
    for (const length of [0, 1, 15, 16, 17, 31, 32, 33, 63, 64, 65, 127, 128, 129, 8191, 8192, 8193]) {
      const input = new Uint8Array(length).fill(65);
      const bomInput = new Uint8Array(length + 3);
      bomInput.set([239, 187, 191]);
      const checkAlignedAndBom = () => {
        check(input);
        bomInput.set(input, 3);
        check(bomInput);
      };
      checkAlignedAndBom();
      for (const position of [0, 1, 14, 15, 16, 17, 30, 31, 32, 46, 47, 48, 49, 62, 63, 64, 65, 126, 127, 128, 8190, 8191, 8192]) {
        if (position >= length) continue;
        for (let byte = 0; byte < 256; byte++) { input[position] = byte; checkAlignedAndBom(); }
        input[position] = 65;
      }
      if (length > 1) { input[0] = 0; input[length - 1] = 255; checkAlignedAndBom(); }
    }
    const encoder = new TextEncoder();
    for (const source of [...misleading, '中文内容', '\ufeff<svg xmlns="http://www.w3.org/2000/svg"/>', '\u0085', '中\u0000\ufffd']) check(encoder.encode(source));
    for (const position of [14, 15, 16, 30, 31, 32, 47, 48, 63, 64, 127, 128, 8190, 8191, 8192]) {
      for (const suffix of ['中', '😀', '\u0085', '\ufffd']) {
        const input = encoder.encode('A'.repeat(position) + suffix);
        for (let cut = 0; cut < 4; cut++) check(input.subarray(0, Math.max(0, input.length - cut)));
      }
    }
  }
  browser = await chromium.launch();
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let browserInput;
  await page.route('http://localhost/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html>' });
    if (pathname === '/host.mjs') return route.fulfill({ contentType: 'text/javascript', body: binding });
    if (pathname === '/module.wasm') return route.fulfill({ contentType: 'application/wasm', body: bytes });
    if (pathname === '/light.wasm') return route.fulfill({ contentType: 'application/wasm', body: lightBuild.bytes });
    if (pathname === '/simd.wasm' && simdBuild) return route.fulfill({ contentType: 'application/wasm', body: simdBuild.bytes });
    if (pathname === '/sample') return route.fulfill({ contentType: 'application/octet-stream', body: browserInput });
    return route.abort();
  });
  await page.goto('http://localhost/');
  await page.evaluate(async () => { const { createFormatDetector } = await import('/host.mjs'); window.detectors = {
    expanded: await createFormatDetector(await (await fetch('/module.wasm')).arrayBuffer()),
    light: await createFormatDetector(await (await fetch('/light.wasm')).arrayBuffer()) }; });
  if (simdDetector) await page.evaluate(async () => {
    const { createFormatDetector } = await import('/host.mjs');
    window.detectors.simd = await createFormatDetector(await (await fetch('/simd.wasm')).arrayBuffer());
  });
  const checkedByVariant = { expanded: new Set(), light: new Set() };
  for (const row of rows) {
    for (const variant of ['expanded', 'light']) {
      if (row[`${variant}Outcome`] !== 'exact' || checkedByVariant[variant].has(canonical(row.label))) continue;
      browserInput = await readFile(inputPaths[rows.indexOf(row)]);
      const result = await page.evaluate(async name => window.detectors[name].detect(new Uint8Array(await (await fetch('/sample')).arrayBuffer())), variant);
      assert.deepEqual(result, row[variant], row.path);
      if (simdDetector && variant === 'light') {
        const actual = await page.evaluate(async () => window.detectors.simd.detect(new Uint8Array(await (await fetch('/sample')).arrayBuffer())));
        assert.deepEqual(actual, row.light, `SIMD browser: ${row.path}`);
        simd.browserSamples++;
      }
      checkedByVariant[variant].add(canonical(row.label));
    }
  }
  const checked = checkedByVariant.expanded;
  assert.deepEqual(errors, []);
  if (indexComparison) {
    for (const [variant, current] of [['light', lightDetector], ['expanded', detector]]) {
      const filters = { all: () => true, signatures: row => row[variant].evidence === 'signature',
        unresolved: row => !row[variant].format && !row[variant].container,
        bmff: row => row[variant].container === 'isobmff',
        structuredContainers: row => row[variant].container && row[variant].evidence === 'structure' };
      indexComparison.variants[variant].timing = Object.fromEntries(Object.entries(filters).map(([group, include]) =>
        [group, compareTimings(benchmarkInputs.filter((_, index) => include(rows[index])), referenceDetectors[variant], current)]));
    }
  }
  if (simdDetector) {
    const textProbe = row => !row.light.container && ['text', 'structure'].includes(row.light.evidence);
    const asciiHead = input => {
      const head = input.subarray(0, 8192), bom = head[0] === 239 && head[1] === 187 && head[2] === 191;
      return head.subarray(bom ? 3 : 0).every(byte => byte < 128);
    };
    const filters = { all: () => true, asciiText: (row, input) => textProbe(row) && asciiHead(input),
      nonAsciiText: (row, input) => textProbe(row) && !asciiHead(input),
      signatures: row => row.light.evidence === 'signature', unresolved: row => !row.light.format && !row.light.container };
    simd.timing = Object.fromEntries(Object.entries(filters).map(([group, include]) =>
      [group, compareTimings(benchmarkInputs.filter((input, index) => include(rows[index], input)), lightDetector, simdDetector)]));
    simd.maximumObservedMemoryBytes = simdDetector.memoryBytes;
  }
  const byOrigin = Object.fromEntries([...new Set(rows.map(row => row.origin))].map(origin => {
    const group = rows.filter(row => row.origin === origin); return [origin, { baseline: metrics(group, 'baseline'), light: metrics(group, 'light'), expanded: metrics(group, 'expanded') }];
  }));
  const byFormat = Object.fromEntries([...new Set(rows.map(row => canonical(row.label)))].sort().map(format => {
    const group = rows.filter(row => canonical(row.label) === format); return [format, { baseline: metrics(group, 'baseline'), light: metrics(group, 'light'), expanded: metrics(group, 'expanded') }];
  }));
  assert.deepEqual(await sourceHashes(), sources, 'Detector sources changed during evaluation; rerun before publishing results');
  const improvements = rows.filter(row => row.baselineOutcome !== 'exact' && row.expandedOutcome === 'exact');
  const regressions = rows.filter(row => row.baselineOutcome === 'exact' && row.expandedOutcome !== 'exact');
  const lightRegressions = rows.filter(row => row.baselineOutcome === 'exact' && row.lightOutcome !== 'exact');
  assert.equal(regressions.length, 0, 'Full detector regressed');
  assert.equal(lightRegressions.length, 0, 'Light detector regressed');
  const report = { schemaVersion: 4, productionRoutingChanged: false, sources, indexComparison, simd,
    corpus: { manifestSha256: sha256(manifestBytes), files: rows.length, uniqueContents: new Set(rows.map(row => row.sha256)).size, extensions: new Set(rows.map(row => row.label)).size, upstreamCommit: manifest.upstreamCommit, labeling: manifest.labeling,
      limitations: ['Development and regression corpus, not a held-out accuracy test.', 'Upstream test fixtures can be minimal or intentionally incomplete; suffix labels do not establish full validity.', 'Container/family matches never count as exact, and precise different types are not forgiven for sharing a container.', 'Added 2048 deterministic random negatives and prose lookalikes; these do not estimate a real-world false-positive rate.'] },
    baseline: { artifact: reference, ...metrics(rows, 'baseline') },
    light: { artifact: lightBuild.artifact, feature: 'format-detection-expanded', ...metrics(rows, 'light'), nativeWasmChecks: rows.length,
      maximumObservedMemoryBytes: lightDetector.memoryBytes, maximumBytesRead: Math.max(...rows.map(row => row.light.bytesRead)) },
    expanded: { artifact: fullBuild.artifact, feature: 'format-detection-compound',
      ...metrics(rows, 'expanded'), nativeWasmChecks: rows.length, maximumObservedMemoryBytes: detector.memoryBytes, maximumBytesRead: Math.max(...rows.map(row => row.expanded.bytesRead)) },
    byOrigin, byFormat, randomNegatives: { files: 2048, positivePredictions: negatives.length, positives: negatives }, lookalikes,
    binding: { rawBytes: binding.length, gzip9Bytes: gzipSync(binding, { level: 9 }).length },
    browser: { chromium: browser.version(), exactFormatsChecked: checked.size, lightExactFormatsChecked: checkedByVariant.light.size, errors },
    improvements, regressions, lightRegressions,
    disagreements: rows.filter(row => row.expandedOutcome === 'disagreement'), rows };
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  const pct = (n, d) => `${(100 * n / d).toFixed(1)}%`;
  const lines = [indexComparison ? '# 有序签名索引评估' : '# 扩大文件集合后的识别评估', '',
    `集合从 513 扩到 ${rows.length} 个文件，${report.corpus.uniqueContents} 份不同内容、${report.corpus.extensions} 种后缀；包含 ${byOrigin['external-file-type'].expanded.files} 个固定提交的外部测试文件。原数据和新增数据使用相同评分规则。`, '',
    '| 版本 | 精确标签匹配 | 格式族 | 仅容器 | 未确定 | 标签冲突 | WASM gzip -9 |', '| --- | --- | --- | --- | --- | --- | --- |',
    ...['baseline', 'light', 'expanded'].map(name => { const v = report[name]; return `| ${name} | ${v.exact}/${v.files} (${pct(v.exact,v.files)}) | ${v.family} | ${v.container} | ${v.unresolved} | ${v.disagreement} | ${v.artifact.gzip9Bytes} B |`; }), '',
    '`baseline` 为冻结的旧容器版产物；`light` 对应 `format-detection-expanded`，`expanded` 对应 `format-detection-compound`。', '',
    '| 文件来源 | 文件数 | 原版精确匹配 | 轻量扩展版 | 完整扩展版 |', '| --- | --- | --- | --- | --- |',
    ...Object.entries(byOrigin).map(([name,v]) => `| ${name} | ${v.expanded.files} | ${v.baseline.exact} | ${v.light.exact} | ${v.expanded.exact} |`), '',
    `新增 ${report.improvements.length} 个精确标签匹配，原先精确匹配出现 ${report.regressions.length} 个变化。识别规则仍全部在共享前端 WASM 核心，默认后缀路由未改。完整逐格式、逐文件结果和冲突见 report.json。`, '',
    `两个扩展版各有 ${rows.length} 个样本在原生和前端 WASM 输出一致；Chromium 分别核对轻量版 ${checkedByVariant.light.size} 种、完整版 ${checked.size} 种精确匹配格式。各运行随机负例 2048 个，共产生 ${negatives.length} 个正识别；7 个误导性短文本均未识别，另列旧版对照。单次读取不超过 256 KiB，CFB 深入探测限制文件不超过 64 MiB。`, '',
    `轻量扩展版相对旧版增加 ${report.light.artifact.gzip9Bytes - report.baseline.artifact.gzip9Bytes} B gzip、增加 ${report.light.exact - report.baseline.exact} 个精确匹配。完整扩展版额外增加 ${report.expanded.artifact.gzip9Bytes - report.light.artifact.gzip9Bytes} B gzip，换取 ${report.expanded.exact - report.light.exact} 个复合文档精确匹配。两版共享 JS 绑定 ${report.binding.gzip9Bytes} B gzip。`, '',
    '新增范围包括字体/可执行文件、科学数据、JPEG 2000 子格式、EBML/Ogg 子类型、结构化文本/XML、iWork 与应用/文档 ZIP 包。完整版再识别旧版 Word/Excel/PowerPoint 与 Outlook MSG；加密或冲突的复合文档仍只报告容器。源码、Markdown、CSV 等缺少可靠内容依据的文件继续使用后缀。完整格式清单见 report.json 的 byFormat。', '',
    '本报告是标签一致率，不是独立标注、未参与开发的真实世界准确率。外部上游样本包含精简/不完整测试文件；不能为了后缀命中强行识别损坏容器。对于同容器但明确不同的格式，计为冲突。别名/格式族和泛化文本单列，不算精确识别。', '',
    '扩展版复用既有 ZIP/XML 和 Snappy 解析组件；完整版额外复用 CFB。CFB、Snappy 原已在转换器依赖树中，本轮显式链接到可选探测模块，体积增量如表。没有接入外部识别器或模型。', '',
    '复现：`python3 scripts/prepare-format-detection-corpus.py --fetch-upstream`，然后 `node scripts/evaluate-expanded-detection.mjs`。已保留样本后可省略下载，运行准备脚本重建清单。上游固定提交、每个文件来源和 SHA-256、许可证见 ../corpus/。', ''];
  if (indexComparison) {
    const names = { light: '轻量扩展版', expanded: '完整扩展版' };
    const groups = { all: '全部文件', signatures: '签名命中文件', unresolved: '未确定文件', bmff: 'BMFF 媒体容器', structuredContainers: '结构化容器命中' };
    lines.splice(2, 0,
      '基础 38 条和扩展 28 条固定签名合并为一张编译期排序表，每个文件头仅二分一次，在命中组内分别保留两阶段的首个有效候选，原有优先级和校验条件不变。每组至多 2 个候选；加载时无需建树、排序或额外堆分配。DWG 版本号继续二分查找。', '',
      'BMFF 品牌改为一次按优先级扫描，避免临时数组和反复遍历；CFB 根流名、XML 属性与解释器行直接遍历，ZIP 复用已有名称索引，只复制至多 4 个需要深入检查的 XPS 路径。普通文本不再重复校验 UTF-8，JSONL 先检查两条有效行，再短路验证后续行。', '',
      '| 版本 | 改前 gzip -9 | 索引版 gzip -9 | 大小变化 | 逐字段结果一致 |',
      '| --- | --- | --- | --- | --- |',
      ...Object.entries(indexComparison.variants).map(([variant, v]) => `| ${names[variant]} | ${v.previousArtifact.gzip9Bytes} B | ${report[variant].artifact.gzip9Bytes} B | ${((report[variant].artifact.gzip9Bytes / v.previousArtifact.gzip9Bytes - 1) * 100).toFixed(2)}% | ${v.unchangedOutputs}/${rows.length} |`), '',
      '| 版本 | 分组 | 文件数 | 改前批次中位数 | 索引版批次中位数 | 耗时变化 |',
      '| --- | --- | --- | --- | --- | --- |',
      ...Object.entries(indexComparison.variants).flatMap(([variant, v]) => Object.entries(v.timing).map(([group, timing]) => `| ${names[variant]} | ${groups[group]} | ${timing.files} | ${timing.previousMedianBatchMs.toFixed(3)} ms | ${timing.currentMedianBatchMs.toFixed(3)} ms | ${(100 * timing.medianChange).toFixed(1)}% |`)), '',
      '计时为本机 Node V8 中完整 WASM 探测调用，包含采样、容器处理、宿主调用和结果解码；排除文件读取、编译和实例化。预热 3 次，改前/改后交替测量 11 轮；每轮重复批次目标 10 ms、最多 128 次，归一化到单批次后取中位数。它不能解释为纯二分查找提速或浏览器冷启动收益；计时批次、重复次数、环境、基线哈希见 report.json。', '',
      '二字节前缀分组避免对变长签名直接做前驱查找时遗漏短前缀或同前缀后续规则。测试覆盖全部 65,536 个分组键、所有签名截断边界、长度/附加条件失败后的候选回退，以及相同前缀的原始优先级。', '',
      `当前快照有 ${inputRevisions.length} 个文件与上轮哈希不同，详见 report.json 的 indexComparison.inputRevisions；新旧产物均读取同一快照，冻结的旧清单未修改。本轮实际清单见 corpus-manifest.json。`, '',
      `复现比较：\`node scripts/evaluate-expanded-detection.mjs --output ${path.relative(root, output)} --reference ${path.relative(root, referenceDirectory)} --current-inputs\`。参考目录保留、不覆盖；以下覆盖率表中的 baseline 仍指更早的冻结容器版。`, '');
  }
  if (simd) {
    const groups = { all: '全部文件', asciiText: 'ASCII 文本探测', nonAsciiText: '含非 ASCII 的文本探测', signatures: '签名命中文件', unresolved: '未确定文件' };
    lines[0] = '# 可选 SIMD128 文本扫描评估';
    lines.splice(2, 0,
      '增加显式可选的 `format-detection-simd` 功能。本轮测量轻量版：WASM SIMD128 每个向量检查 16 字节，主循环展开为 4 个向量、每轮 64 字节，同时判断 ASCII 和控制字符；遇到非 ASCII 时使用原 UTF-8 路径，不足 16 字节的尾部用标量扫描。签名索引继续二分查找，普通构建不要求 SIMD。', '',
      '| 轻量版产物 | WASM gzip -9 |', '| --- | --- |',
      `| 当前标量版 | ${simd.referenceArtifact.gzip9Bytes} B |`, `| SIMD128 版 | ${simd.artifact.gzip9Bytes} B |`, '',
      '| 文件分组 | 文件数 | 标量批次中位数 | SIMD 批次中位数 | 耗时变化 |', '| --- | --- | --- | --- | --- |',
      ...Object.entries(simd.timing).map(([group, timing]) => `| ${groups[group]} | ${timing.files} | ${timing.previousMedianBatchMs.toFixed(3)} ms | ${timing.currentMedianBatchMs.toFixed(3)} ms | ${(100 * timing.medianChange).toFixed(1)}% |`), '',
      `SIMD 版与当前标量版的 ${simd.unchangedOutputs} 个文件输出逐字段一致，原生/WASM 检查 ${simd.nativeWasmChecks} 次；另检查 ${simd.randomNegatives} 个随机负例、${simd.generatedBoundaryChecks} 个生成边界用例。Chromium 核对 ${simd.browserSamples} 种格式，产物反汇编确认包含 i8x16.bitmask 指令。边界用例覆盖每种字节值、16 字节与 8192 字节边界、中文/emoji、控制字符后接非法 UTF-8，以及 BOM 导致的非对齐起始位置。`, '',
      '上表以本轮当前标量构建为基线，按输入头部划分 ASCII/非 ASCII 文本组；计时方法与下方索引比较相同。SIMD 产物应只在支持 WASM SIMD128 的运行时选用；默认产物继续可移植。标签一致不等于独立准确率，也不代表 SIMD 能加速结构化容器解析。', '',
      `复现 SIMD 比较：\`node scripts/evaluate-expanded-detection.mjs --output ${path.relative(root, output)}${referenceDirectory ? ` --reference ${path.relative(root, referenceDirectory)}` : ''} --simd\`。`, '');
  }
  await writeFile(path.join(output, 'README.zh-CN.md'), lines.join('\n'));
  console.log(JSON.stringify({ files: rows.length, baseline: report.baseline.exact, light: report.light.exact, expanded: report.expanded.exact, lightGzip: report.light.artifact.gzip9Bytes, fullGzip: report.expanded.artifact.gzip9Bytes, regressions: report.regressions.length, disagreements: report.disagreements.length, negatives: negatives.length }));
} finally { await browser?.close(); await rm(temporary, { recursive: true, force: true }); }
