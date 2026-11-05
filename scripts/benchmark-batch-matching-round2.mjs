// Compare complete production WASI operations, including fresh instance startup,
// input parsing, matching and result writing. Uses the frontend's actual in-memory
// WASI host in Node; no OCR/model work or operating-system file I/O is involved.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gzipSync, gunzipSync, brotliCompressSync } from 'node:zlib';
import { cpus } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const option = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : process.argv[at + 1];
};
const before = option('--baseline'), after = option('--wasm');
assert(before && after, '--baseline and --wasm require production converter-text WASM files');
const checksOnly = process.argv.includes('--checks-only');
const rounds = Number(option('--rounds', '9')), warmup = Number(option('--warmup', '3'));
assert(Number.isInteger(rounds) && rounds >= 1 && Number.isInteger(warmup) && warmup >= 0);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const hostBundle = await build({ entryPoints: [path.join(root, 'packages/converter-client/src/wasi-runner.ts')],
  bundle: true, write: false, format: 'esm', platform: 'node', target: 'node20' });
const { InMemoryWasiHost } = await import(`data:text/javascript;base64,${Buffer.from(hostBundle.outputFiles[0].contents).toString('base64')}`);
const modules = {}, sizes = {};
for (const [version, file] of Object.entries({ before, after })) {
  const bytes = await readFile(file);
  assert(bytes.length && WebAssembly.validate(bytes), `${version}: invalid WASM`);
  modules[version] = await WebAssembly.compile(bytes);
  sizes[version] = { bytes: bytes.length, gzip9: checksOnly ? null : gzipSync(bytes, { level: 9 }).length,
    brotli11: checksOnly ? null : brotliCompressSync(bytes).length, sha256: sha256(bytes) };
}
const cases = [];
function corpus(mode, files, query = 'needle') {
  return { mode, files, query, limit: 10, format: 'json' };
}
function source(name, text = '', extra = {}) {
  return { path: `/corpus/${name}`, relativePath: name, text, sha256: '', complete: true, ...extra };
}
function searchCase(name, input, check, timed = false) {
  cases.push({ name, operation: 'search-text', source: 'json', input: Buffer.from(JSON.stringify(input)),
    options: {}, check, timed });
}
const slide = content => strToU8(`<p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld><p:spTree>${content}</p:spTree></p:cSld></p:sld>`);
const picture = (id, target) => `<p:pic><p:nvPicPr><p:cNvPr id="${id}"/></p:nvPicPr><a:blip r:embed="${target}"/></p:pic>`;
const relationships = entries => strToU8(`<Relationships>${entries.map(([id, target]) => `<Relationship Id="${id}" Target="${target}"/>`).join('')}</Relationships>`);
// A tiny fully decodable PNG keeps the inventory benchmark focused on references.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII=', 'base64');
function officeFixture(slides, refsPerSlide, mediaCount, { duplicate = false, unused = false, shared = false } = {}) {
  const order = Array.from({ length: slides }, (_, i) => slides - i);
  if (duplicate) order.push(order[0]);
  const entries = {
    'ppt/presentation.xml': strToU8(`<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst>${order.map((n, i) => `<p:sldId r:id="s${i}"/>`).join('')}</p:sldIdLst></p:presentation>`),
    'ppt/_rels/presentation.xml.rels': relationships(order.map((n, i) => [`s${i}`, `slides/slide${n}.xml`])),
  };
  for (let n = 1; n <= slides; n++) {
    const ids = Array.from({ length: refsPerSlide }, (_, j) => (shared ? j : (n - 1) * refsPerSlide + j) % mediaCount);
    entries[`ppt/slides/slide${n}.xml`] = slide(ids.map((id, j) => picture(j + 1, `r${j}`)).join(''));
    entries[`ppt/slides/_rels/slide${n}.xml.rels`] = relationships(ids.map((id, j) => [`r${j}`, `../media/m${String(id).padStart(4, '0')}.png`]));
  }
  for (let i = 0; i < mediaCount; i++) entries[`ppt/media/m${String(i).padStart(4, '0')}.png`] = png;
  if (unused) entries['ppt/media/aaa-unused.png'] = png;
  return zipSync(entries, { level: 1 });
}
function mediaCase(name, input, options = {}, check, timed = false, source = 'pptx') {
  cases.push({ name, operation: 'extract-text', source, input,
    options: { ocr: 'never', media: true, includeStructure: true, ...options }, check, timed });
}

