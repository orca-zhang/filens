// Browser benchmark of the shipped truck reader against upstream OCCT.
// Geometry checks reuse the independent Rust-engine screen, outside timing.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { chromium } from '@playwright/test';
import { compareGeometry, geometryStats } from '../benchmarks/rust-engines/step-metrics.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseline = process.argv.find(arg => arg.startsWith('--baseline='))?.slice('--baseline='.length);
if (baseline && (path.isAbsolute(baseline) || baseline.split(/[\\/]/).includes('..'))) throw new Error('Baseline directory must be repository-relative.');
const iterations = 7;
const corpus = 'tmp/rust-engines/source/occt-import-js-0.0.23/test/testfiles';
const fixtures = ['simple-basic-cube/cube.stp', 'rounded-cube/rounded-cube.step',
  'cax-if/as1_pe_203.stp', 'cax-if/as1-oc-214.stp', 'cax-if/dm1-oc-214.stp', 'cax-if/s1-tu-203/tailturbine.stp'];
const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
const output = path.join(root, 'benchmarks/frontend', date);
await mkdir(output, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const bindings = JSON.parse(await readFile(path.join(root, 'docs/assets/rust-engines/results-step-refined.json')));
const samples = await Promise.all(fixtures.map(async id => {
  const sha256 = hash(await readFile(path.join(root, corpus, id)));
  assert.equal(sha256, bindings.step.find(row => row.id === id)?.sha256, `Fixture binding: ${id}`);
  return { id, sha256 };
}));
const artifactFiles = ['scripts/benchmark-step-default.mjs', 'benchmarks/rust-engines/step-metrics.mjs',
  'packages/step/dist/index.js', 'packages/step/vendor/filens-step.wasm',
  'node_modules/occt-import-js/dist/occt-import-js.js', 'node_modules/occt-import-js/dist/occt-import-js.wasm',
  ...(baseline ? [`${baseline}/baseline-reader.mjs`, `${baseline}/baseline.wasm`] : [])];
const artifacts = await Promise.all(artifactFiles.map(async file => {
  const bytes = await readFile(path.join(root, file));
  return { file, sha256: hash(bytes), raw: bytes.length };
}));
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/') return res.setHeader('Content-Type', 'text/html').end('<!doctype html>');
    const file = path.resolve(root, decodeURIComponent(url.pathname).slice(1));
    if (!file.startsWith(root + path.sep)) return res.writeHead(404).end();
    const bytes = await readFile(file);
    res.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : /\.m?js$/.test(file) ? 'text/javascript' : 'application/octet-stream');
    res.end(bytes);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
