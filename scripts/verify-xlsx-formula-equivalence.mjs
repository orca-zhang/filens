// Compare values and all dependency/cache state against a saved production build.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const at = process.argv.indexOf('--baseline'), baseline = at < 0 ? undefined : process.argv[at + 1];
if (!baseline || baseline.startsWith('--')) throw new Error('--baseline requires a saved XLSX dist directory.');
const paths = { current: path.resolve('packages/xlsx/dist/index.js'), baseline: path.resolve(baseline, 'index.js') };
const engines = {}, bindings = {};
for (const [name, file] of Object.entries(paths)) {
  engines[name] = (await import(pathToFileURL(file).href)).resolveCellValue;
  bindings[name] = createHash('sha256').update(await readFile(file)).digest('hex');
}
const formulas = [
  'SUM(A1:A3)', 'SUM($A$3:$A$1)', 'SUM((A1:A3))', 'SUM((((A1:A3))))',
  'SUM(1E16,A1:A3,SUM(1,1))', 'SUM(1E16,SUM(A1:A3))', 'SUM(A1:A2,A2:A3)',
  'SUM(A1:A3,-A1)', 'SUM((A1:A3)+0)', 'SUM(A1:A3*2)', 'SUM(A1:A3^)',
  'SUM((A1:A3)', 'SUM(A1:A3,)', 'SUM(A1:A3,BOGUS(C1))', 'SUM(A1:A3)/0',
  'SUM(1/0,A1:A3)', 'A1:A3', '+A1:A3', '(A1:A3)', 'SUM((A1:A3),C1:C3)',
  'SUM(C1:C3)', 'SUM(A1:C3)', 'SUM(B1:B1)', 'SUM(1:(A1))', 'SUM((A1):A3)',
  'SUM(A1:A3,1)+SUM(A1:A2)', 'SUM()', 'SUM(1,2)', 'SUM(1E308,A1:A3)',
  'SUM(A1:A0)', 'SUM( 1E16, (( $A$1:A3 )),SUM(1,1))',
  'SUM(A1:A3+C1)', 'SUM((A1:A3)*C1)', 'SUM((A1:A3)^C1)', 'SUM(-(A1:A3),C1)',
  'SUM(0/0,C1)', 'SUM((A1:A3)+SUM(C1:C3))', 'SUM(((A1:A3)),C1)',
  '2^3^2', '-2^2', '2^-2', '1-2-3', '8/4/2', '1+2*3^2',
  'A1+A2*C1^2', 'A1^C1^A2', 'SUM(A1:A3)+C1*2^A2', '1constructor(C1)'
];
const values = [
  ['2', '3', '4'], ['-1E16', '1', '0'], ['1E308', '-1E308', '1E-308'],
  [' TRUE ', 'false', ''], ['text', '2', '3'], ['2', 'text', '3'],
  [' 2.5 ', '0x10', '-0'], ['Infinity', 'NaN', '3']
];
const layouts = ['ordered', 'reversed', 'duplicates'];
const inputHash = createHash('sha256'), outputHash = createHash('sha256');
let comparisons = 0;
for (const formula of formulas) for (const input of values) for (const layout of layouts) {
  const source = { id: 'equivalence', name: 'Equivalence', rowCount: 3, columnCount: 3,
    rows: input.map((value, index) => ({ index: index + 1, cells: [
      { ref: `A${index + 1}`, row: index + 1, column: 1, value },
      ...(index === 0 ? [{ ref: 'B1', row: 1, column: 2, value: '', formula, needsCalculation: true }] : []),
      { ref: `C${index + 1}`, row: index + 1, column: 3, value: index === 2 ? '3' : '',
        formula: ['A1*2', 'SUM(A1:A3)', 'UNSUPPORTED()'][index], needsCalculation: index !== 2 }
    ] })) };
  if (layout === 'reversed') { source.rows.reverse(); for (const row of source.rows) row.cells.reverse(); }
  if (layout === 'duplicates') {
    source.rows.unshift({ index: 2, cells: [{ ref: 'A2', row: 2, column: 1, value: '99' }] });
    source.rows.push({ index: 1, cells: [{ ref: 'A1', row: 1, column: 1, value: '7' }] });
  }
  inputHash.update(JSON.stringify(source) + '\n');
  const outputs = {};
  for (const [name, evaluate] of Object.entries(engines)) {
    const model = structuredClone(source), target = model.rows.flatMap(row => row.cells).find(cell => cell.ref === 'B1');
    outputs[name] = { value: evaluate(model, target), model };
  }
  assert.deepEqual(outputs.current, outputs.baseline, JSON.stringify({ formula, input, layout }));
  outputHash.update(JSON.stringify(outputs.current) + '\n');
  comparisons++;
}
console.log(JSON.stringify({ bindings, comparisons, formulaCount: formulas.length, valueCases: values.length, layouts,
  completeModelsEqual: true, inputSha256: inputHash.digest('hex'), outputSha256: outputHash.digest('hex') }, null, 2));