searchCase('exact-filename-fallback-after-prior-hits', corpus('exact', [
  source('a.txt', 'needle\nneedle\n'), source('needle-empty.txt'),
  source('needle-body.txt', 'needle'), source('miss.txt', 'background'),
]), p => { assert.equal(p.search.chunks, 4); assert.equal(p.search.matchedFiles, 3); });
searchCase('exact-relative-path-and-unicode', corpus('exact', [
  source('目录/预算.txt', '普通正文'), source('其他.txt', '预算上限：42。'), source('Budget.txt', 'ＢＵＤＧＥＴ'),
], '预算'), p => assert.equal(p.search.matchedFiles, 2));
searchCase('exact-punctuation-stopwords', corpus('exact', [source('the.txt', 'the!'), source('upper.txt', 'THE!')], 'the'),
  p => assert.equal(p.search.matchedFiles, 1));
searchCase('exact-empty-corpus', corpus('exact', []), p => assert.equal(p.search.chunks, 0));
searchCase('exact-chunk-cap-body', corpus('exact', [source('needle.txt', 'needle '.repeat(65536)), source('needle-empty.txt')]),
  p => { assert.equal(p.search.chunks, 65536); assert.equal(p.search.complete, false); assert.equal(p.search.matchedFiles, 1); });
searchCase('exact-chunk-cap-filename-fallback', corpus('exact', [
  source('a.txt', 'needle '.repeat(65535)), source('needle-empty.txt'), source('needle-over-cap.txt'),
]), p => { assert.equal(p.search.chunks, 65536); assert.equal(p.search.complete, false); assert.equal(p.search.matchedFiles, 2); });
searchCase('exact-chunk-cap-65537-filenames', corpus('exact', Array.from({ length: 65537 }, (_, i) => source(`needle-${i}.txt`))),
  p => { assert.equal(p.search.chunks, 65536); assert.equal(p.search.complete, false); assert.equal(p.search.matchedFiles, 65536); });
for (const mode of ['bm25', 'files']) {
  searchCase(`${mode}-scores-layout-provenance`, corpus(mode, [
    source('预算 approval 42 notes.txt', '预算 approval 42\n'.repeat(200), {
      layout: { blocks: [{ startByte: 0, endByte: 10, page: 2 }], pages: [{ index: 2 }] },
      document: { blocks: [{ startByte: 0, endByte: 10, source: 'ocr', confidence: 0.95 }] },
    }), source('approval.txt', 'budget 43'), source('无关.txt', 'background'),
  ], '预算 approval 42'), p => assert.equal(p.search.matchedFiles, 1));
}
for (const count of [32, 10000]) {
  searchCase(`exact-${count}-filename-hits`, corpus('exact', Array.from({ length: count }, (_, i) =>
    source(`报告/预算审批/needle-${i}.txt`, 'ordinary background'))),
  p => assert.equal(p.search.matchedFiles, count), true);
}
searchCase('exact-10000-no-hits', corpus('exact', Array.from({ length: 10000 }, (_, i) =>
  source(`报告/预算审批/other-${i}.txt`, 'ordinary background'))),
p => assert.equal(p.search.matchedFiles, 0), true);
searchCase('exact-5000-mixed-hits', corpus('exact', Array.from({ length: 5000 }, (_, i) =>
  source(`needle-${i}.txt`, i % 2 ? '' : 'needle '.repeat(4)))),
p => { assert.equal(p.search.matchedFiles, 5000); assert.equal(p.search.chunks, 12500); }, true);
searchCase('bm25-1000-control', corpus('bm25', Array.from({ length: 1000 }, (_, i) =>
  source(`budget-${i}.txt`, 'needle budget approval '.repeat(12)))),
p => assert.equal(p.search.matchedFiles, 1000), true);

