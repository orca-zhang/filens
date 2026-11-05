// Full detector calls, including JS/WASM reads and result decoding, in Chromium.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const option = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
};
const current = option('--current', 'wasm/format-detector/dist');
const baseline = option('--baseline', 'benchmarks/frontend/2026-11-04/simd-runtime/baseline');
const output = option('--output', 'tmp/simd-scan-results/report.json');
const directory = path.dirname(output);
await mkdir(directory, { recursive: true });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const reference = JSON.parse(await readFile(path.join(baseline, 'manifest.json')));
const bytes = {
  scalar: await readFile(path.join(current, 'converter-detect-scalar.wasm')),
  simd16: await readFile(path.join(baseline, 'converter-detect-simd16.wasm')),
  simd64: await readFile(path.join(baseline, 'converter-detect-simd64.wasm')),
  simd: await readFile(path.join(current, 'converter-detect-simd.wasm'))
};
assert.equal(sha(bytes.simd16), reference.simd16);
assert.equal(sha(bytes.simd64), reference.simd64);
assert.notEqual(sha(bytes.simd16), sha(bytes.simd64), 'SIMD baselines must be independent');
const manifest = JSON.parse(await readFile(path.join(current, 'manifest.json')));
for (const [file, hash] of Object.entries(manifest.sourceSha256)) {
  assert.equal(sha(await readFile(path.join(root, 'wasm/converter-core-rust', file))), hash, file);
}
assert.equal(sha(bytes.scalar), manifest.variants.scalar.sha256);
assert.equal(sha(bytes.simd), manifest.variants.simd.sha256);
const runtime = path.resolve(directory, 'binding.mjs');
await build({ entryPoints: ['packages/converter-client/src/format-detector-auto.ts'], outfile: runtime,
  bundle: true, minify: true, format: 'esm', platform: 'browser', target: 'es2020', loader: { '.wasm': 'file' } });
