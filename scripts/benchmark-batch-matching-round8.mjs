// Full production text-WASM search operations through the frontend's real WASI host.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gzipSync, gunzipSync, brotliCompressSync } from 'node:zlib';
import { cpus } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const option = (name, fallback) => { const at = process.argv.indexOf(name); return at < 0 ? fallback : process.argv[at + 1]; };
const before = option('--baseline'), after = option('--wasm');
assert(before && after, '--baseline and --wasm are required');
const checksOnly = process.argv.includes('--checks-only');
const rounds = Number(option('--rounds', '9')), warmup = Number(option('--warmup', '3'));
assert(Number.isInteger(rounds) && rounds > 0 && Number.isInteger(warmup) && warmup >= 0);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const bundle = await build({ entryPoints: [path.join(root, 'packages/converter-client/src/wasi-runner.ts')],
  bundle: true, write: false, format: 'esm', platform: 'node', target: 'node20' });
const { InMemoryWasiHost } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
const modules = {}, sizes = {};
for (const [version, file] of Object.entries({ before, after })) {
  const bytes = await readFile(file);
  assert(bytes.length && WebAssembly.validate(bytes), `${version}: invalid WASM`);
  modules[version] = await WebAssembly.compile(bytes);
  sizes[version] = { bytes: bytes.length, sha256: sha256(bytes),
    gzip9: checksOnly ? null : gzipSync(bytes, { level: 9 }).length,
    brotli11: checksOnly ? null : brotliCompressSync(bytes).length };
}
let baselineControl = null;
const controlFile = option('--control-baseline');
if (controlFile) {
  const bytes = await readFile(controlFile);
  assert(bytes.length && WebAssembly.validate(bytes));
  assert.equal(sha256(bytes), sizes.before.sha256, 'Fresh baseline must be byte-identical');
  baselineControl = { byteIdentical: true, sha256: sha256(bytes) };
}
const source = (relativePath, text = '', extra = {}) => ({ path: `/corpus/${relativePath}`, relativePath, text, sha256: '', complete: true, ...extra });
const cases = [];
function add(name, mode, query, files, { timed = false, matched = files.length, expectedSearch = {}, ...options } = {}) {
  const input = Buffer.from(JSON.stringify({ mode, query, files, limit: 10, format: 'json', ...options }));
  cases.push({ name, input, timed, matched, expectedSearch });
}
const paragraph = 'Budget review is pending; formal approval requires evidence and a revised estimate.\n';
const deepPath = 'archives/预算审计/季度材料/技术审批/'.repeat(8);
const vocabulary = ['amber', 'birch', 'cedar', 'delta', 'elm', 'fir', 'garnet', 'hazel', 'iris', 'jade', 'kelp', 'larch', 'maple', 'oak', 'pine', 'quartz'];
add('bm25-32-ascii', 'bm25', 'budget approval', Array.from({ length: 32 }, (_, i) => source(`report-${i}.txt`, paragraph.repeat(3))), { timed: true });
add('bm25-1000-ascii', 'bm25', 'needle', Array.from({ length: 1000 }, (_, i) => source(`budget-${i}.txt`, 'needle budget approval '.repeat(12))), { timed: true });
for (const phrase of [true, false]) {
  add(`bm25-64-long-path-phrase-${phrase}`, 'bm25', 'budget approval', Array.from({ length: 64 }, (_, i) =>
    source(`${deepPath}${phrase ? 'BUDGET APPROVAL' : 'BUDGET-APPROVAL'}-${i}.txt`, paragraph.repeat(400))), { timed: true });
}
add('bm25-64-chinese', 'bm25', '预算 审批', Array.from({ length: 64 }, (_, i) =>
  source(`材料/预算审核/审批记录-${i}.txt`, '预算需要逐项复核，审批材料仍待负责人确认。\n'.repeat(300))), { timed: true });
add('bm25-16-query-terms', 'bm25', vocabulary.join(' '), Array.from({ length: 64 }, (_, i) =>
  source(`notes-${i}.txt`, vocabulary.toReversed().join(' ').concat(' extra context\n').repeat(200))), { timed: true });
add('files-10000-ascii', 'files', 'budget approval', Array.from({ length: 10000 }, (_, i) => source(`archive/BUDGET APPROVAL notes-${i}.txt`)), { timed: true });
add('files-10000-chinese-deep-path', 'files', '预算 审批', Array.from({ length: 10000 }, (_, i) =>
  source(`${deepPath}预算审批记录-${i}.txt`)), { timed: true });