const ordered = officeFixture(3, 2, 6, { unused: true });
mediaCase('media-presentation-and-lexical-order', ordered, {}, p => {
  assert.deepEqual(p.media.map(m => m.name), [4, 5, 2, 3, 0, 1].map(i => `ppt/media/m000${i}.png`).concat('ppt/media/aaa-unused.png'));
  assert.deepEqual(p.media.map(m => m.usedBy[0]?.slide ?? null), [1, 1, 2, 2, 3, 3, null]);
});
mediaCase('media-slide-selection-images', ordered, { slides: '2,2', images: true }, p => {
  assert.equal(p.imagesInfo.available, 2); assert.equal(p.imagesInfo.returned, 2);
});
mediaCase('media-explicit-unused-image', ordered, { images: true, imageNames: ['ppt/media/aaa-unused.png'] },
  p => assert.equal(p.imagesInfo.available, 1));
mediaCase('media-duplicate-slide-first-position', officeFixture(3, 2, 6, { duplicate: true }), {}, p => {
  assert.equal(p.media[0].usedBy[0].slide, 1);
  assert(p.media.every(m => m.usedBy.every(r => r.slide <= 3)));
});
mediaCase('media-shared-and-image-limit', officeFixture(8, 6, 6, { shared: true }), { images: true, maxImages: 2 }, p => {
  assert.equal(p.media.length, 6); assert(p.media.every(m => m.usedBy.length === 8));
  assert.equal(p.imagesInfo.available, 6); assert.equal(p.imagesInfo.returned, 2); assert.equal(p.complete, false);
});
mediaCase('media-invalid-image-name', ordered, { images: true, imageNames: ['ppt/media/missing.png'] },
  p => { assert.equal(p.complete, false); assert.equal(p.errorCode, 'invalid_request'); });
mediaCase('media-invalid-slide-selection', ordered, { slides: '4' },
  p => { assert.equal(p.complete, false); assert.equal(p.errorCode, 'invalid_request'); });
mediaCase('media-docx-without-slide-positions', zipSync({
  'word/document.xml': strToU8('<w:document xmlns:w="w" xmlns:a="a" xmlns:r="r"><w:body><w:p><w:r><w:t>Document</w:t></w:r></w:p><a:blip r:embed="z"/><a:blip r:embed="a"/></w:body></w:document>'),
  'word/_rels/document.xml.rels': relationships([['z', 'media/z.png'], ['a', 'media/a.png']]),
  'word/media/z.png': png, 'word/media/a.png': png, 'word/media/m-unused.png': png,
}), { images: true }, p => {
  assert.deepEqual(p.media.map(m => m.name), ['word/media/a.png', 'word/media/m-unused.png', 'word/media/z.png']);
  assert(p.media.every(m => m.usedBy.every(r => r.slide === null)));
  assert.equal(p.imagesInfo.available, 2); assert.equal(p.imagesInfo.returned, 2);
}, false, 'docx');
for (const [slides, refs, media] of [[8, 2, 16], [1000, 16, 1024]]) {
  mediaCase(`media-${slides}-slides-${slides * refs}-references`, officeFixture(slides, refs, media), {},
    p => { assert.equal(p.media.length, media); assert.equal(p.media.reduce((n, m) => n + m.usedBy.length, 0), slides * refs); }, true);
}