const binding = await readFile(runtime);
const { createFormatDetector } = await import(pathToFileURL(runtime));
const detectors = Object.fromEntries(await Promise.all(Object.entries(bytes).map(async ([name, bytes]) => [name, await createFormatDetector(bytes)])));
const corpus = JSON.parse(await readFile(path.join(baseline, 'corpus-manifest.json')));
const rows = [], inputs = [], errors = [];
for (const row of corpus.files) {
  const input = await readFile(row.path);
  const output = detectors.scalar.detect(input);
  for (const name of ['simd16', 'simd64', 'simd']) assert.deepEqual(detectors[name].detect(input), output, `${row.path}/${name}`);
  inputs.push(input);
  rows.push({ path: row.path, bytes: input.length, sha256: sha(input), previousSha256: row.sha256, output });
}
const generated = [
  ...[16, 64, 512, 8192].map(length => ({ name: `ascii-${length}`, input: Buffer.from('a'.repeat(length)) })),
  { name: 'unicode-early', input: Buffer.from('中文😀'.repeat(800)) },
  { name: 'unicode-late', input: Buffer.from('a'.repeat(8189) + '中') },
  { name: 'invalid-after-control', input: Buffer.concat([Buffer.from([0]), Buffer.alloc(8190, 65), Buffer.from([255])]) }
];
const specs = [
  { name: 'corpus-all', indices: rows.map((_, index) => index) },
  ...Object.entries({
    ascii: (row, index) => !row.output.container && ['text', 'structure'].includes(row.output.evidence)
      && inputs[index].subarray(inputs[index][0] === 239 && inputs[index][1] === 187 && inputs[index][2] === 191 ? 3 : 0, 8192).every(byte => byte < 128),
    unicode: (row, index) => !row.output.container && ['text', 'structure'].includes(row.output.evidence)
      && inputs[index].subarray(inputs[index][0] === 239 && inputs[index][1] === 187 && inputs[index][2] === 191 ? 3 : 0, 8192).some(byte => byte > 127),
    signatures: row => row.output.evidence === 'signature',
    unresolved: row => !row.output.format && !row.output.container
  }).map(([name, include]) => ({ name: `corpus-${name}`, indices: rows.flatMap((row, index) => include(row, index) ? [index] : []) })),
  ...generated.map(({ name, input }) => {
    const index = inputs.length; inputs.push(input);
    return { name, indices: [index] };
  })
];
let boundaryChecks = 0;
const check = input => {
  const expected = detectors.scalar.detect(input);
  for (const name of ['simd16', 'simd64', 'simd']) assert.deepEqual(detectors[name].detect(input), expected, `boundary ${boundaryChecks}/${name}`);
  boundaryChecks++;
};
for (const length of [0, 1, 15, 16, 17, 31, 32, 33, 47, 48, 49, 63, 64, 65, 127, 128, 129, 8191, 8192, 8193]) {
  const input = Buffer.alloc(length, 65);
  check(input);
  for (const position of [0, 1, 14, 15, 16, 17, 30, 31, 32, 46, 47, 48, 62, 63, 64, 127, 128, 8190, 8191, 8192]) {
    if (position >= length) continue;
    for (let byte = 0; byte < 256; byte++) { input[position] = byte; check(input); }
    input[position] = 65;
  }
  if (length > 1) { input[0] = 0; input[length - 1] = 255; check(input); }
}
for (const position of [0, 14, 15, 16, 30, 31, 32, 46, 47, 48, 62, 63, 64, 8190, 8191, 8192]) {
  for (const suffix of ['中', '😀', '\u0085', '\ufffd']) {
    const input = Buffer.from('A'.repeat(position) + suffix);
    for (let cut = 0; cut < 4; cut++) check(input.subarray(0, Math.max(0, input.length - cut)));
  }
  check(Buffer.concat([Buffer.from([239, 187, 191]), Buffer.alloc(position, 65)]));
}
// Confirm actual vector instructions; no native execution is used as SIMD proof.
const wat = await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['node_modules/binaryen/bin/wasm-opt', path.join(current, 'converter-detect-simd.wasm'),
    '--enable-simd', '--enable-bulk-memory', '--enable-nontrapping-float-to-int', '--print'], { cwd: root });
  const chunks = [];
  child.stdout.on('data', bytes => chunks.push(bytes));
  child.on('error', reject);
  child.on('exit', code => code === 0 ? resolve(Buffer.concat(chunks).toString()) : reject(new Error('WASM disassembly failed')));
});
assert.match(wat, /i8x16\.bitmask/);
const result = { date: new Date().toISOString(), cpu: os.cpus()[0].model, node: process.version,
  method: 'Chromium full detector calls: sampling, JS/WASM input copies and result decoding included; input preparation, imports, compilation, serialization and validation excluded. Three warmups, nine rotating trials, each repeated for at least approximately 20 ms (at most 8192 repetitions), normalized to a single sweep. No builds/tests run concurrently.',
  sourceSha256: manifest.sourceSha256, artifacts: Object.fromEntries(Object.entries(bytes).map(([name, bytes]) => [name,
    { sha256: sha(bytes), bytes: bytes.length, gzip9Bytes: gzipSync(bytes, { level: 9 }).length }])),
  binding: { sha256: sha(binding), bytes: binding.length, gzip9Bytes: gzipSync(binding, { level: 9 }).length },
  vectorInstructions: { bitmask: [...wat.matchAll(/i8x16\.bitmask/g)].length, loads: [...wat.matchAll(/v128\.load/g)].length },
  boundaryChecks, inputRevisions: rows.filter(row => row.sha256 !== row.previousSha256), rows, cases: {}, errors };