add('bm25-10000-empty-deep-path', 'bm25', '预算 审批', Array.from({ length: 10000 }, (_, i) =>
  source(`${deepPath}预算审批记录-${i}.txt`)), { timed: true, matched: 0, expectedSearch: { chunks: 0, indexedFiles: 10000, complete: true } });
add('bm25-empty-sources-between-hits', 'bm25', 'budget', [
  source('budget ignored.txt'), source('ordinary.txt', 'ordinary background'),
  source('budget included.txt', 'ordinary background'), source('budget skipped.txt'),
  source('other.txt', 'ordinary background'), source('last.txt', 'budget approved'),
], { matched: 2, expectedSearch: { chunks: 4, indexedFiles: 6, complete: true } });
add('files-repeated-capped-terms-and-ignored-body', 'files', 'budget 预算', [
  source('stable.txt', 'irrelevant body '.repeat(100), { relativePath: `${'budget '.repeat(20)}${'预算'.repeat(80)} notes.txt` }),
  source('unrelated.txt', 'budget 预算'), source('BUDGET 预算 fallback.txt', '', { relativePath: '' }),
], { matched: 2 });
add('files-chunk-limit-skips-unused-tail', 'files', 'budget', [
  ...Array.from({ length: 65536 }, (_, i) => source(i === 17 ? 'budget.txt' : `entry-${i}.txt`)),
  source(`${deepPath.repeat(50)}budget tail.txt`), source(`${deepPath.repeat(50)}budget final.txt`),
], { matched: 1, expectedSearch: { chunks: 65536, indexedFiles: 65538, complete: false, truncated: true } });
add('exact-10000-control', 'exact', 'needle', Array.from({ length: 10000 }, (_, i) => source(`报告/预算审批/needle-${i}.txt`, 'ordinary background')), { timed: true });
add('bm25-cache-budget-overflow', 'bm25', vocabulary.join(' '), Array.from({ length: 64 }, (_, i) =>
  source(`notes-${i}.txt`, vocabulary.toReversed().join(' ').concat(' extra context\n').repeat(500))), { timed: true });
const roots = ['oak', 'elm', 'pine', 'fir', 'kelp', 'maple', 'cedar', 'amber'];
const wide = roots.flatMap(a => roots.map(b => a + b));
add('bm25-64-terms-cache-overflow', 'bm25', wide.join(' '), Array.from({ length: 32 }, (_, i) =>
  source(`wide-${i}.txt`, wide.toReversed().join(' ').concat('\n').repeat(300))), { timed: true });
const sparse = Array.from({ length: 128 }, (_, i) => `feature${String.fromCharCode(97 + i % 26)}${String.fromCharCode(97 + Math.floor(i / 26))}`);
add('bm25-128-terms-sparse', 'bm25', sparse.join(' '), Array.from({ length: 64 }, (_, i) =>
  source(`sparse-${i}.txt`, `${sparse[73]} ordinary ${sparse[19]} background `.repeat(200))), { timed: true });
add('bm25-supplementary-cjk-stopwords', 'bm25', '预算 𠀀𠮷', [
  source('unicode.txt', '预算的𠀀𠮷审批：这是一份材料。'.repeat(60)), source('miss.txt', '普通材料'),
], { matched: 1 });
add('bm25-no-matches', 'bm25', 'unobtainium', [source('notes.txt', paragraph.repeat(500))], { matched: 0 });
add('bm25-single-character-phrase-without-token', 'bm25', 'q', [source('notes.txt', 'sequence')]);
add('bm25-numeric-substring-is-not-token', 'bm25', '1', [source('notes.txt', '123')], { matched: 0 });
add('bm25-empty-corpus', 'bm25', 'budget', []);
add('bm25-numeric-identifiers', 'bm25', 'FILENS2026', [source('one.txt', 'FILENS2026 approved'), source('two.txt', 'FILENS2027 approved')], { matched: 1 });
add('bm25-nfkc-and-original-offsets', 'bm25', 'ＢＵＤＧＥＴ １２３.４５', [
  source('① ﬁ report.txt', '开头\nＢＵＤＧＥＴ １２３.４５ 已审批。'), source('wrong.txt', 'budget 123.54'),
], { matched: 1 });
add('bm25-unicode-case-and-combining', 'bm25', 'istanbul café ffi', [
  source('report.txt', 'Istanbul cafe\u0301 ﬃ'), source('missing.txt', 'unrelated'),
], { matched: 1 });
const evidence = { layout: { blocks: [{ startByte: 0, endByte: 25, page: 2 }], pages: [{ index: 2 }] },
  document: { blocks: [{ startByte: 0, endByte: 25, source: 'ocr', confidence: 0.96, slide: 2, shape: '42' }] },
  warnings: ['source is partial'], complete: false, archive: { outer: 'evidence.zip', member: 'record.txt' } };
