// Build @filens/core, @filens/cad and @filens/converter-client plus the WASM core first.
// Optional --baseline <old-graphics.wasm> compares the former DWG -> DXF path.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { createWasmConverterClient } from '../packages/converter-client/dist/index.js';
import { loadCadDrawing, loadDxfDrawing } from '../packages/cad/dist/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const auditDirectory = path.join(root, 'tmp/dwg-reader-final-audit');
const directory = path.join(auditDirectory, 'corpus');
await mkdir(directory, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fixtures = JSON.parse(await readFile(new URL('./fixtures/dwg-corpus.json', import.meta.url), 'utf8'));
for (const fixture of fixtures) {
  fixture.path = path.join(directory, path.basename(fixture.url));
  let bytes;
  try { bytes = await readFile(fixture.path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!bytes) {
    const response = await fetch(fixture.url, { signal: AbortSignal.timeout(30_000) });
    assert(response.ok, `Download ${fixture.url}: ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(hash(bytes), fixture.sha256, `Changed upstream fixture: ${fixture.url}`);
    await writeFile(fixture.path, bytes);
  }
  assert.equal(hash(bytes), fixture.sha256);
  assert.equal(bytes.length, fixture.size);
  assert.equal(bytes.subarray(0, 6).toString(), fixture.header);
}
for (const version of ['2000', '2018']) {
  const file = path.join(root, `apps/demo/public/samples/graphics/filens-cafe-${version}.dwg`);
  const bytes = await readFile(file);
  fixtures.push({ path: file, sha256: hash(bytes), header: bytes.subarray(0, 6).toString(), url: null });
}
const wasmBytes = await readFile(path.join(root, 'wasm/converter-core/dist/converter-cad.wasm'));
const current = createWasmConverterClient({ wasm: await WebAssembly.compile(wasmBytes) });
const baselineFlag = process.argv.indexOf('--baseline');
const baselineBytes = baselineFlag < 0 ? null : await readFile(process.argv[baselineFlag + 1]);
const baseline = baselineBytes ? createWasmConverterClient({ wasm: await WebAssembly.compile(baselineBytes) }) : null;
const context = { descriptor: { source: new Uint8Array() } };
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const countTypes = drawing => drawing.entities.reduce((counts, entity) => {
  counts[entity.type] = (counts[entity.type] ?? 0) + 1;
  return counts;
}, {});
const rows = [];
for (const fixture of fixtures) {
  const source = await readFile(fixture.path);
  const open = async old => {
    const started = performance.now();
    const result = await (old ? baseline : current).convert({ source, sourceFormat: 'dwg', targetFormat: old ? 'dxf' : 'cad-json' }, context);
    const text = new TextDecoder().decode(result.source);
    const drawing = old ? loadDxfDrawing(text) : loadCadDrawing(text);
    return { drawing, elapsed: performance.now() - started, outputBytes: result.source.length };
  };
  const first = await open(false);
  assert(first.drawing.entities.length > 0, `Empty preview: ${fixture.path}`);
  assert(Object.values(first.drawing.bounds).every(Number.isFinite), `Non-finite bounds: ${fixture.path}`);
  const times = [], oldTimes = [];
  let oldResult, baselineError;
  for (let round = 0; round < 11; round++) {
    // Alternate order; discard two warmup runs and report nine-run medians.
    for (const old of round % 2 ? [true, false] : [false, true]) {
      if (old && (!baseline || baselineError)) continue;
      try {
        const result = await open(old);
        if (old) oldResult = result;
        if (round >= 2) (old ? oldTimes : times).push(result.elapsed);
      } catch (error) { if (!old) throw error; baselineError = error.message; }
    }
  }
  const drawing = first.drawing;
  const row = { file: path.basename(fixture.path), sha256: fixture.sha256, header: fixture.header,
    entities: drawing.entities.length, layers: drawing.layers.length, types: countTypes(drawing),
    warnings: drawing.warnings, bounds: drawing.bounds, outputBytes: first.outputBytes, medianMs: median(times), samplesMs: times,
    ...(oldResult ? { baseline: { entities: oldResult.drawing.entities.length, types: countTypes(oldResult.drawing),
      outputBytes: oldResult.outputBytes, medianMs: median(oldTimes), samplesMs: oldTimes } } : {}), ...(baselineError ? { baselineError } : {}) };
  rows.push(row);
  console.log(`${row.file}: ${row.header}, ${row.entities} entities, ${row.layers} layers, ${row.medianMs.toFixed(1)} ms${oldResult ? ` (old ${median(oldTimes).toFixed(1)} ms)` : ''}`);
}
const size = bytes => ({ raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length,
  brotli: brotliCompressSync(bytes).length, sha256: hash(bytes) });
const report = { date: new Date().toISOString(), runtime: process.version,
  platform: `${process.platform}-${process.arch}`, cpu: os.cpus()[0]?.model,
  timing: 'Node, compiled WASM reused; WASI instantiation, decoding, serialization and TS drawing load included; no SVG layout, DOM paint or network. Alternating order, two warmups, nine measured runs per path.',
  current: size(wasmBytes), ...(baselineBytes ? { baseline: size(baselineBytes) } : {}), rows };
await writeFile(path.join(auditDirectory, 'dwg-preview-audit.json'), JSON.stringify(report, null, 2) + '\n');