const browser = await chromium.launch();
result.browser = browser.version();
try {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.route('http://localhost/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html>' });
    if (url.pathname === '/binding.mjs') return route.fulfill({ contentType: 'text/javascript', body: binding });
    const name = url.pathname.slice(1).replace('.wasm', '');
    if (name in bytes) return route.fulfill({ contentType: 'application/wasm', body: bytes[name] });
    if (url.pathname === '/input') return route.fulfill({ contentType: 'application/octet-stream', body: inputs[Number(url.searchParams.get('index'))] });
    return route.abort();
  });
  await page.goto('http://localhost/');
  result.autoSelection = await page.evaluate(async () => {
    const lib = window.lib = await import('/binding.mjs');
    const counts = { scalar: 0, simd: 0 };
    const load = async name => { counts[name]++; return (await fetch(name === 'simd' ? '/simd.wasm' : '/scalar.wasm')).arrayBuffer(); };
    const automatic = await lib.createAutoFormatDetector({ scalar: () => load('scalar'), simd: () => load('simd') });
    const validate = WebAssembly.validate;
    let portable;
    try {
      WebAssembly.validate = () => false;
      portable = await lib.createAutoFormatDetector({ scalar: () => load('scalar'), simd: () => { throw new Error('Unsupported SIMD requested'); } });
    } finally { WebAssembly.validate = validate; }
    const recovered = await lib.createAutoFormatDetector({ scalar: () => load('scalar'), simd: () => new Uint8Array([1, 2, 3]) });
    window.detectors = { scalar: portable,
      simd16: await lib.createFormatDetector(await (await fetch('/simd16.wasm')).arrayBuffer()),
      simd64: await lib.createFormatDetector(await (await fetch('/simd64.wasm')).arrayBuffer()), simd: automatic };
    return { selected: automatic.implementation, unsupported: portable.implementation, recovered: recovered.implementation,
      counts, results: [automatic, portable, recovered].map(detector => detector.detect(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))) };
  });
  assert.equal(result.autoSelection.selected, 'simd128');
  assert.equal(result.autoSelection.unsupported, 'scalar');
  assert.equal(result.autoSelection.recovered, 'scalar');
  assert.deepEqual(result.autoSelection.counts, { scalar: 2, simd: 1 });
  assert.deepEqual(result.autoSelection.results[0], result.autoSelection.results[1]);
  assert.deepEqual(result.autoSelection.results[0], result.autoSelection.results[2]);
  const json = await page.evaluate(async count => {
    window.inputs = [];
    const outputs = [];
    for (let index = 0; index < count; index++) {
      const input = new Uint8Array(await (await fetch('/input?index=' + index)).arrayBuffer());
      window.inputs.push(input);
      const values = Object.values(window.detectors).map(detector => detector.detect(input));
      if (!values.every(value => JSON.stringify(value) === JSON.stringify(values[0]))) throw new Error('Browser output mismatch ' + index);
      outputs.push(values[0]);
    }
    return JSON.stringify(outputs);
  }, inputs.length);
  assert.deepEqual(JSON.parse(json).slice(0, rows.length), rows.map(row => row.output));
  result.browserOutputSha256 = sha(json);
  for (const spec of specs) {
    const timing = await page.evaluate(({ indices }) => {
      const inputs = indices.map(index => window.inputs[index]);
      const names = Object.keys(window.detectors), samples = Object.fromEntries(names.map(name => [name, []]));
      const measure = (name, repetitions) => {
        let checksum = 0;
        const start = performance.now();
        for (let i = 0; i < repetitions; i++) for (const input of inputs) {
          const value = window.detectors[name].detect(input);
          checksum += value.bytesRead + (value.format?.length ?? 0);
        }
        return { ms: performance.now() - start, checksum };
      };
      let repetitions = 1;
      while (repetitions < 8192 && measure('scalar', repetitions).ms < 20) repetitions *= 2;
      for (let i = 0; i < 3; i++) for (const name of names) measure(name, repetitions);
      for (let i = 0; i < 9; i++) {
        let expected;
        for (let j = 0; j < names.length; j++) {
          const name = names[(i + j) % names.length], value = measure(name, repetitions);
          expected ??= value.checksum;
          if (expected !== value.checksum) throw new Error('Timed checksum mismatch');
          samples[name].push(value.ms / repetitions);
        }
      }
      const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
      return { files: inputs.length, repetitions, timings: Object.fromEntries(names.map(name => [name,
        { samplesMs: samples[name], medianMs: median(samples[name]) }])) };
    }, spec);
    result.cases[spec.name] = timing;
    console.log(JSON.stringify({ name: spec.name, ...timing }));
  }
  assert.deepEqual(errors, []);
  await writeFile(output, JSON.stringify(result, null, 2) + '\n');
  console.log(`PASS: ${rows.length} real inputs, ${boundaryChecks} boundary cases, browser outputs and adaptive fallback.`);
} finally { await browser.close(); }