for (const format of ['json', 'html', 'markdown', 'csv', 'tsv']) {
  for (const mode of ['bm25', 'files']) {
    add(`${mode}-${format}-ranking-evidence`, mode, 'budget approval', [
      source('BUDGET APPROVAL first.txt', 'budget approval\n' + paragraph.repeat(100), evidence),
      source('budget-approval second.txt', paragraph.repeat(50)),
      source('budget approval third.txt', 'budget approval'), source('unrelated.txt', 'background'),
    ], { format, matched: 3 });
  }
}
// File selection must preserve the original score/path/start/stable-input order.
for (const mode of ['bm25', 'files', 'exact']) {
  for (const limit of [1, 2, 10, 100]) {
    const query = mode === 'bm25' ? 'budget approval' : 'needle';
    add(`${mode}-file-selection-limit-${limit}`, mode, query, Array.from({ length: 257 }, (_, i) => {
      const j = i * 73 % 257;
      const text = mode === 'bm25'
        ? `${'ordinary context '.repeat(j % 5)}budget${j % 2 ? '-' : ' '}approval ${'budget approval '.repeat(j % 7 + 1)}`.repeat(j % 9 + 1)
        : `${'x'.repeat(j % 4 * 120)}needle ${'background '.repeat(j % 3 * 40)}needle`;
      return source(`group-${j % 13}.txt`, text, { relativePath: `needle notes-${j % 17}.txt`, sha256: `source-${i}`, complete: i % 3 !== 0,
        warnings: [`source ${i}`], archive: { outer: 'selection.zip', member: `${i}.txt` } });
    }), { limit, expectedSearch: { returnedFiles: limit, matchedFiles: 257 } });
  }
}
add('exact-50000-shuffled-deep-path-limit-10', 'exact', 'needle', Array.from({ length: 50000 }, (_, i) =>
  source(`${deepPath}needle-${String(i * 15427 % 50000).padStart(5, '0')}.txt`)),
  { timed: true, expectedSearch: { chunks: 50000, indexedFiles: 50000, returnedFiles: 10 } });
add('exact-duplicate-path-best-offset-and-stable-tie', 'exact', 'needle', [
  source('z.txt', 'needle', { sha256: 'z' }), source('same.txt', `${'x'.repeat(200)}needle`, { sha256: 'later-offset' }),
  source('same.txt', 'needle first', { sha256: 'first-early' }), source('same.txt', 'needle second', { sha256: 'second-early' }),
], { limit: 1, expectedSearch: { returnedFiles: 1 } });
add('exact-selected-file-retains-nonoverlapping-excerpts', 'exact', 'needle', [
  source('a.txt', `needle needle${'x'.repeat(400)}`.repeat(4)),
  ...Array.from({ length: 20 }, (_, i) => source(`z-${i}.txt`, 'needle')),
], { limit: 1, expectedSearch: { returnedFiles: 1, chunks: 28 } });
// Unmatched vocabulary must still contribute to BM25 document length.
const diverse = Array.from({ length: 128 }, (_, i) => `detail${String.fromCharCode(97 + i % 26)}${String.fromCharCode(97 + Math.floor(i / 26))}`);
add('bm25-128-distinct-body-terms', 'bm25', 'needle', Array.from({ length: 32 }, (_, i) =>
  source(`varied-${i}.txt`, `needle ${diverse.join(' ')}\n`.repeat(100))), { timed: true });
const broadQuery = Array.from({ length: 256 }, (_, i) => `feature${String.fromCharCode(97 + i % 26)}${String.fromCharCode(97 + Math.floor(i / 26))}`);
add('bm25-256-query-terms-sparse-body', 'bm25', broadQuery.join(' '), Array.from({ length: 64 }, (_, i) =>
  source(`broad-${i}.txt`, `${broadQuery[199]} ordinary ${broadQuery[37]} background `.repeat(200))), { timed: true });
