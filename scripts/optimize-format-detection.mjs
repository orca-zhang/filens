// Compare a lightweight browser ABI with the frozen WASI/CLI experiment.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { build } from 'vite';
import { chromium } from '@playwright/test';
import { privateRustBuildEnv, privacyIssues } from './agent-release-privacy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'benchmarks/format-detection');
const output = path.join(directory, 'optimized');
const crate = path.join(root, 'wasm/converter-core-rust');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'filens-detect-web-'));
const baselineBytes = await readFile(path.join(directory, 'report.json'));
const baseline = JSON.parse(baselineBytes);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const size = bytes => ({ rawBytes: bytes.length, gzip9Bytes: gzipSync(bytes, { level: 9 }).length,
  brotli11Bytes: brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length, sha256: sha256(bytes) });
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const env = privateRustBuildEnv(root);
let browser;
async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: ['ignore', 'ignore', 'pipe'] });
    const errors = [];
    child.stderr.on('data', bytes => errors.push(bytes));
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}: ${Buffer.concat(errors)}`)));
  });
}

try {
  await mkdir(output, { recursive: true });
  await build({ configFile: false, logLevel: 'silent', build: { outDir: temporary, emptyOutDir: false, minify: true,
    lib: { entry: { 'format-detector': path.join(root, 'packages/converter-client/src/format-detector.ts'), host: path.join(root, 'packages/converter-client/src/wasi-runner.ts') }, formats: ['es'], fileName: (_format, name) => `${name}.mjs` } } });
  const bindingBytes = await readFile(path.join(temporary, 'format-detector.mjs'));
  await writeFile(path.join(output, 'format-detector.mjs'), bindingBytes);
  const { createFormatDetector } = await import(pathToFileURL(path.join(temporary, 'format-detector.mjs')));
  const { createWasmCoreRunner } = await import(pathToFileURL(path.join(temporary, 'host.mjs')));
  browser = await chromium.launch();
  const page = await browser.newPage();
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  let browserWasm, browserInput;
  await page.route('http://localhost/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html>' });
    if (pathname === '/format-detector.mjs') return route.fulfill({ contentType: 'text/javascript', body: bindingBytes });
    if (pathname === '/module.wasm') return route.fulfill({ contentType: 'application/wasm', body: browserWasm });
    if (pathname === '/sample') return route.fulfill({ contentType: 'application/octet-stream', body: browserInput });
    return route.abort();
  });
  await page.goto('http://localhost/');
  const variants = {};
  for (const [name, feature] of [['signatures', 'format-detection'], ['containers', 'format-detection-containers']]) {
    console.log(`Building lightweight ${name} detector...`);
    const reference = baseline.variants[name];
    const frozenWasm = await readFile(path.join(directory, reference.artifact.file));
    assert.equal(sha256(frozenWasm), reference.artifact.sha256, 'Baseline artifact changed; regenerate its report first.');
    await run('cargo', ['build', '--locked', '--release', '--manifest-path', path.join(crate, 'Cargo.toml'), '--no-default-features', '--features', feature, '--example', 'detect-web', '--target', 'wasm32-wasip1']);
    const wasmPath = path.join(output, `converter-detect-web-${name}.wasm`);
    await run(process.execPath, [path.join(root, 'node_modules/binaryen/bin/wasm-opt'), path.join(crate, 'target/wasm32-wasip1/release/examples/detect_web.wasm'), '-Oz', '--converge', '--enable-bulk-memory', '--enable-nontrapping-float-to-int', '--strip-debug', '--strip-producers', '-o', wasmPath]);
    const bytes = await readFile(wasmPath);
    assert.deepEqual(privacyIssues(bytes), []);
    const module = await WebAssembly.compile(bytes);
    const detector = await createFormatDetector(module);
    const old = createWasmCoreRunner({ wasm: frozenWasm });
    const previous = async input => {
      const result = await old({ args: ['converter-detect', '--input', '/work/input'], files: { '/work/input': input }, captureStdio: true });
      assert.equal(result.exitCode, 0, result.stderr);
      const [{ path: _path, ...detected }] = JSON.parse(result.stdout);
      return detected;
    };
    const optimizedSamples = [], baselineSamples = [];
    const optimizedBatchMs = Array(7).fill(0), baselineBatchMs = Array(7).fill(0);
    let maximumMemory = 0;
    for (const sample of reference.rows) {
      const input = await readFile(path.join(root, sample.path));
      assert.equal(sha256(input), sample.sha256, `Corpus changed: ${sample.path}`);
      assert.deepEqual(await previous(input), sample.detection, sample.path);
      assert.deepEqual(detector.detect(input), sample.detection, sample.path);
      // The source may be a nonzero-offset view; bytes outside it must be ignored.
      const padded = new Uint8Array(input.length + 6);
      padded.set(input, 3);
      assert.deepEqual(detector.detect(padded.subarray(3, input.length + 3)), sample.detection, sample.path);
      for (let repeat = 0; repeat < 7; repeat++) {
        const measureNew = () => {
          const start = performance.now();
          detector.detect(input);
          const elapsed = performance.now() - start;
          optimizedSamples.push(elapsed); optimizedBatchMs[repeat] += elapsed;
        };
        const measureOld = async () => {
          const start = performance.now();
          await previous(input);
          const elapsed = performance.now() - start;
          baselineSamples.push(elapsed); baselineBatchMs[repeat] += elapsed;
        };
        if (repeat % 2) { measureNew(); await measureOld(); }
        else { await measureOld(); measureNew(); }
      }
      maximumMemory = Math.max(maximumMemory, detector.memoryBytes);
    }
    // Construction includes JS host setup + instance creation, excludes compilation.
    const instanceMs = [];
    for (let repeat = 0; repeat < 8; repeat++) {
      const start = performance.now();
      await createFormatDetector(module);
      if (repeat) instanceMs.push(performance.now() - start);
    }
    const stats = values => ({ medianMs: median(values), p95Ms: [...values].sort((a, b) => a - b)[Math.floor(values.length * 0.95)] });
    browserWasm = bytes;
    await page.evaluate(async () => {
      const { createFormatDetector } = await import('/format-detector.mjs');
      window.detector = await createFormatDetector(await (await fetch('/module.wasm')).arrayBuffer());
    });
    const wanted = new Set(['png', 'apng', 'jpg', 'pdf', 'docx', 'xlsx', 'pptx', 'json', 'svg', 'zip', 'vue', 'dng', 'epub']);
    let browserChecks = 0;
    for (const sample of reference.rows) {
      if (!wanted.delete(sample.label)) continue;
      browserInput = await readFile(path.join(root, sample.path));
      const detected = await page.evaluate(async () => window.detector.detect(new Uint8Array(await (await fetch('/sample')).arrayBuffer())));
      assert.deepEqual(detected, sample.detection, `Chromium: ${sample.path}`);
      browserChecks++;
    }
    assert.equal(wanted.size, 0, 'Browser verification corpus is missing required formats.');
    assert.deepEqual(browserErrors, []);
    variants[name] = {
      baselineArtifact: reference.artifact,
      optimizedArtifact: { file: path.basename(wasmPath), ...size(bytes) },
      unchangedOutputs: reference.rows.length, nonzeroOffsetChecks: reference.rows.length,
      exactLabelMatches: reference.exact, containerOrFamily: reference.containerOrFamily, unresolved: reference.unresolved, disagreements: reference.disagreement,
      gzipReduction: 1 - size(bytes).gzip9Bytes / reference.artifact.gzip9Bytes,
      browserVerification: { chromium: browser.version(), samples: browserChecks, outputsIdentical: true },
      pairedTiming: { repeats: 7, scope: 'Node V8; reused browser ABI instance vs original per-call WASI instance; source IO, compilation and deep output comparisons excluded; original host JSON transport and exit-code check included; alternating order per file',
        baselineBatchMs, optimizedBatchMs, baseline: stats(baselineSamples), optimized: stats(optimizedSamples),
        medianBatchRatio: median(baselineBatchMs) / median(optimizedBatchMs) },
      instanceCreation: { scope: 'seven warm module instantiations; compilation excluded', ...stats(instanceMs) },
      maximumObservedMemoryBytes: maximumMemory,
      imports: WebAssembly.Module.imports(module),
    };
    console.log(`${name}: ${reference.artifact.gzip9Bytes} -> ${variants[name].optimizedArtifact.gzip9Bytes} gzip bytes; ${reference.rows.length} identical outputs`);
  }
  const sources = {};
  for (const source of ['wasm/converter-core-rust/src/format_detection.rs', 'wasm/converter-core-rust/examples/detect_web.rs', 'packages/converter-client/src/format-detector.ts', 'scripts/optimize-format-detection.mjs', 'wasm/converter-core-rust/Cargo.lock']) {
    sources[source] = sha256(await readFile(path.join(root, source)));
  }
  const report = { schemaVersion: 1, baselineReportSha256: sha256(baselineBytes), corpus: baseline.corpus,
    productionRoutingChanged: false, extraProductionBytes: 0, dependenciesAdded: 0,
    environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model },
    sources, binding: { file: 'format-detector.mjs', ...size(bindingBytes) }, variants };
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  const lines = ['# 格式识别器浏览器接口优化', '',
    '两版复用同一份 Rust 识别规则。优化版移除 CLI 参数、路径、JSON 结果序列化和完整文件系统宿主，通过轻量接口按需读取片段，并复用 WASM 实例。JSON 探测复用原解析器做流式校验，不再创建完整对象树；保留数值范围、Unicode 和嵌套检查。ZIP/XML 仍由转换核心已有解析器处理，没有另写容器解析算法。默认后缀路由未变。', '',
    '| 版本 | 原 WASM gzip -9 | 优化 WASM gzip -9 | 缩减 | 精确标签匹配 |', '| --- | --- | --- | --- | --- |',
    ...Object.entries(variants).map(([name, row]) => `| ${name} | ${row.baselineArtifact.gzip9Bytes} B | ${row.optimizedArtifact.gzip9Bytes} B | ${(100 * row.gzipReduction).toFixed(1)}% | ${row.exactLabelMatches}/${row.unchangedOutputs} |`), '',
    `共用 JS 宿主独立打包后为 ${report.binding.rawBytes} B，gzip -9 为 ${report.binding.gzip9Bytes} B；上表只比较 WASM，实际按需下载还要计入此宿主。`, '',
    '每版全部样本均与冻结的旧 WASM 输出逐字段一致，并检查带非零偏移的输入视图。识别率、歧义处理和读取预算未改变；WASM 只接收读取请求涉及的字节。原始、gzip、Brotli 字节数、产物与源码哈希见 report.json。', '',
    `每版另在 Chromium 中核对 ${variants.containers.browserVerification.samples} 种格式，输出与旧版一致。宿主只提供片段读取、随机种子和 Rust 错误路径所需的少量接口，不需要完整 WASI 文件系统。`, '',
    '时延比较包含各自宿主与结果传输：旧版每次创建 WASI 实例并读取 JSON 结果，新版复用实例并返回字段；排除文件读取和模块编译。每个文件交替顺序测七次。它衡量接口和实例复用收益，不能当作识别算法本身或浏览器冷启动提速。完整范围和原始计时见 report.json。', '',
    '准确度边界继承原报告：开发语料的标签一致率不是独立测试集准确率。优化版仍建议作为无后缀/未知后缀的可选兜底，不自动覆盖已识别后缀。', '',
    '可独立使用生成的绑定和 WASM，实例创建后复用：', '',
    '```js', "import { createFormatDetector } from './format-detector.mjs';", "const wasm = await (await fetch('./converter-detect-web-containers.wasm')).arrayBuffer();", 'const detector = await createFormatDetector(wasm);', 'const result = detector.detect(fileBytes); // Uint8Array，文件名不参与识别', '```', '',
    '复现：`node scripts/optimize-format-detection.mjs`。需要先有 `node scripts/evaluate-format-detection.mjs` 生成的基线报告和两个 WASM。', ''];
  await writeFile(path.join(output, 'README.zh-CN.md'), lines.join('\n'));
} finally {
  await browser?.close();
  await rm(temporary, { recursive: true, force: true });
}
