// Formula evaluation including lazy index construction; imports, input creation,
// complete-model verification and hashing are outside each timed region.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

const baselineAt = process.argv.indexOf('--baseline');
const baseline = baselineAt < 0 ? undefined : process.argv[baselineAt + 1];
if (baselineAt >= 0 && (!baseline || baseline.startsWith('--'))) throw new Error('--baseline requires a saved XLSX dist directory.');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const modules = { current: path.resolve('packages/xlsx/dist/index.js'), ...(baseline ? { baseline: path.resolve(baseline, 'index.js') } : {}) };
const engines = {}, bindings = {};
for (const [name, file] of Object.entries(modules)) {
  engines[name] = (await import(pathToFileURL(file).href)).resolveCellValue;
  bindings[name] = hash(await readFile(file));
}
function columnName(column) {
  let name = '';
  for (; column > 0; column = Math.floor((column - 1) / 26)) name = String.fromCharCode(65 + (column - 1) % 26) + name;
  return name;
}
function makeCase(name, rowCount, columnCount, rowStep, columnStep, formulaCount, warmIndex = false, pointReference = false) {
  const rows = [], values = [];
  for (let row = 1; row <= rowCount; row += rowStep) {
    const cells = [];
    for (let column = 1; column <= columnCount; column += columnStep) {
      const value = (row + column) % 17;
      values.push(value);
      cells.push({ ref: columnName(column) + row, row, column, value: String(value) });
    }
    rows.push({ index: row, cells });
  }
  const sum = values.reduce((sum, value) => sum + value, 0), formulaColumn = columnCount + 1;
  const formulaRows = new Map(rows.map(row => [row.index, row]));
  for (let row = 1; row <= formulaCount; row++) {
    let target = formulaRows.get(row);
    if (!target) { target = { index: row, cells: [] }; rows.push(target); formulaRows.set(row, target); }
    target.cells.push({ ref: columnName(formulaColumn) + row, row, column: formulaColumn, value: '',
      formula: pointReference ? '$A$1' : `SUM($A$1:${columnName(columnCount)}${rowCount})+${row - 1}`, needsCalculation: true });
  }
  rows.sort((a, b) => a.index - b.index);
  return { name, warmIndex, pointReference, model: { id: name, name, rows, rowCount, columnCount: formulaColumn },
    expected: Array.from({ length: formulaCount }, (_, i) => String(pointReference ? values[0] : sum + i)),
    occupiedSourceCells: values.length, rangeCoordinates: rowCount * columnCount };
}
const unordered = makeCase('index-build-unordered-tall', 32768, 4, 1, 1, 1, false, true);
unordered.model.rows.reverse();
const cases = [
  makeCase('sparse-rectangle-cold', 4096, 256, 64, 64, 8),
  makeCase('sparse-rectangle-warm', 4096, 256, 64, 64, 8, true),
  makeCase('dense-wide-cold', 256, 256, 1, 1, 8),
  makeCase('dense-tall-cold', 8192, 1, 1, 1, 32),
  makeCase('dense-tall-warm', 8192, 1, 1, 1, 32, true),
  makeCase('tiny-range-control', 2, 2, 1, 1, 1),
  makeCase('index-build-wide', 512, 256, 1, 1, 1, false, true),
  makeCase('index-build-tall', 32768, 4, 1, 1, 1, false, true),
  unordered
];
const report = { node: process.version, cpu: os.cpus()[0].model, platform: `${os.platform()}-${os.arch()}`,
  warmupIterations: 2, measuredIterations: 7, bindings, cases: {},
  timingScope: 'Formula evaluation and lazy index construction (except warm cases); excludes model cloning, imports, verification and hashing. Same-project synthetic comparison; not full preview or peak memory.' };
for (const entry of cases) {
  const samples = Object.fromEntries(Object.keys(engines).map(name => [name, []]));
  let outputHash;
  for (let iteration = 0; iteration < report.warmupIterations + report.measuredIterations; iteration++) {
    const order = Object.keys(engines); if (iteration % 2) order.reverse();
    for (const name of order) {
      const model = structuredClone(entry.model), formulas = model.rows.flatMap(row => row.cells.filter(cell => cell.formula));
      if (entry.warmIndex) engines[name](model, { ref: 'warm', row: 0, column: 0, value: '', formula: 'A1', needsCalculation: true });
      const start = performance.now();
      const actual = formulas.map(cell => engines[name](model, cell));
      const elapsedMs = performance.now() - start;
      assert.deepEqual(actual, entry.expected);
      const digest = hash(JSON.stringify(model)); outputHash ??= digest; assert.equal(digest, outputHash);
      if (iteration >= report.warmupIterations) samples[name].push(elapsedMs);
    }
  }
  const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  report.cases[entry.name] = { occupiedSourceCells: entry.occupiedSourceCells, rangeCoordinates: entry.rangeCoordinates,
    formulaCount: entry.expected.length, warmIndex: entry.warmIndex, pointReference: entry.pointReference,
    inputSha256: hash(JSON.stringify(entry.model)), outputSha256: outputHash,
    timings: Object.fromEntries(Object.entries(samples).map(([name, values]) => [name, { medianMs: median(values), samplesMs: values }])) };
}
console.log(JSON.stringify(report, null, 2));
