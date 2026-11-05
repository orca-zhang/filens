// Exercise the public frontend runner with real scalar/SIMD production modules.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import binaryen from 'binaryen';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const option = (name, fallback) => { const at = process.argv.indexOf(name); return at < 0 ? fallback : process.argv[at + 1]; };
const files = { scalar: option('--baseline', 'wasm/converter-core/dist/converter-text.wasm'),
  simd: option('--wasm', 'wasm/converter-core/dist/converter-text-simd.wasm') };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([kind, file]) => [kind, await readFile(file)])));
const bundled = await build({ entryPoints: [path.join(root, 'packages/converter-client/src/wasi-runner.ts')],
  bundle: true, write: false, platform: 'node', format: 'esm' });
const { createWasmCoreRunner } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].contents).toString('base64'));
const imports = { filens_text: { host_call: () => { throw new Error('search-text must not request extraction capabilities'); } } };
const scalar = createWasmCoreRunner({ wasm: bytes.scalar, imports });
let simdLoads = 0, scalarFallbacks = 0;
const simd = createWasmCoreRunner({ wasm: () => { scalarFallbacks++; return bytes.scalar; },
  simdWasm: () => { simdLoads++; return bytes.simd; }, imports });
const source = (name, text) => ({ path: `/corpus/${name}`, relativePath: name, text, sha256: '', complete: true });
const corpus = [
  source('Budget approval notes.txt', 'Budget approval 123.45 is pending; evidence is required.\n'.repeat(80)),
  source('材料/审批记录.txt', '预算 审批 已通过；编号 123.54。\n'.repeat(80)),
  source('sequence.txt', 'sequence ＢＵＤＧＥＴ ＡＰＰＲＯＶＡＬ café ﬃ ' + 'ordinary context '.repeat(8)),
  source('unrelated.txt', 'ordinary background'),
];
const checks = [];
for (const [mode, query] of [['bm25', 'budget approval'], ['files', 'budget approval'], ['exact', 'Budget approval'],
  ['bm25', 'q'], ['bm25', '123.45'], ['bm25', '预算 审批']]) {
  const input = new TextEncoder().encode(JSON.stringify({ files: corpus, mode, query, limit: 10, format: 'json' }));
  const invocation = { args: ['converter-text', '--operation', 'search-text', '--input', '/work/corpus.json',
    '--output', '/work/output', '--source', 'json', '--target', 'text', '--result', '/work/result.json'],
    files: { '/work/corpus.json': input }, readFiles: ['/work/result.json'] };
  const results = [];
  for (const run of [scalar, simd]) {
    const result = await run(invocation);
    assert.equal(result.exitCode, 0);
    const wire = JSON.parse(new TextDecoder().decode(result.files['/work/result.json']));
    assert(wire.ok && wire.payload.search.matchedFiles > 0);
    wire.metrics.elapsedMs = 0;
    results.push(wire);
  }
  assert.deepEqual(results[1], results[0]);
  checks.push({ mode, query, resultSha256: sha256(JSON.stringify(results[0])) });
}
assert.equal(simdLoads, 1);
assert.equal(scalarFallbacks, 0);
const instructionAudit = {};
for (const kind of ['scalar', 'simd']) {
  assert(WebAssembly.validate(bytes[kind]));
  const module = binaryen.readBinary(bytes[kind]);
  const instructions = {};
  for (const match of module.emitText().matchAll(/\((v128\.[\w_]+|[iu]\d+x\d+\.[\w_]+)/g)) {
    instructions[match[1]] = (instructions[match[1]] ?? 0) + 1;
  }
  module.dispose();
  instructionAudit[kind] = { sha256: sha256(bytes[kind]), simdInstructions: instructions };
}
assert.equal(Object.keys(instructionAudit.scalar.simdInstructions).length, 0);
assert(instructionAudit.simd.simdInstructions['i8x16.bitmask'] > 0);
const sources = ['packages/converter-client/src/wasi-runner.ts', 'packages/converter-client/src/wasm-simd.ts', 'scripts/test-search-simd.mjs'];
const sourceHashes = Object.fromEntries(await Promise.all(sources.map(async file => [file, sha256(await readFile(path.join(root, file)))])));
const report = { measuredAt: new Date().toISOString(), node: process.version, checks, simdLoads, scalarFallbacks, instructionAudit, sourceHashes };
const output = path.resolve(option('--output', 'tmp/batch-matching-round9/integration.json'));
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(`${checks.length} public-runner production comparisons passed; SIMD loads=${simdLoads}, scalar fallbacks=${scalarFallbacks}`);