add('bm25-unmatched-terms-affect-length-and-ranking', 'bm25', 'budget approval', [
  source('short.txt', 'budget approval'), source('long.txt', `budget approval ${diverse.join(' ')}`),
  source('repeated.txt', `${'budget-budget '.repeat(8)} ${'预算𠀀𠮷 '.repeat(16)} approval`),
  source('budget approval notes.txt', 'ordinary background'),
]);
add('bm25-token-emission-boundaries-and-caps', 'bm25', 'budget 123.45 预算', [
  source('budget budget 预算预算预算预算预算预算预算预算 123.45.txt', '  .BUDGET-BUDGET_ budget_budget. 123.45 123.45 的预算𠀀𠮷 ＢＵＤＧＥＴ １２３.４５'),
  source('different.txt', 'budget 123.54 预算'), source('fullwidth.txt', 'ＢＵＤＧＥＴ １２３.４５ 预算'),
], { matched: 2 });
// Slice boundaries must not bridge punctuation, Latin text or supplementary scalars.
const separators = ['/', '-', 'a', 'é', '1', '🦀', '\u0301'];
add('bm25-cjk-bigrams-stop-at-token-boundaries', 'bm25', '预算', [
  source('joined.txt', '预算'), ...separators.map((separator, i) => source(`boundary-${i}.txt`, `预${separator}算`)),
], { matched: 1, expectedSearch: { chunks: 8 } });
add('bm25-word-slices-after-cjk-and-nfkc', 'bm25', 'budget 123.45 café fi 预算', [
  source('mixed.txt', '__BUDGET-budget_的预算𠀀𠮷/foo.bar 123.45/İSTANBUL/cafe\u0301/ﬁ 预a算 𠀀é𠮷'),
  source('nfkc.txt', 'ＢＵＤＧＥＴ １２３.４５ café ﬁ 预算'), source('wrong-number.txt', 'budget 123.54 café fi 预算'),
], { matched: 2 });
add('files-2000-mixed-unicode-path', 'files', '预算 budget', Array.from({ length: 2000 }, (_, i) =>
  source(`${deepPath}__BUDGET-budget_的预算𠀀𠮷/foo.bar A12-B34/İSTANBUL/cafe\u0301/ﬁ-${i}.txt`)), { timed: true });
add('bm25-phrase-reuse-nfkc-and-chunk-boundaries', 'bm25', 'budget approval', [
  source('nfkc.txt', '背景材料 ＢＵＤＧＥＴ ＡＰＰＲＯＶＡＬ 已复核。\n'.repeat(80)),
  source('missing.txt', '背景材料仍待复核。\n'.repeat(80)),
  source('dash.txt', 'BUDGET-APPROVAL ordinary background\n'.repeat(80)),
  source('BUDGET APPROVAL filename.txt', 'unrelated background\n'.repeat(80)),
], { matched: 3 });
for (const query of ['the', '   ']) {
  add(`invalid-query-${JSON.stringify(query)}`, 'bm25', query, [source('budget.txt', 'ordinary')], { matched: null });
}

