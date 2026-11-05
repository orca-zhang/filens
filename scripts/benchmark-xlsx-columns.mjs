// Complete XLSX-to-model benchmark in Node; excludes rendering and module loading.
// Build @filens/core and @filens/xlsx first. An optional --baseline directory
// contains the previous XLSX dist/index.js and its supporting chunks.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { createColumnStyledWorkbookFixture } from '../packages/xlsx/test/fixtures/workbook.mjs';

const baselineIndex = process.argv.indexOf('--baseline');
const baseline = baselineIndex < 0 ? undefined : process.argv[baselineIndex + 1];
if (baselineIndex >= 0 && (!baseline || baseline.startsWith('--'))) throw new Error('--baseline requires a directory.');
const modules = { current: path.resolve('packages/xlsx/dist/index.js'), ...(baseline ? { baseline: path.resolve(baseline, 'index.js') } : {}) };
const engines = {};
const result = { node: process.version, cpu: os.cpus()[0].model, rows: 2000, columns: 64,
  warmupIterations: 2, measuredIterations: 7, bindings: {}, cases: {} };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
for (const [name, file] of Object.entries(modules)) {
  engines[name] = (await import(pathToFileURL(file).href)).loadXlsxWorkbook;
  result.bindings[name] = hash(await readFile(file));
}
result.bindings.core = hash(await readFile('packages/core/dist/index.js'));

for (const [name, options] of [
  ['numeric-without-columns', { columnStyles: false }],
  ['numeric-with-columns', {}],
  ['numeric-with-sheetdata-attributes', { sheetDataAttributes: ' custom="1"' }],
  ['general-with-columns', { general: true }]
]) {
  const bytes = await createColumnStyledWorkbookFixture(result.rows, result.columns, options);
  const samples = Object.fromEntries(Object.keys(engines).map(engine => [engine, []]));
  let modelHash;
  for (let iteration = 0; iteration < result.warmupIterations + result.measuredIterations; iteration++) {
    const order = Object.keys(engines);
    if (iteration % 2) order.reverse();
    for (const engine of order) {
      const start = performance.now();
      const workbook = await engines[engine](bytes);
      const elapsedMs = performance.now() - start;
      const sheet = workbook.sheets[0];
      assert.equal(workbook.sheets.length, 1);
      assert.equal(workbook.warnings.length, 0);
      assert.equal(sheet.rows.length, result.rows);
      assert.equal(sheet.columnCount, result.columns);
      assert(sheet.rows.every(row => row.cells.length === result.columns));
      const currentHash = hash(JSON.stringify(workbook));
      modelHash ??= currentHash;
      assert.equal(currentHash, modelHash, `${name}/${engine}: complete model changed`);
      if (iteration >= result.warmupIterations) samples[engine].push(elapsedMs);
    }
  }
  const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  result.cases[name] = { archiveBytes: bytes.length, archiveSha256: hash(bytes), modelSha256: modelHash,
    timings: Object.fromEntries(Object.entries(samples).map(([engine, values]) => [engine, { medianMs: median(values), samplesMs: values }])) };
}
console.log(JSON.stringify(result, null, 2));