const runs = [], comparisons = [], geometry = new Map();
try {
  browser = await chromium.launch({ headless: true });
  for (const sample of samples) {
    for (let iteration = 0; iteration < iterations; iteration++) {
      const engines = baseline ? ['truck', 'occt', 'truck-baseline'] : ['truck', 'occt'];
      const offset = iteration % engines.length;
      for (const engine of [...engines.slice(offset), ...engines.slice(0, offset)]) {
        const context = await browser.newContext();
        try {
          const page = await context.newPage();
          const errors = [];
          page.on('pageerror', error => errors.push(error.message));
          await page.goto(`http://127.0.0.1:${server.address().port}`);
          const measured = await page.evaluate(async ({ engine, id, corpus, iteration, baseline }) => {
            const bytes = new Uint8Array(await (await fetch(`/${corpus}/${id}`)).arrayBuffer());
            const wasmPath = engine === 'truck-baseline' ? `/${baseline}/baseline.wasm`
              : engine === 'truck' ? '/packages/step/vendor/filens-step.wasm' : '/node_modules/occt-import-js/dist/occt-import-js.wasm';
            const wasm = await WebAssembly.compile(await (await fetch(wasmPath)).arrayBuffer());
            let read, initMs = 0;
            if (engine !== 'occt') {
              const { createStepReader } = await import(engine === 'truck-baseline' ? `/${baseline}/baseline-reader.mjs` : '/packages/step/dist/index.js');
              const reader = createStepReader({ wasm });
              read = () => reader.read(bytes, { tolerance: 0.1 });
            } else {
              await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = '/node_modules/occt-import-js/dist/occt-import-js.js';
                script.onload = resolve; script.onerror = reject; document.head.append(script);
              });
              const start = performance.now();
              const importer = await window.occtimportjs({
                instantiateWasm(imports, ready) { WebAssembly.instantiate(wasm, imports).then(instance => ready(instance, wasm)); return {}; },
                print() {}, printErr() {}
              });
              initMs = performance.now() - start;
              read = () => importer.ReadStepFile(bytes, { linearUnit: 'millimeter',
                linearDeflectionType: 'absolute_value', linearDeflection: 0.1, angularDeflection: 0.5 });
            }
            const start = performance.now();
            const mesh = await read();
            const operationMs = performance.now() - start;
            const positions = [], normals = [];
            if (engine !== 'occt') {
              for (let i = 0; i < mesh.positions.length; i += 3) {
                positions.push(Array.from(mesh.positions.subarray(i, i + 3)));
                normals.push(Array.from(mesh.normals.subarray(i, i + 3)));
              }
            } else {
              if (!mesh.success) throw new Error('OCCT import failed');
              for (const part of mesh.meshes) for (const index of part.index.array) {
                positions.push(part.attributes.position.array.slice(index * 3, index * 3 + 3));
                normals.push(part.attributes.normal.array.slice(index * 3, index * 3 + 3));
              }
            }
            if (!positions.length || positions.length % 3 || [...positions, ...normals].some(v => v.some(x => !Number.isFinite(x)))) throw new Error('Invalid geometry');
            const canonical = JSON.stringify(Array.from({ length: positions.length / 3 }, (_, i) =>
              JSON.stringify([positions.slice(i * 3, i * 3 + 3), normals.slice(i * 3, i * 3 + 3)])).sort());
            const meshSha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))), x => x.toString(16).padStart(2, '0')).join('');
            return { operationMs, initMs, initializedReadMs: initMs + operationMs, triangles: positions.length / 3,
              meshSha256, missingFaces: mesh.metadata?.missingFaces ?? null,
              parseMs: mesh.metadata?.parseMs ?? null, meshMs: mesh.metadata?.meshMs ?? null,
              ...(iteration === 0 ? { geometry: { positions, normals } } : {}) };
          }, { engine, id: sample.id, corpus, iteration, baseline });
          assert.deepEqual(errors, []);
          if (measured.geometry) { geometry.set(engine, measured.geometry); delete measured.geometry; }
          runs.push({ sample: sample.id, engine, iteration, ...measured });
        } finally { await context.close(); }
      }
    }
    const reference = geometry.get('occt'), candidate = geometry.get('truck');
    const screen = compareGeometry(reference, candidate), referenceStats = geometryStats(reference);
    const geometryScreenPass = screen.boundsRelativeError < 0.01 && screen.areaRelativeError < 0.03
      && screen.volumeRelativeError < 0.05 && Math.max(screen.referenceToCandidate.p95, screen.candidateToReference.p95) <= Math.max(0.2, referenceStats.diagonal * 0.001);
    const ours = runs.filter(r => r.sample === sample.id && r.engine === 'truck');
    const theirs = runs.filter(r => r.sample === sample.id && r.engine === 'occt');
    const interval = timingInterval(ours, theirs);
    const filensMs = median(ours.map(r => r.operationMs)), peerMs = median(theirs.map(r => r.operationMs));
    const repeatableMeshes = [ours, theirs].every(rows => new Set(rows.map(r => r.meshSha256)).size === 1);
    const completeFaces = ours.every(r => r.missingFaces === 0);
    const row = { sample: sample.id, truckTriangles: ours[0].triangles, occtTriangles: theirs[0].triangles,
      filensMs, peerMs, ratio: peerMs / filensMs, ratio95PercentBootstrapInterval: interval,
      truckInitializedReadMs: median(ours.map(r => r.initializedReadMs)), occtInitializedReadMs: median(theirs.map(r => r.initializedReadMs)),
      repeatableMeshes, completeFaces, geometryScreenPass, screen,
      scopedSota: repeatableMeshes && completeFaces && geometryScreenPass && peerMs > 10 && interval[0] > 1 };
    if (baseline) {
      const previous = runs.filter(r => r.sample === sample.id && r.engine === 'truck-baseline');
      row.baselineMs = median(previous.map(r => r.operationMs));
      row.baselineSpeedup = row.baselineMs / filensMs;
      row.baselineSpeedup95PercentBootstrapInterval = timingInterval(ours, previous);
      row.baselineMeshMatches = previous.every((r, i) => r.meshSha256 === ours[i].meshSha256);
      assert(row.baselineMeshMatches, `Transport optimization changed mesh: ${sample.id}`);
    }
    comparisons.push(row);
    console.log(JSON.stringify(row));
  }
  const report = { date, cpu: os.cpus()[0].model, platform: `${process.platform}-${process.arch}`, browser: browser.version(), iterations,
    peer: 'occt-import-js 0.0.23',
    method: 'Fresh browser context per read; rotating engine order. Inputs, JS and compiled WASM ready before timing. truck uses the shipped createStepReader, including fresh WASI instantiation, parsing, meshing, binary Float32 mesh I/O and typed-array validation. Optional truck-baseline uses the previous JSON reader/core on the same inputs and is an engineering comparison, excluded from peer rankings. OCCT operation is ReadStepFile; its initialization is separately recorded and included in initializedReadMs. Absolute tolerance 0.1 mm; OCCT angular deflection 0.5. No network, compilation, Three.js scene construction or rendering in timings. Seven paired reads, 10000 paired percentile bootstrap resamples, LCG seed 12345. SOTA is scoped to these fixtures, this peer and approximate geometry import: lower 95% ratio bound >1, peer >10 ms, repeatable finite meshes, no missing truck faces and independent geometry screen pass. Screen is bounds <1%, area <3%, signed volume <5%, bidirectional sampled distance P95 <= max(0.2 mm, 0.1% diagonal); not a maximum-error guarantee or exact mesh/metadata equivalence.',
    samples, artifacts, runs, comparisons };
  const raw = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
  await writeFile(path.join(output, 'step-default.json.gz'), gzipSync(raw, { level: 9 }));
  const { runs: _runs, ...summary } = report;
  await writeFile(path.join(output, 'step-default-summary.json'), `${JSON.stringify({ ...summary, totalRuns: runs.length, sourceSha256: hash(raw) }, null, 2)}\n`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}

function median(values) { return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]; }
function timingInterval(ours, theirs) {
  let state = 12345;
  const ratios = Array.from({ length: 10000 }, () => {
    const indices = ours.map(() => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return Math.floor(state / 2 ** 32 * iterations); });
    return median(indices.map(i => theirs[i].operationMs)) / median(indices.map(i => ours[i].operationMs));
  }).sort((a, b) => a - b);
  return [ratios[250], ratios[9750]];
}