async function run(version, test) {
  const wasi = new InMemoryWasiHost({ files: { '/work/corpus.json': test.input }, captureStdio: true,
    args: ['converter-text', '--operation', 'search-text', '--input', '/work/corpus.json', '--output', '/work/output',
      '--source', 'json', '--target', 'text', '--result', '/work/result.json'] });
  const imports = { ...wasi.imports };
  for (const { module, name } of WebAssembly.Module.imports(modules[version])) {
    if (module === 'wasi_snapshot_preview1' && !imports[name]) imports[name] = () => { throw new Error(`Unexpected WASI call: ${name}`); };
  }
  const start = performance.now();
  const instance = await WebAssembly.instantiate(modules[version], { wasi_snapshot_preview1: imports,
    filens_text: { host_call: () => { throw new Error('Unexpected host conversion'); } } });
  wasi.setInstance(instance);
  try { instance.exports._start(); } catch (error) { if (error?.code !== 0) throw error; }
  const milliseconds = performance.now() - start;
  const wire = JSON.parse(new TextDecoder().decode(wasi.readFile('/work/result.json')));
  wire.metrics.elapsedMs = 0;
  assert.equal(wire.ok, test.matched !== null, `${test.name}: ${JSON.stringify(wire)}`);
  if (test.matched !== null) assert.equal(wire.payload.search.matchedFiles, test.matched, test.name);
  for (const [key, value] of Object.entries(test.expectedSearch)) assert.deepEqual(wire.payload.search[key], value, `${test.name}: ${key}`);
  return { wire, milliseconds, linearMemoryBytes: instance.exports.memory.buffer.byteLength };
}
const checks = [], timings = [];
for (const test of cases) {
  console.log(`Checking ${test.name}`);
  const baseline = await run('before', test), optimized = await run('after', test);
  assert.deepEqual(optimized.wire, baseline.wire, `${test.name}: full response differs`);
  const resultSha256 = sha256(JSON.stringify(baseline.wire));
  checks.push({ name: test.name, inputBytes: test.input.length, inputSha256: sha256(test.input), resultSha256,
    chunks: baseline.wire.payload?.search.chunks ?? null,
    linearMemoryBytes: { before: baseline.linearMemoryBytes, after: optimized.linearMemoryBytes } });
  if (checksOnly || !test.timed) continue;
  const samples = { before: [], after: [] };
  for (let round = -warmup; round < rounds; round++) {
    for (const version of round % 2 ? ['after', 'before'] : ['before', 'after']) {
      const result = await run(version, test);
      assert.equal(sha256(JSON.stringify(result.wire)), resultSha256, `${test.name}: nondeterministic ${version}`);
      if (round >= 0) samples[version].push(result.milliseconds);
    }
  }
  const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const beforeMs = median(samples.before), afterMs = median(samples.after);
  timings.push({ name: test.name, beforeMs, afterMs, speedup: beforeMs / afterMs, samples });
  console.log(`${test.name}: ${beforeMs.toFixed(3)} → ${afterMs.toFixed(3)} ms (${(beforeMs / afterMs).toFixed(2)}×)`);
}
const files = ['wasm/converter-core-rust/src/text/search.rs', 'wasm/converter-core-rust/Cargo.toml',
  'wasm/converter-core-rust/Cargo.lock', 'scripts/benchmark-batch-matching-round8.mjs', 'packages/converter-client/src/wasi-runner.ts',
  'wasm/converter-core-rust/examples/search_matching.rs'];
const sourceHashes = Object.fromEntries(await Promise.all(files.map(async f => [f, sha256(await readFile(path.join(root, f)))])));
const auditFile = option('--build-input-audit');
const buildInputAudit = auditFile ? JSON.parse(await readFile(auditFile, 'utf8')) : null;
if (buildInputAudit) {
  assert.equal(buildInputAudit.afterSha256, sizes.after.sha256, 'Build audit must describe the measured WASM');
  for (const [file, hash] of Object.entries(buildInputAudit.activeSourceHashes)) {
    assert.equal(sha256(await readFile(path.join(root, file))), hash, `Active build input changed: ${file}`);
  }
}
const snapshotFile = option('--source-baseline');
const snapshot = snapshotFile ? JSON.parse(gunzipSync(await readFile(snapshotFile))) : null;
const baselineSourceHashes = snapshot ? Object.fromEntries(Object.entries(snapshot.files).map(([f, source]) => [f, sha256(source)])) : null;
const report = { measuredAt: new Date().toISOString(), node: process.version, cpu: cpus()[0].model,
  platform: `${process.platform}-${process.arch}`, rounds, warmup, sourceHashes, baselineSourceHashes, baselineControl, buildInputAudit, sizes, checks, timings,
  build: { rust: '1.93.0', target: 'wasm32-wasip1', features: 'text-extraction,postscript', profile: 'release',
    env: 'privateRustBuildEnv', binaryen: '131.0.0', optimizer: '-Oz --strip-debug --strip-producers --enable-bulk-memory --enable-nontrapping-float-to-int' },
  timingScope: 'Full search-text operation in fresh production WASM instance via frontend InMemoryWasiHost in Node. Includes instantiate, in-memory input read/parse, search/ranking/serialization and result write. Excludes compile, host setup, fixture generation, output read, assertions and hashes. No OS file I/O, browser UI, extraction, OCR or CLI startup.' };
report.memoryScope = 'WASM linear-memory buffer byteLength after each full operation in a fresh instance. This memory cannot shrink, so it records its growth high-water mark; not native heap peak, resident physical memory or whole-process RSS.';
const output = path.resolve(option('--output', 'tmp/batch-matching-round8/report.json'));
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(`${checks.length} full-response comparisons passed; report: ${output}`);