async function run(version, test) {
  const wasi = new InMemoryWasiHost({ files: { '/work/input': test.input, '/work/options.json': test.optionsBytes }, captureStdio: true,
    args: ['converter-text', '--operation', test.operation, '--input', '/work/input', '--output', '/work/output',
      '--source', test.source, '--target', 'text', '--result', '/work/result.json', '--options', '/work/options.json'] });
  const start = performance.now();
  // The text binary links directory APIs that these operations never call.
  // Fail if one is actually used; all exercised I/O goes through the real host.
  const imports = { ...wasi.imports };
  for (const { module, name } of WebAssembly.Module.imports(modules[version])) {
    if (module === 'wasi_snapshot_preview1' && !imports[name]) imports[name] = () => { throw new Error(`Unexpected WASI call: ${name}`); };
  }
  const instance = await WebAssembly.instantiate(modules[version], { wasi_snapshot_preview1: imports,
    filens_text: { host_call: () => { throw new Error('Unexpected OCR/PDF host call'); } } });
  wasi.setInstance(instance);
  try { instance.exports._start(); } catch (error) { if (error?.code !== 0) throw error; }
  const milliseconds = performance.now() - start;
  const wire = JSON.parse(new TextDecoder().decode(wasi.readFile('/work/result.json')));
  wire.metrics.elapsedMs = 0;
  test.check(wire.payload);
  return { wire, milliseconds };
}
{
  const checks = [], timings = [];
  for (const test of cases) {
    console.log(`Checking ${test.name}`);
    test.optionsBytes = Buffer.from(JSON.stringify(test.options));
    const baseline = await run('before', test);
    const optimized = await run('after', test);
    assert.deepEqual(optimized.wire, baseline.wire, `${test.name}: complete response differs`);
    const expectedHash = sha256(JSON.stringify(baseline.wire));
    checks.push({ name: test.name, inputBytes: test.input.length, resultSha256: expectedHash });
    if (checksOnly || !test.timed) continue;
    const samples = { before: [], after: [] };
    for (let round = -warmup; round < rounds; round++) {
      for (const version of round % 2 ? ['after', 'before'] : ['before', 'after']) {
        const result = await run(version, test);
        assert.equal(sha256(JSON.stringify(result.wire)), expectedHash, `${test.name}: nondeterministic ${version}`);
        if (round >= 0) samples[version].push(result.milliseconds);
      }
    }
    const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const beforeMs = median(samples.before), afterMs = median(samples.after);
    timings.push({ name: test.name, beforeMs, afterMs, speedup: beforeMs / afterMs, samples });
    console.log(`${test.name}: ${beforeMs.toFixed(3)} → ${afterMs.toFixed(3)} ms (${(beforeMs / afterMs).toFixed(2)}×)`);
  }
  const files = ['wasm/converter-core-rust/src/text/inspect.rs', 'wasm/converter-core-rust/src/text/search.rs',
    'wasm/converter-core-rust/Cargo.lock', 'scripts/benchmark-batch-matching-round2.mjs',
    'packages/converter-client/src/wasi-runner.ts'];
  const sourceHashes = Object.fromEntries(await Promise.all(files.map(async f => [f, sha256(await readFile(path.join(root, f)))])));
  const snapshotPath = option('--source-baseline');
  const snapshot = snapshotPath ? JSON.parse(gunzipSync(await readFile(snapshotPath))) : null;
  const baselineSourceHashes = snapshot ? Object.fromEntries(Object.entries(snapshot.files ?? snapshot).map(([file, source]) => [file, sha256(source)])) : null;
  const report = { measuredAt: new Date().toISOString(), node: process.version, cpu: cpus()[0].model,
    platform: `${process.platform}-${process.arch}`, rounds, warmup, sourceHashes, baselineSourceHashes, sizes, checks, timings,
    build: { rust: '1.93.0', features: 'text-extraction,postscript', target: 'wasm32-wasip1', profile: 'release',
      env: 'scripts/agent-release-privacy.mjs: privateRustBuildEnv', binaryen: '131.0.0',
      optimizer: '-Oz --strip-debug --strip-producers --enable-bulk-memory --enable-nontrapping-float-to-int' },
    timingScope: 'Frontend InMemoryWasiHost in Node: fresh WASM instantiate + full operation including in-memory input read/parse and result write. Compile, host setup, fixture generation, result read/parse, assertions and hashing excluded. OCR never; no inference. No browser UI, native Node WASI, OS file I/O or CLI startup.' };
  const output = path.resolve(option('--output', 'tmp/batch-matching-round2/report.json'));
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(`${checks.length} complete-response comparisons passed; report: ${output}`);
}
