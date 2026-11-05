// Follow up on noisy small-corpus timings without rerunning larger workloads.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const option = (name, fallback) => { const at = process.argv.indexOf(name); return at < 0 ? fallback : process.argv[at + 1]; };
const before = option('--baseline'), after = option('--wasm');
assert(before && after, '--baseline and --wasm are required');
const reference = JSON.parse(await readFile(path.join(root, option('--reference', 'benchmarks/frontend/2026-11-04/batch-matching-round9.json')), 'utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const bundled = await build({ entryPoints: [path.join(root, 'packages/converter-client/src/wasi-runner.ts')], bundle: true, write: false, format: 'esm', platform: 'node', target: 'node20' });
const { InMemoryWasiHost } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`);
const modules = {}, artifacts = {};
for (const [version, file] of Object.entries({ before, after })) {
  const bytes = await readFile(file);
  assert(bytes.length && WebAssembly.validate(bytes));
  artifacts[version] = sha256(bytes);
  assert.equal(artifacts[version], reference.sizes[version].sha256);
  modules[version] = await WebAssembly.compile(bytes);
}
const source = (relativePath, text) => ({ path: `/corpus/${relativePath}`, relativePath, text, sha256: '', complete: true });
const paragraph = 'Budget review is pending; formal approval requires evidence and a revised estimate.\n';
const datasets = [
  { name: 'bm25-32-ascii', query: 'budget approval', files: Array.from({ length: 32 }, (_, i) => source(`report-${i}.txt`, paragraph.repeat(3))) },
  { name: 'bm25-1000-ascii', query: 'needle', files: Array.from({ length: 1000 }, (_, i) => source(`budget-${i}.txt`, 'needle budget approval '.repeat(12))) },
];
async function run(version, input) {
  const host = new InMemoryWasiHost({ files: { '/work/corpus.json': input }, captureStdio: true,
    args: ['converter-text', '--operation', 'search-text', '--input', '/work/corpus.json', '--output', '/work/output', '--source', 'json', '--target', 'text', '--result', '/work/result.json'] });
  const imports = { ...host.imports };
  for (const { module, name } of WebAssembly.Module.imports(modules[version])) {
    if (module === 'wasi_snapshot_preview1' && !imports[name]) imports[name] = () => { throw new Error(`Unexpected WASI call: ${name}`); };
  }
  const start = performance.now();
  const instance = await WebAssembly.instantiate(modules[version], { wasi_snapshot_preview1: imports, filens_text: { host_call: () => { throw new Error('Unexpected host conversion'); } } });
  host.setInstance(instance);
  try { instance.exports._start(); } catch (error) { if (error?.code !== 0) throw error; }
  const milliseconds = performance.now() - start;
  const wire = JSON.parse(new TextDecoder().decode(host.readFile('/work/result.json')));
  wire.metrics.elapsedMs = 0;
  return { milliseconds, resultSha256: sha256(JSON.stringify(wire)) };
}
const warmup = 20, rounds = 51, timings = [];
for (const dataset of datasets) {
  const input = Buffer.from(JSON.stringify({ mode: 'bm25', query: dataset.query, files: dataset.files, limit: 10, format: 'json' }));
  const control = reference.checks.find(c => c.name === dataset.name);
  assert.equal(sha256(input), control.inputSha256);
  const samples = { before: [], after: [] };
  for (let round = -warmup; round < rounds; round++) {
    for (const version of round % 2 ? ['after', 'before'] : ['before', 'after']) {
      const result = await run(version, input);
      assert.equal(result.resultSha256, control.resultSha256);
      if (round >= 0) samples[version].push(result.milliseconds);
    }
  }
  const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const beforeMs = median(samples.before), afterMs = median(samples.after);
  timings.push({ name: dataset.name, inputSha256: control.inputSha256, resultSha256: control.resultSha256, beforeMs, afterMs, speedup: beforeMs / afterMs, samples });
  console.log(`${dataset.name}: ${beforeMs.toFixed(3)} → ${afterMs.toFixed(3)} ms (${(beforeMs / afterMs).toFixed(2)}×)`);
}
const report = { measuredAt: new Date().toISOString(), node: process.version, warmup, rounds, artifacts, timings,
  sourceSha256: sha256(await readFile(fileURLToPath(import.meta.url))), hostSha256: sha256(await readFile(path.join(root, 'packages/converter-client/src/wasi-runner.ts'))),
  timingScope: reference.timingScope, purpose: 'Follow-up of the noisy 32-file result, plus the existing 1000-file control. Same immutable WASM, exact input hashes and full response hashes as the primary benchmark; more warmup and samples.' };
const output = path.resolve(option('--output', 'benchmarks/frontend/2026-11-04/batch-matching-round9-small.json'));
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
