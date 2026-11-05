// Formula evaluation only. Models, module imports and complete hashes are outside timing.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

const baselineIndex = process.argv.indexOf('--baseline');
const baseline = baselineIndex < 0 ? undefined : process.argv[baselineIndex + 1];
if (baselineIndex >= 0 && (!baseline || baseline.startsWith('--'))) throw new Error('--baseline requires a saved XLSX dist directory.');
const modules = { current: path.resolve('packages/xlsx/dist/index.js'), ...(baseline ? { baseline: path.resolve(baseline, 'index.js') } : {}) };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const result = { node: process.version, cpu: os.cpus()[0].model, warmupIterations: 2, measuredIterations: 7, bindings: {}, cases: {} };
const engines = {};
for (const [name, file] of Object.entries(modules)) {
  engines[name] = (await import(pathToFileURL(file).href)).resolveCellValue;
  result.bindings[name] = hash(await readFile(file));
}
for (const [name, count, formulaCount, warmIndex] of [
  ['range-cold-index', 8192, 32, false],
  ['range-warm-index', 8192, 32, true],
  ['single-cell-control', 1, 8192, false]
]) {
  const source = {
    id: 'sum', name: 'Sum', columnCount: 2, rowCount: Math.max(count, formulaCount),
    rows: Array.from({ length: Math.max(count, formulaCount) }, (_, index) => ({ index: index + 1, cells: [
      ...(index < count ? [{ ref: `A${index + 1}`, row: index + 1, column: 1, value: String(index + 1) }] : []),
      ...(index < formulaCount ? [{ ref: `B${index + 1}`, row: index + 1, column: 2, value: '', formula: count === 1 ? '$A$1+2' : `SUM($A$1:A${count})+${index}`, needsCalculation: true }] : [])
    ] }))
  };
  const samples = Object.fromEntries(Object.keys(engines).map(engine => [engine, []]));
  let outputHash;
  for (let iteration = 0; iteration < result.warmupIterations + result.measuredIterations; iteration++) {
    const order = Object.keys(engines); if (iteration % 2) order.reverse();
    for (const engine of order) {
      const model = structuredClone(source), formulas = model.rows.flatMap(row => row.cells.filter(cell => cell.formula));
      if (warmIndex) engines[engine](model, { ref: 'Z1', row: 1, column: 26, value: '', formula: 'A1', needsCalculation: true });
      const start = performance.now();
      const values = formulas.map(cell => engines[engine](model, cell));
      const elapsedMs = performance.now() - start;
      assert.deepEqual(values, Array.from({ length: formulaCount }, (_, index) => count === 1 ? '3' : String(count * (count + 1) / 2 + index)));
      const digest = hash(JSON.stringify(model)); outputHash ??= digest; assert.equal(digest, outputHash);
      if (iteration >= result.warmupIterations) samples[engine].push(elapsedMs);
    }
  }
  const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  result.cases[name] = { referencedCells: count, formulaCount, warmIndex, inputSha256: hash(JSON.stringify(source)), outputSha256: outputHash,
    timings: Object.fromEntries(Object.entries(samples).map(([engine, values]) => [engine, { medianMs: median(values), samplesMs: values }])) };
}
console.log(JSON.stringify(result, null, 2));
