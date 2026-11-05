// Complete CLI processes over real, request-local plain-text corpora.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const option = (name, fallback) => { const at = process.argv.indexOf(name); return at < 0 ? fallback : process.argv[at + 1]; };
const binaries = { before: path.resolve(option('--baseline', 'tmp/batch-matching-round9/native-scalar/filens')),
  after: path.resolve(option('--binary', 'tmp/batch-matching-round9/native-simd/filens')) };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const artifacts = Object.fromEntries(await Promise.all(Object.entries(binaries).map(async ([name, file]) => [name, sha256(await readFile(file))])));
const paragraph = 'Budget review is pending; formal approval requires evidence and a revised estimate.\n';
const diverse = Array.from({ length: 128 }, (_, i) => `detail${String.fromCharCode(97 + i % 26)}${String.fromCharCode(97 + Math.floor(i / 26))}`);
const cases = [
  { name: 'native-32-ascii', count: 32, query: 'budget approval', text: paragraph.repeat(3) },
  { name: 'native-1000-ascii', count: 1000, query: 'needle', text: 'needle budget approval '.repeat(12) },
  { name: 'native-32-varied-body', count: 32, query: 'needle', text: `needle ${diverse.join(' ')}\n`.repeat(100) },
  { name: 'native-64-chinese', count: 64, query: '预算 审批', text: '预算需要逐项复核，审批材料仍待负责人确认。\n'.repeat(300) },
];
const warmup = 3, rounds = 9, timings = [];
for (const test of cases) {
  const directory = path.join(root, 'tmp/batch-matching-round9/native-corpus', test.name);
  await mkdir(directory, { recursive: true });
  for (let i = 0; i < test.count; i++) await writeFile(path.join(directory, `report-${i}.txt`), test.text);
  const args = ['search', directory, '--query', test.query, '--json', '--no-ocr'];
  let reference;
  const samples = { before: [], after: [] };
  for (let round = -warmup; round < rounds; round++) {
    for (const version of round % 2 ? ['after', 'before'] : ['before', 'after']) {
      const start = performance.now();
      const process = spawnSync(binaries[version], args, { cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 16 << 20 });
      const elapsed = performance.now() - start;
      assert.equal(process.error, undefined);
      assert.equal(process.status, 0, process.stderr);
      const wire = JSON.parse(process.stdout);
      assert(wire.ok);
      assert.equal(wire.search.matchedFiles, test.count);
      assert.equal(wire.search.scan.execution.ranking, 'native-rust');
      assert.equal(wire.search.scan.execution.sharedTextModules, 0);
      wire.search.scan.discoveryMs = 0;
      const resultSha256 = sha256(JSON.stringify(wire));
      reference ??= resultSha256;
      assert.equal(resultSha256, reference, `${test.name}: full response differs`);
      if (round >= 0) samples[version].push(elapsed);
    }
  }
  const median = samples => [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)];
  const beforeMs = median(samples.before), afterMs = median(samples.after);
  timings.push({ name: test.name, files: test.count, inputSpecSha256: sha256(JSON.stringify(test)), resultSha256: reference,
    beforeMs, afterMs, speedup: beforeMs / afterMs, samples });
  console.log(`${test.name}: ${beforeMs.toFixed(3)} → ${afterMs.toFixed(3)} ms (${(beforeMs / afterMs).toFixed(2)}×)`);
}
const sources = ['cli/Cargo.toml', 'cli/Cargo.lock', 'wasm/converter-core-rust/src/text/search.rs',
  'wasm/converter-core-rust/src/text/search_simd.rs', 'scripts/benchmark-search-simd-native.mjs'];
const sourceHashes = Object.fromEntries(await Promise.all(sources.map(async file => [file, sha256(await readFile(path.join(root, file)))])));
const output = path.resolve(option('--output', 'benchmarks/frontend/2026-11-04/batch-matching-round9-native.json'));
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify({ measuredAt: new Date().toISOString(), node: process.version, cpu: cpus()[0].model,
  platform: `${process.platform}-${process.arch}`, artifacts, sourceHashes, warmup, rounds, timings,
  builds: { before: 'Rust 1.93.0 release --no-default-features', after: 'Rust 1.93.0 release (default search-simd)' },
  timingScope: 'Complete fresh CLI process, including process startup, real directory traversal and file I/O, shared native plain-text extraction/search, JSON output and parent-process capture. OS caches warmed; no WASM modules loaded, OCR disabled. Only search.scan.discoveryMs ignored in strict full-response hashes.' }, null, 2) + '\n');
