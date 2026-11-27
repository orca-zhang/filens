import { openZipArchive } from '@filens/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorksheetCellIndex } from '../src/cell-index';
import { displaySpillCell, evaluateWorksheetFormula, resolveCellValue } from '../src/cell-value';
import { withFormulaTime } from '../src/formula-clock';
import { FormulaError, FormulaReader } from '../src/formula-reader';
import { captureError, FormulaCalculationLimit, MAX_DENSE_ARRAY_SCAN, mergeOccupiedPositions } from '../src/formula-array';
import { loadXlsxWorkbook } from '../src/parser';
import { createSheetTable } from '../src/table';
import type { ParsedCell, ParsedSheet } from '../src/types';
import { sheetTracks } from '../src/visible-tracks';
import { clonePreviewWorkbook } from '../src/workbook-cache';
import { createAccumulationWorkbook, createArrayPredicateWorkbook, createArraySpillWorkbook, createBroadcastWorkbook, createChoiceCriteriaWorkbook, createCoordinateFormulaWorkbook, createCountBlankWorkbook,
  createDistinctRecordWorkbook, createFlattenSpillWorkbook, createGroupByWorkbook, createLambdaWorkbook, createMapWorkbook, createOffsetWorkbook, createOrderedConditionalWorkbook, createPivotByWorkbook, createSequenceWorkbook, createSliceSpillWorkbook,
  createSortSpillWorkbook, createStackSpillWorkbook, createTrimRangeWorkbook, createWorkdayArrayWorkbook, createWrapExpandWorkbook, createXlookupSpillWorkbook, createXmatchWorkbook } from './fixtures/array-selection-workbook.mjs';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('declared worksheet array formulas', () => {
  it.each([
    ['{2;4;6}*{3,5}', 3, 2, [6, 10, 12, 20, 18, 30]],
    ['{1,2,3;4,5,6}*{10,100}', 2, 3, [10, 200, '#N/A', 40, 500, '#N/A']],
    ['{2;4;6;8}*{2;2}', 4, 1, [4, 8, '#N/A', '#N/A']],
    ['{1,2;3,4}+{10,20,30;40,50,60;70,80,90}', 3, 3, [11, 22, '#N/A', 43, 54, '#N/A', '#N/A', '#N/A', '#N/A']],
    ['{1;2}<{0,3}', 2, 2, [false, true, false, true]],
    ['{"A";"B"}&{1,2}', 2, 2, ['A1', 'A2', 'B1', 'B2']],
    ['LEFT({"lima";"oslo"},{1,2,3})', 2, 3, ['l', 'li', 'lim', 'o', 'os', 'osl']],
    ['IF({TRUE;FALSE},{1,2},{#DIV/0!,4})', 2, 2, [1, 2, '#DIV/0!', 4]],
    ['IFNA({2;4;6;8}*{2;2},0)', 4, 1, [4, 8, 0, 0]],
    ['TAKE({1,2,3;4,5,6}*{10,100},-1,-2)', 1, 2, [500, '#N/A']],
    ['TOCOL({1,2;3,#N/A},,TRUE)', 4, 1, [1, 3, 2, '#N/A']],
    ['TOROW({1,2;3,#N/A},2,TRUE)', 1, 3, [1, 3, 2]],
    ['TOROW(IF({1,0,0;0,1,0},#N/A,42),2,TRUE)', 1, 4, [42, 42, 42, 42]],
    ['WRAPROWS({1;2;3;4;5},2)', 3, 2, [1, 2, 3, 4, 5, '#N/A']],
    ['WRAPCOLS({1,2,3,4,5},2,"tail")', 2, 3, [1, 3, 5, 2, 4, 'tail']],
    ['WRAPROWS({1;2},99999,1/0)', 1, 2, [1, 2]],
    ['WRAPCOLS({1,2,3},2,1/0)', 2, 2, [1, 3, 2, '#DIV/0!']],
    ['EXPAND({1;2},3,2)', 3, 2, [1, '#N/A', 2, '#N/A', '#N/A', '#N/A']],
    ['EXPAND({1,2},,3,TRUE)', 1, 3, [1, 2, true]],
    ['EXPAND({1,2},2,,"")', 2, 2, [1, 2, '', '']],
    ['BYROW({1,2;3,4},LAMBDA(group,SUM(group)))', 2, 1, [3, 7]],
    ['BYCOL({1,2;3,4},_xleta.MAX)', 1, 2, [3, 4]],
    ['BYROW({1,2;3,4},LAMBDA(group,group*2))', 2, 1, ['#CALC!', '#CALC!']],
    ['LET(SUM,LAMBDA(group,99),BYROW({1,2;3,4},LAMBDA(group,SUM(group))))', 2, 1, [99, 99]],
    ['BYROW({1,2;#N/A,4},LAMBDA(group,SUM(group)))', 2, 1, [3, '#N/A']],
    ['MAP({1,2,3},{10,20},LAMBDA(a,b,a+b))', 1, 3, [11, 22, '#N/A']],
    ['MAP({1,2,3;4,5,6},{10,20;30,40;50,60},LAMBDA(a,b,a+b))', 3, 3, [11, 22, '#N/A', 34, 45, '#N/A', '#N/A', '#N/A', '#N/A']],
    ['MAP({1;#DIV/0!;3},LAMBDA(item,IFERROR(item*2,"missing")))', 3, 1, [2, 'missing', 6]],
    ['MAP({1,2},LAMBDA(item,{1,2}*item))', 1, 2, ['#CALC!', '#CALC!']],
    ['SCAN(,{2,3;4,5},LAMBDA(acc,item,acc*10+item+1))', 2, 2, [3, 34, 345, 3456]],
    ['SCAN("",{"a","b";"c","d"},LAMBDA(acc,item,acc&item))', 2, 2, ['a', 'ab', 'abc', 'abcd']],
    ['SCAN(0,{1,#N/A,3},LAMBDA(acc,item,IFERROR(acc,0)+item))', 1, 3, [1, '#N/A', 3]],
    ['SCAN(2,{3;4;5},_xleta.PRODUCT)', 3, 1, [6, 24, 120]],
    ['SCAN(0,{1,2},LAMBDA(acc,item,{1,2}*item))', 1, 2, ['#CALC!', '#CALC!']],
    ['LET(SUM,LAMBDA(acc,item,acc*item),SCAN(2,{3,4},SUM))', 1, 2, [6, 24]],
    ['REDUCE({10;20},{1,2,3},LAMBDA(acc,item,acc+item))', 2, 1, [16, 26]],
    ['REDUCE({0;#N/A},{1,2},LAMBDA(acc,item,IFERROR(acc,10)+item))', 2, 1, [3, 13]],
    ['GROUPBY({"Alpha","Blue";"Beta","Blue";"alpha","Green";"Beta","Blue"},{1;2;3;4},SUM,0,-2,{-1,2})', 6, 3,
      ['Grand Total', '', 10, 'Beta', '', 6, 'Beta', 'Blue', 6, 'Alpha', '', 4, 'Alpha', 'Blue', 1, 'Alpha', 'Green', 3]],
    ['GROUPBY({"a",2;"z",1;"a",1},{5;2;7},SUM,0,0,{2,-1},,1)', 3, 3, ['z', 1, 2, 'a', 1, 7, 'a', 2, 5]],
    ['GROUPBY({"x";"X";"y"},{12;4;#N/A},HSTACK(SUM,COUNT),0,0)', 3, 3, ['', 'SUM', 'COUNT', 'x', 16, 2, 'y', '#N/A', 0]],
    ['GROUPBY({"x";"y";"x"},{8,80;4,40;12,120},HSTACK(MIN,MAX),0,0)', 3, 3,
      ['', 'MIN', 'MAX', 'x', 8, 120, 'y', 4, 40]],
    ['GROUPBY({"x";"y";"x"},{8;4;12},VSTACK(HSTACK(SUM,COUNT),{"Value";"Records"}),0,0)', 3, 3,
      ['', 'Value', 'Records', 'x', 20, 2, 'y', 4, 1]],
    ['GROUPBY({"x";"y";"x"},{12;4;8},VSTACK(SUM,COUNT),0,0)', 4, 3,
      ['x', 'SUM', 20, 'x', 'COUNT', 2, 'y', 'SUM', 4, 'y', 'COUNT', 1]],
    ['GROUPBY({1;2},{3;9},LAMBDA(group,all,SUM(group)/SUM(all)),2,0)', 3, 2, ['Row Field 1', 'Value 1', 1, 0.25, 2, 0.75]],
    ['GROUPBY(SEQUENCE(1048576,1,7,0),SEQUENCE(1048576,1,2,0),COUNT,0,0)', 1, 2, [7, 1_048_576]],
    ['PIVOTBY({"North";"South";"South"},{"Red";"Blue";"Red"},{5;3;12},SUM,0)', 4, 4,
      ['', 'Blue', 'Red', 'Total', 'North', '', 5, 5, 'South', 3, 12, 15, 'Total', 3, 17, 20]],
    ['PIVOTBY({"North";"South";"South"},{"Red";"Blue";"Red"},{5;3;12},PERCENTOF,0,0,,0,,,2)', 3, 3,
      ['', 'Blue', 'Red', 'North', '', 0.25, 'South', 0.15, 0.6]],
    ['PIVOTBY(,{2024;2025;2024},{3;7;5},SUM,0)', 2, 3, [2024, 2025, 'Total', 8, 7, 15]],
    ['PIVOTBY({"West";"West";"East"},{"Q1";"Q2";"Q1"},{4;9;2},VSTACK(SUM,COUNT),0,0,,0)', 5, 4,
      ['', '', 'Q1', 'Q2', 'East', 'SUM', 2, '', 'East', 'COUNT', 1, '', 'West', 'SUM', 4, 9, 'West', 'COUNT', 1, 1]],
    ['PIVOTBY({"A";"A";"B"},{"North","Q1";"North","Q2";"North","Q1"},{2;6;8},PERCENTOF,0,0,,0,,,3)', 4, 3,
      ['', 'North', 'North', '', 'Q1', 'Q2', 'A', 0.25, 0.75, 'B', 1, '']],
    ['PIVOTBY({"A";"A";"B"},{"North","Q1";"North","Q2";"North","Q1"},{2;6;8},SUM,0,0,,-2)', 4, 5,
      ['', 'Grand Total', 'North', 'North', 'North', '', '', '', 'Q1', 'Q2', 'A', 8, 8, 2, 6, 'B', 8, 8, 8, '']],
    ['GROUPBY(INT({"2024-01-01 00:15";"2024-01-01 23:45";"2024-01-02 00:00"}+0),{2;4;7},SUM,0,0)', 2, 2,
      [45292, 6, 45293, 7]],
    ['TEXT({1;2.5},"0.00")', 2, 1, ['1.00', '2.50']],
    ['TRIMRANGE({"",0;FALSE,#N/A},3,3)', 2, 2, ['', 0, false, '#N/A']],
    ['LEN({"x";"drop"})', 2, 1, [1, 4]],
    ['UNICODE({"😀";""})', 2, 1, [128512, '#VALUE!']]
  ] as const)('expands worksheet arrays in %s', (formula, rows, columns, expected) => {
    const result = new FormulaReader(formula, () => null, () => {}).readResult(true);
    if (!result || typeof result !== 'object') throw new Error('Expected an array.');
    expect([result.rows, result.columns]).toEqual([rows, columns]);
    const read = (position?: number) => {
      const value = captureError(() => result.read(position));
      return value instanceof FormulaError ? value.message : value;
    };
    expect(Array.from({ length: rows * columns }, (_, index) => read(index))).toEqual(expected);
    const occupied = [...mergeOccupiedPositions(result.occupied)];
    expect(occupied).toEqual([...new Set(occupied)].sort((a, b) => a - b));
    if (!result.dense) {
      const positions = new Set(occupied);
      expect(Array.from({ length: rows * columns }, (_, index) => read(positions.has(index) ? index : undefined))).toEqual(expected);
    }
  });

  it('enforces output dimensions and bounds scans of dense inputs with an ignore mode', () => {
    const read = (formula: string) => new FormulaReader(formula, () => null, () => {}).readResult(true);
    expect(() => read('TOROW(SEQUENCE(2,16384))')).toThrow('#NUM!');
    expect(() => read('TOCOL(SEQUENCE(1048576,2))')).toThrow('#NUM!');
    expect(() => read('TOCOL(SEQUENCE(262145),1)')).toThrow(FormulaCalculationLimit);
    expect(() => read('TOCOL({#N/A},2)')).toThrow('#CALC!');
    expect(() => read('TOROW({1},4)')).toThrow('#VALUE!');
    expect(() => read('SUM(MAP(SEQUENCE(262145),LAMBDA(item,item+1)))')).toThrow(FormulaCalculationLimit);
    expect(read('INDEX(TOCOL(SEQUENCE(524288,2)),1048576)')).toBe(1_048_576);
  });

  it.each([
    ['BYROW({1,2},LAMBDA(a,b,a+b))', '#VALUE!'],
    ['MAP({1,2},{3,4},LAMBDA(item,item))', '#VALUE!'],
    ['SCAN(0,{1},LAMBDA(item,item))', '#VALUE!'],
    ['REDUCE(0,,LAMBDA(acc,item,acc+item))', '#VALUE!'],
    ['REDUCE(0,{1},)', '#VALUE!'],
    ['GROUPBY({1;2},{3},SUM)', '#VALUE!'],
    ['GROUPBY({1;2},{3;4},SUM,0,0,,{TRUE,FALSE})', '#VALUE!'],
    ['GROUPBY({1;2},{3;4},SUM,0,0,,{FALSE;FALSE})', '#CALC!'],
    ['PIVOTBY({1;2},{3},{4;5},SUM)', '#VALUE!'],
    ['PIVOTBY({1},{3},{4},SUM,,,,,,,5)', '#VALUE!'],
    ['TRIMRANGE({1},4)', '#VALUE!'],
    ['LAMBDA(item,item*2)', '#CALC!'],
    ['LAMBDA(item,item*2)(1,2)', '#VALUE!'],
    ['LAMBDA(item,[extra],item+extra)()', '#VALUE!'],
    ['LAMBDA([extra],item,item+extra)(1,2)', '#VALUE!'],
    ['WRAPCOLS({1,2;3,4},2)', '#VALUE!'],
    ['WRAPROWS({1;2},0)', '#NUM!'],
    ['WRAPROWS(SEQUENCE(1048576),16385)', '#SPILL!'],
    ['EXPAND({1,2},1,1)', '#VALUE!'],
    ['EXPAND(1,1048577)', '#NUM!'],
    ['EXPAND(1,,)', '#VALUE!']
  ])('returns the worksheet error for %s', (formula, error) => {
    expect(() => new FormulaReader(formula, () => null, () => {}).readResult(true)).toThrow(error);
  });

  it('invokes inline and captured lambdas', () => {
    const read = (formula: string) => new FormulaReader(formula, () => null, () => {}).read();
    expect(read('_xlfn.LAMBDA(_xlpm.x,_xlpm.x+1)(2)')).toBe(3);
    expect(read('LET(bonus,3,increase,LAMBDA(amount,amount+bonus),LET(bonus,99,increase(2)))')).toBe(5);
    expect(read('LAMBDA(amount,LAMBDA(tax,amount*tax))(4)(3)')).toBe(12);
  });

  it('reduces in row order and uses the first input when the seed is omitted', () => {
    const read = (formula: string) => new FormulaReader(formula, () => null, () => {}).read();
    expect(read('REDUCE(,{2,3;4,5},LAMBDA(acc,item,acc*10+item+1))')).toBe(2456);
    expect(read('REDUCE(,{8},LAMBDA(acc,item,NA()))')).toBe(8);
    expect(read('REDUCE(,{#N/A,7},LAMBDA(acc,item,IFERROR(acc,4)+item))')).toBe(11);
    expect(() => read('REDUCE(SEQUENCE(1048576),1,LAMBDA(acc,item,acc+item))')).toThrow(FormulaCalculationLimit);
  });

  it('cross-tabulates sparse columns and preserves blank intersections and the last spill cell', async () => {
    const { sheets: [summary, , large] } = await loadXlsxWorkbook(await createPivotByWorkbook());
    const reads = vi.spyOn(WorksheetCellIndex.prototype, 'get');
    const cell = (row: number, column: number) => displaySpillCell(summary, row, column);
    expect(Array.from({ length: 4 }, (_, row) => [1, 2, 3, 4].map(column => cell(row + 1, column)?.value))).toEqual([
      ['', 'Blue', 'Red', 'Total'], ['North', '3', '7', '10'], ['South', '45', '', '45'], ['Total', '48', '7', '55']
    ]);
    expect(cell(3, 3)?.valueType).toBe('text');
    expect(cell(1010, 1001)?.value).toBe('7');
    expect(cell(1010, 1000)?.value).toBe('');
    expect(displaySpillCell(large, 1_048_576, 16_384)?.value).toBe('45');
    expect(resolveCellValue(summary, summary.rows.find(row => row.index === 6)!.cells[0])).toBe('90');
    expect(reads.mock.calls.length).toBeLessThan(180);
  });

  it('groups full sparse columns and spills into the final Excel cell', async () => {
    const { sheets: [summary, , large] } = await loadXlsxWorkbook(await createGroupByWorkbook());
    const reads = vi.spyOn(WorksheetCellIndex.prototype, 'get');
    const cell = (row: number, column: number) => displaySpillCell(summary, row, column)?.value;
    expect(Array.from({ length: 6 }, (_, row) => [1, 2, 3].map(column => cell(row + 1, column)))).toEqual([
      ['South', 'Blue', '45'], ['South', '', '45'], ['North', 'Blue', '3'],
      ['North', 'Red', '7'], ['North', '', '10'], ['Grand Total', '', '55']
    ]);
    expect(displaySpillCell(large, 1_048_576, 16_384)?.value).toBe('45');
    expect(resolveCellValue(summary, summary.rows.at(-1)!.cells[0])).toBe('90');
    expect(reads.mock.calls.length).toBeLessThan(180);
  });

  it('recalculates cross-sheet accumulators with bounded work through the final Excel cell', async () => {
    const { sheets: [summary, , large] } = await loadXlsxWorkbook(await createAccumulationWorkbook());
    const reads = vi.spyOn(WorksheetCellIndex.prototype, 'get');
    const cell = (row: number, column: number) => displaySpillCell(summary, row, column)?.value;
    expect([cell(2, 2), cell(1, 1), cell(2, 1)]).toEqual(['10', '2', '5']);
    expect([cell(5, 1), cell(4, 1)]).toEqual(['30', '20']);
    const values = (rowIndex: number) => summary.rows.find(row => row.index === rowIndex)?.cells.slice(-2)
      .map(value => resolveCellValue(summary, value));
    expect(values(4)?.at(-1)).toBe('110');
    expect(values(6)).toEqual(['6', '22']);
    expect(displaySpillCell(large, 1_048_576, 16_384)?.value).toBe('10');
    expect(reads.mock.calls.length).toBeLessThan(150);
  });

  it('trims only the edges of worksheet references and keeps the result usable by other formulas', async () => {
    const { sheets: [summary, , large] } = await loadXlsxWorkbook(await createTrimRangeWorkbook());
    const reads = vi.spyOn(WorksheetCellIndex.prototype, 'get');
    expect(summary.rows.map(row => row.cells.map(cell => resolveCellValue(summary, cell)))).toEqual([
      ['6', '5', '7', '9', '6'], ['4', 'TRUE', 'FALSE', '#N/A', ''], ['2', '15', '22', '6', '16384']
    ]);
    expect(summary.rows[1].cells.slice(2).map(cell => cell.valueType)).toEqual(['boolean', 'error', 'text']);
    expect(displaySpillCell(large, 1_048_575, 16_384)?.value).toBe('0');
    expect(displaySpillCell(large, 1_048_576, 16_384)?.value).toBe('15');
    expect(reads.mock.calls.length).toBeLessThan(150);
    const reader = (formula: string) => new FormulaReader(formula, () => null, () => {}).read();
    expect(reader('HLOOKUP(3,TAKE({1,3;5,7},2),2,FALSE)')).toBe(7);
    expect(reader('ROWS(TRIMRANGE(SEQUENCE(1048576)))')).toBe(1_048_576);
  });

  it('finds the two populated edges of a full column without visiting records between them', () => {
    let visits = 0;
    const reader = new FormulaReader('ROWS(TRIMRANGE(A:A))', () => null, (_area, visit, _matches, reverse) => {
      const end = reverse ? 2 : 50_001, step = reverse ? -1 : 1;
      for (let row = reverse ? 50_000 : 3; row !== end; row += step) {
        visits++;
        if (visit(1, row, 1) === false) return;
      }
    });
    expect(reader.read()).toBe(49_998);
    expect(visits).toBe(2);
  });

  it('distinguishes omitted arguments from blanks, numbers and worksheet errors', () => {
    const read = (formula: string) => new FormulaReader(formula, () => null, () => {}).read();
    expect(read('LAMBDA(x,y,IF(ISOMITTED(y),"Missing second argument",x+y))(1,)')).toBe('Missing second argument');
    expect(read('LAMBDA([item],IF(ISOMITTED(item),10,item))()')).toBe(10);
    expect(read('LAMBDA([item],ISOMITTED(item))(NA())')).toBe(false);
    expect(read('LET(inner,LAMBDA([item],ISOMITTED(item)),outer,LAMBDA([item],inner(item)),outer())')).toBe(true);
    expect(read('LAMBDA([item],ISOMITTED(item))(0)')).toBe(false);
  });

  it('uses worksheet group references, named recursion and sparse aggregate lanes', async () => {
    const { sheets: [summary, , large] } = await loadXlsxWorkbook(await createLambdaWorkbook());
    expect([1, 2, 3].map(row => displaySpillCell(summary, row, 1)?.value)).toEqual(['2', '1', '1']);
    expect([1, 2, 3].map(column => displaySpillCell(summary, 5, column)?.value)).toEqual(['12', '17', '24']);
    expect(summary.rows.find(row => row.index === 7)?.cells.map(cell => resolveCellValue(summary, cell))).toEqual(['8', '120', '#NUM!', '#NUM!']);
    const reads = vi.spyOn(WorksheetCellIndex.prototype, 'get');
    expect(summary.rows.find(row => row.index === 9)?.cells.map(cell => resolveCellValue(summary, cell))).toEqual(['137', '131', '130', '11']);
    expect([11, 12, 13].map(row => displaySpillCell(summary, row, 1)?.value)).toEqual(['9', '8', '8']);
    expect([1, 2, 3].map(column => displaySpillCell(summary, 15, column)?.value)).toEqual(['36', '30', '40']);
    expect(displaySpillCell(large, 1_048_576, 16_384)?.value).toBe('130');
    expect(reads.mock.calls.length).toBeLessThan(100);
  });

  it('maps worksheet references and sparse calculated values without expanding the worksheet', async () => {
    const { sheets: [summary, , large] } = await loadXlsxWorkbook(await createMapWorkbook());
    const reads = vi.spyOn(WorksheetCellIndex.prototype, 'get');
    expect([1, 2, 3].map(row => displaySpillCell(summary, row, 1)?.value)).toEqual(['1', '1', '2']);
    expect([1, 2, 3].map(row => displaySpillCell(summary, row, 2)?.value)).toEqual(['3', '0', '3']);
    expect(displaySpillCell(summary, 1, 3)?.value).toBe('6');
    expect(summary.rows.slice(-2).map(row => row.cells.map(cell => resolveCellValue(summary, cell))))
      .toEqual([[String(1_048_576 * 16_384 * 4 + 284), '1064960'], ['1048588', '2']]);
    expect(displaySpillCell(large, 1_048_575, 16_384)?.value).toBe('4');
    expect(displaySpillCell(large, 1_048_576, 16_384)?.value).toBe('264');
    expect(reads.mock.calls.length).toBeLessThan(120);
  });

  it('keeps typed padding and aggregates sparse wrapped and expanded spills through the final cell', async () => {
    const { sheets: [summary, , wrapped, expanded] } = await loadXlsxWorkbook(await createWrapExpandWorkbook());
    const indexed = vi.spyOn(WorksheetCellIndex.prototype, 'get');
    expect(displaySpillCell(summary, 2, 3)).toMatchObject({ value: '', valueType: 'text' });
    expect(displaySpillCell(summary, 4, 2)).toMatchObject({ value: '#REF!', valueType: 'error' });
    expect(displaySpillCell(summary, 6, 2)).toMatchObject({ value: '#N/A', valueType: 'error' });
    expect(displaySpillCell(summary, 8, 2)?.value).toBe('0');
    expect(displaySpillCell(summary, 10, 3)).toMatchObject({ value: 'FALSE', valueType: 'boolean' });
    expect(summary.rows.slice(-2).map(row => row.cells.map(cell => resolveCellValue(summary, cell))))
      .toEqual([['50', String((1_048_576 * 16_384 - 4) * 9 + 14)], [String(1_048_576 * 16_384), '36']]);
    expect(displaySpillCell(wrapped, 1_048_574, 16_384)?.value).toBe('22');
    expect(displaySpillCell(wrapped, 1_048_576, 16_383)?.value).toBe('3');
    expect(displaySpillCell(wrapped, 1_048_576, 16_384)?.value).toBe('7');
    expect(displaySpillCell(expanded, 1_048_576, 16_384)?.value).toBe('9');
    expect(indexed.mock.calls.length).toBeLessThan(130);
    const defaultPadding = 'SUM(IFNA(EXPAND(2,1048576,16384),3))';
    expect(new FormulaReader(defaultPadding, () => null, () => {}).read()).toBe(3 * 1_048_576 * 16_384 - 1);
  });

  it('keeps typed flattening results and reads a full sparse worksheet without expanding blanks', async () => {
    const { sheets: [summary, , large] } = await loadXlsxWorkbook(await createFlattenSpillWorkbook());
    const sourceReads = vi.spyOn(WorksheetCellIndex.prototype, 'get');
    const read = (row: number, column: number) => displaySpillCell(summary, row, column);
    expect(Array.from({ length: 6 }, (_, i) => read(1, i + 1)?.value)).toEqual(['5', '#DIV/0!', '0', '0', '', 'TRUE']);
    expect(Array.from({ length: 5 }, (_, i) => read(3, i + 1)?.value)).toEqual(['5', '', '#DIV/0!', '0', 'TRUE']);
    expect(Array.from({ length: 5 }, (_, i) => read(5 + i, 1)?.value)).toEqual(['5', '0', '', '0', 'TRUE']);
    expect(Array.from({ length: 6 }, (_, i) => read(5, i + 3)?.value)).toEqual(['5', '', '0', 'TRUE', '33', '-7']);
    expect(read(5, 4)?.valueType).toBe('text');
    expect(read(5, 6)?.valueType).toBe('boolean');
    expect(summary.rows.at(-1)?.cells.map(cell => resolveCellValue(summary, cell))).toEqual(['4', '6']);
    expect(large.rows[0].cells.map(cell => resolveCellValue(large, cell))).toEqual(['38', '1048573']);
    expect(displaySpillCell(large, 1_048_576, 16_384)?.value).toBe('33');
    expect(sourceReads.mock.calls.length).toBeLessThan(300);
  });

  it('aggregates uniform row and column operands over a full worksheet without scanning the grid', () => {
    const formula = 'SUM(SEQUENCE(1048576,,5,0)+SEQUENCE(1,16384,2,0))';
    const visit = vi.fn();
    const result = new FormulaReader(formula, () => null, visit).read();
    expect(result).toBe(7 * 1_048_576 * 16_384);
    expect(visit).not.toHaveBeenCalled();
  });

  it('keeps a large repeated row readable by coordinate and bounds full enumeration', () => {
    const result = new FormulaReader('SEQUENCE(1048576,,5,0)+{10,20,30}', () => null, () => {}).readResult(true);
    if (!result || typeof result !== 'object') throw new Error('Expected an array.');
    expect(result.read(3 * 1_048_576 - 1)).toBe(35);
    let visited = 0;
    expect(() => { for (const position of mergeOccupiedPositions(result.occupied)) visited = position + 1; }).toThrow(FormulaCalculationLimit);
    expect(visited).toBe(MAX_DENSE_ARRAY_SCAN);
  });

  it('reads uncached broadcast results and slices a sparse spill at the final coordinate', async () => {
    const { sheets: [summary, , large] } = await loadXlsxWorkbook(await createBroadcastWorkbook());
    expect(displaySpillCell(summary, 3, 2)?.value).toBe('30');
    expect(displaySpillCell(summary, 6, 3)).toMatchObject({ value: '#N/A', valueType: 'error' });
    expect(displaySpillCell(summary, 9, 3)).toMatchObject({ value: 'osl', valueType: 'text' });
    const read = vi.spyOn(WorksheetCellIndex.prototype, 'get');
    expect(large.rows.map(row => resolveCellValue(large, row.cells[0]))).toEqual(['1080', '1064', '1080', String(7 * 1_048_576 * 16_384)]);
    expect(displaySpillCell(large, 1048576, 16383)?.value).toBe('16');
    expect(displaySpillCell(large, 1048576, 16384)?.value).toBe('1064');
    expect(read.mock.calls.length).toBeLessThan(40);
  });

  it('keeps IFS and SWITCH spill results typed and handles a whole-grid sparse expression', async () => {
    const { sheets: [summary, , large] } = await loadXlsxWorkbook(await createOrderedConditionalWorkbook());
    const result = (row: number, column: number) => displaySpillCell(summary, row, column);
    expect(result(2, 1)).toMatchObject({ value: 'FALSE', valueType: 'boolean' });
    expect(result(2, 2)).toMatchObject({ value: 'TRUE', valueType: 'boolean' });
    expect(result(3, 2)).toMatchObject({ value: '#N/A', valueType: 'error' });
    expect(result(4, 1)).toMatchObject({ value: '#N/A', valueType: 'error' });
    expect(result(4, 2)).toMatchObject({ value: 'missing', valueType: 'text' });
    expect(resolveCellValue(summary, summary.rows[0].cells[2])).toBe('42');
    const reads = vi.spyOn(WorksheetCellIndex.prototype, 'get');
    expect(resolveCellValue(large, large.rows[0].cells[0])).toBe(String((1_048_576 * 16_383 - 2) * 3 + 77 + 99));
    expect(displaySpillCell(large, 1048576, 16383)?.value).toBe('3');
    expect(displaySpillCell(large, 1048576, 16384)?.value).toBe('99');
    expect(reads.mock.calls.length).toBeLessThan(40);
  });

  it('keeps OFFSET references sparse and clips legacy outputs to the saved area', async () => {
    const { sheets: [summary, , large] } = await loadXlsxWorkbook(await createOffsetWorkbook());
    const read = vi.spyOn(WorksheetCellIndex.prototype, 'get');
    expect(summary.rows[0].cells.map(cell => resolveCellValue(summary, cell))).toEqual(['255', '135']);
    expect(summary.rows[1].cells.map(cell => resolveCellValue(summary, cell))).toEqual(['10', '10']);
    expect(displaySpillCell(summary, 2, 4)?.value).toBe('20');
    expect(resolveCellValue(large, large.rows[0].cells[0])).toBe('135');
    expect(displaySpillCell(large, 1048575, 16384)).toMatchObject({ value: 'Station', valueType: 'text' });
    expect(displaySpillCell(large, 1048576, 16383)?.value).toBe('0');
    expect(displaySpillCell(large, 1048576, 16384)?.value).toBe('131');
    expect(read.mock.calls.length).toBeLessThan(40);
  });

  it('transposes typed cells and finds exact and wildcard matches for array criteria', async () => {
    const { sheets: [summary, , large] } = await loadXlsxWorkbook(await createXmatchWorkbook());
    const result = (row: number, column: number) => displaySpillCell(summary, row, column);
    expect([1, 2, 3].map(column => result(1, column)?.value)).toEqual(['east', 'East', '33']);
    expect([1, 2, 3].map(column => result(2, column)?.value)).toEqual(['Alpha', '0', 'TRUE']);
    expect(result(2, 3)?.valueType).toBe('boolean');
    expect(resolveCellValue(summary, summary.rows[0].cells[1])).toBe('2');
    expect([1, 2, 3].map(column => result(4, column)?.value)).toEqual(['2', '#N/A', '3']);
    expect(result(4, 2)?.valueType).toBe('error');
    expect([1, 2, 3].map(column => result(5, column)?.value)).toEqual(['1048576', '5', '2']);
    expect([1, 2].map(column => result(7, column)?.value)).toEqual(['1', '5']);
    const read = vi.spyOn(WorksheetCellIndex.prototype, 'get');
    withFormulaTime(large, () => {
      expect(resolveCellValue(large, large.rows[0].cells[0])).toBe(String((1_048_576 * 16_383 - 3) * 4 + 1_048_576));
      expect(displaySpillCell(large, 1_048_576, 16_384)?.value).toBe('1048576');
    });
    expect(read.mock.calls.length).toBeLessThan(30);
  });

  it.each([['XMATCH', 1], ['XMATCH', -1], ['XLOOKUP', 1], ['XLOOKUP', -1]] as const)(
    'scans each source key at most once for exact %s mode %i', (name, mode) => {
      const visited = vi.fn();
      const size = 2048;
      const returns = name === 'XLOOKUP' ? `SEQUENCE(${size}),,` : '';
      const result = new FormulaReader(`${name}(SEQUENCE(${size}),A1:A${size},${returns}0,${mode})`, () => null,
        ({ firstRow, lastRow }, visit, _matches, reverse) => {
          for (let row = reverse ? lastRow : firstRow; row >= firstRow && row <= lastRow; row += reverse ? -1 : 1) {
            visited(row);
            if (visit(row, row, 1) === false) break;
          }
        }).readResult(true);
      if (!result || typeof result !== 'object') throw new Error('Expected an array.');
      expect(result.read(mode === 1 ? 0 : size - 1)).toBe(mode === 1 ? 1 : size);
      expect(visited).toHaveBeenCalledTimes(1);
      for (let index = 0; index < size; index++) expect(result.read(index)).toBe(index + 1);
      expect(visited).toHaveBeenCalledTimes(size);
    });

  it.each([false, true])('resolves missing output cells and preserves saved cells (streamed=%s)', async streamed => {
    const bytes = await createArraySpillWorkbook();
    const entries = new Map(await openZipArchive(bytes));
    const entry = entries.get('xl/worksheets/summary.xml')!;
    const metadata = entries.get('xl/metadata/arrays.xml')!;
    const readMetadata = vi.fn(metadata.bytes.bind(metadata));
    entries.set(metadata.name, { ...metadata, bytes: readMetadata });
    const buffered = vi.fn(entry.bytes.bind(entry));
    const chunks = async function* () {
      const data = await entry.bytes();
      for (let i = 0; i < data.length; i += 53) yield data.subarray(i, i + 53);
    };
    entries.set(entry.name, { ...entry, bytes: buffered, chunks: streamed ? chunks : undefined });
    const workbook = await loadXlsxWorkbook(bytes, { descriptor: { source: bytes }, zipEntries: entries });
    expect(buffered).toHaveBeenCalledTimes(streamed ? 0 : 1);
    expect(readMetadata).toHaveBeenCalledTimes(1);
    const [sheet] = clonePreviewWorkbook(workbook).sheets;
    expect(sheet.arrayFormulas).toEqual(workbook.sheets[0].arrayFormulas);
    expect(sheet.arrayFormulas?.[0]).not.toBe(workbook.sheets[0].arrayFormulas?.[0]);
    expect(sheet.arrayFormulas).toHaveLength(10);
    expect(sheet.arrayFormulas?.filter(range => range.dynamic)).toHaveLength(4);
    expect(sheet.rows[0].cells.slice(0, 10).map(cell => resolveCellValue(sheet, cell)))
      .toEqual(['3', 'saved', '0', '9', '42', '1', '2', '88', '1', 'FALSE']);
    expect(sheet.rows[1].cells.slice(1).map(cell => resolveCellValue(sheet, cell))).toEqual(['42', 'North', '14']);

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const table = createSheetTable(sheet, 5);
    const cell = (row: number, index: number) => table.querySelector<HTMLTableCellElement>(
      `tr[aria-rowindex="${row + 1}"] td[aria-colindex="${index + 1}"]`)!;
    expect([cell(2, 1), cell(2, 2), cell(2, 3), cell(3, 1), cell(3, 2), cell(3, 3)].map(td => td.textContent))
      .toEqual(['8', 'North', '-', '31', 'FALSE', '#N/A']);
    expect(cell(2, 1).style.backgroundColor).toBe('rgb(46, 46, 46)');
    expect([cell(4, 1), cell(4, 2), cell(4, 5), cell(5, 2)].map(td => td.textContent)).toEqual(['999', '4.00', '#N/A', '']);
    expect([cell(2, 11), cell(2, 13), cell(3, 15), cell(3, 16)].map(td => td.textContent)).toEqual(['', '', '', '']);
    expect(sheet.rows[1].cells[0]).toMatchObject({ ref: 'B2', value: 'FALSE', missingValue: true });
  });

  it('resolves spill references by anchor and preserves errors, cached values and scalar spills', async () => {
    const { sheets: [sheet] } = await loadXlsxWorkbook(await createArraySpillWorkbook());
    const position = { row: 1, column: 10 };
    const evaluate = (formula: string) => {
      const cell = { ref: 'J1', ...position, value: '', formula, needsCalculation: true };
      return resolveCellValue(sheet, cell);
    };
    expect(evaluate('SUM(A4#)')).toBe('1003');
    expect(evaluate('SUM(A4#*2)')).toBe('2006');
    expect(evaluate('SUM(F4#)')).toBe('7');
    expect(evaluate('INDEX(\'Large Spill\'!$B$1#,1048576,16383)')).toBe('14');
    expect(evaluate('ROWS(A1#)*COLUMNS(A1#)')).toBe('9');
    expect(evaluate('COLUMNS({1,2,3;4,5,6})')).toBe('3');
    expect(evaluate('IFERROR(SUM(A1#),73)')).toBe('73');
    expect(evaluate('TEXTJOIN("#",TRUE,F4#,"done")')).toBe('7#done');
    for (const reference of ['A2#', 'D4#', 'G4#', 'H4#', 'M1#', 'P1#', 'XFD1048576#', '_xlfn.ANCHORARRAY(A1:C3)']) {
      expect(evaluate(`SUM(${reference})`), reference).toBe('#REF!');
    }
  });

  it('projects the final coordinate and sums a 17-billion-position spill from sparse source cells', async () => {
    const { sheets: [, , sheet] } = await loadXlsxWorkbook(await createArraySpillWorkbook());
    expect([sheet.rowCount, sheet.columnCount, sheet.rows.length]).toEqual([1048576, 16384, 1]);
    expect(sheetTracks(sheet).rows.includes(1048576)).toBe(true);
    const get = vi.spyOn(WorksheetCellIndex.prototype, 'get');
    const plans = vi.spyOn(FormulaReader.prototype, 'readResult');
    vi.useFakeTimers({ toFake: ['Date'] });
    withFormulaTime(sheet, () => {
      expect(displaySpillCell(sheet, 1048575, 16384)).toBeUndefined();
      expect(displaySpillCell(sheet, 1048576, 16384)).toMatchObject({ ref: 'XFD1048576', value: '14' });
      expect(resolveCellValue(sheet, sheet.rows[0].cells[0])).toBe('35');
      expect(evaluateWorksheetFormula(sheet, 'XFD1048576', { row: 1, column: 1 })).toBe(14);
      expect(evaluateWorksheetFormula(sheet, 'ROWS(B1#)*COLUMNS(B1#)', { row: 1, column: 1 })).toBe(1048576 * 16383);
    });
    vi.setSystemTime(Date.now() + 1);
    expect(displaySpillCell(sheet, 1, 3)?.value).toBe('2');
    expect(displaySpillCell(sheet, 1048576, 16384)?.value).toBe('14');
    expect(plans.mock.calls.filter(([array]) => array)).toHaveLength(1);
    expect(get.mock.calls.length).toBeLessThan(40);
    expect(sheet.rows).toHaveLength(1);
  });

  it('refreshes deferred clock dependencies across calculations and detects cycles', () => {
    const anchor = { ref: 'A1', row: 1, column: 1, value: '', formula: 'LET(data,C1:C2,data+1)', needsCalculation: true };
    const consumer = { ref: 'B1', row: 1, column: 2, value: '', formula: 'A2+1', needsCalculation: true };
    const source = { ref: 'C2', row: 2, column: 3, value: '', formula: 'TODAY()', needsCalculation: true };
    const sheet: ParsedSheet = { id: 's', name: 'S', rowCount: 2, columnCount: 3,
      rows: [{ index: 1, cells: [anchor, consumer] }, { index: 2, cells: [source] }],
      arrayFormulas: [{ firstRow: 1, lastRow: 2, firstColumn: 1, lastColumn: 1 }] };
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2024, 0, 1));
    expect(displaySpillCell(sheet, 2, 1)?.value).toBe('45293');
    expect(resolveCellValue(sheet, consumer)).toBe('45294');
    vi.setSystemTime(new Date(2024, 0, 2));
    expect(resolveCellValue(sheet, consumer)).toBe('45295');
    expect(displaySpillCell(sheet, 2, 1)?.value).toBe('45294');

    const circular: ParsedSheet = { ...sheet, rows: [
      { index: 1, cells: [{ ...anchor, formula: 'A1:A2+1' }] },
    ] };
    expect(displaySpillCell(circular, 2, 1)).toBeUndefined();
    expect(evaluateWorksheetFormula(circular, 'A2', anchor)).toBeUndefined();
    expect(resolveCellValue(circular, circular.rows[0].cells[0])).toBe('=A1:A2+1');
  });

  it('bounds logically dense aggregate scans while keeping individual distant cells available', () => {
    const anchor: ParsedCell = { ref: 'A1', row: 1, column: 1, value: '', formula: 'SEQUENCE(1048576)', needsCalculation: true };
    const sheet: ParsedSheet = { id: 's', name: 'S', rowCount: 1048576, columnCount: 2,
      rows: [{ index: 1, cells: [anchor] }], arrayFormulas: [{ firstRow: 1, lastRow: 1048576, firstColumn: 1, lastColumn: 1 }] };
    expect(displaySpillCell(sheet, 1048576, 1)?.value).toBe('1048576');
    expect(evaluateWorksheetFormula(sheet, 'SUM(A1:A3)', anchor)).toBe(6);
    expect(evaluateWorksheetFormula(sheet, 'SUM(A:A)', anchor)).toBeUndefined();
  });

  it('projects lazily generated spill values and clips range consumers after a distant lookup', async () => {
    const { sheets: [small, , large] } = await loadXlsxWorkbook(await createSequenceWorkbook());
    expect(small.rows[0].cells.map(cell => resolveCellValue(small, cell))).toEqual(['1', '210']);
    expect(displaySpillCell(small, 4, 5)?.value).toBe('20');
    expect(small.rows[1].cells.map(cell => resolveCellValue(small, cell))).toEqual(['700', '727.5']);
    expect(displaySpillCell(small, 7, 3)?.value).toBe('4.5');
    expect(resolveCellValue(small, small.rows[2].cells[0])).toBe('3');
    expect(displaySpillCell(small, 11, 1)?.value).toBe('18');

    expect([large.rowCount, large.columnCount, large.rows.length]).toEqual([1048576, 16384, 6]);
    const get = vi.spyOn(WorksheetCellIndex.prototype, 'get');
    expect(large.rows.map(row => resolveCellValue(large, row.cells[0]))).toEqual([
      '17178820608', '34357641215', '1048576', '34357641215', '34357641215', 'TRUE|TRUE'
    ]);
    expect(displaySpillCell(large, 1048576, 16384)?.value).toBe('17178820608');
    expect(get.mock.calls.length).toBeLessThan(40);
  });

  it('clips cross-sheet ranges and nested arrays while retaining saved cells and sparse spill defaults', async () => {
    const { sheets: [summary, , large] } = await loadXlsxWorkbook(await createSliceSpillWorkbook());
    expect(resolveCellValue(summary, summary.rows[0].cells[1])).toBe('1|South|6|Saved');
    expect(displaySpillCell(summary, 5, 2)).toMatchObject({ value: 'South', valueType: 'text' });
    expect(displaySpillCell(summary, 6, 1)).toMatchObject({ value: '8' });
    expect(resolveCellValue(summary, summary.rows.at(-1)!.cells[0])).toBe('#CALC!');
    const get = vi.spyOn(WorksheetCellIndex.prototype, 'get');
    expect(large.rows.map(row => resolveCellValue(large, row.cells[0]))).toEqual([
      '35', String(1_048_576 * 16_383 - 5), '14', '21'
    ]);
    expect(displaySpillCell(large, 1_048_576, 16_384)).toMatchObject({ value: '14' });
    expect(get.mock.calls.length).toBeLessThan(65);
  });

  it('stacks typed data with padding, display zeros and sparse cross-sheet spills', async () => {
    const { sheets: [summary, , large] } = await loadXlsxWorkbook(await createStackSpillWorkbook());
    expect(resolveCellValue(summary, summary.rows[0].cells[1])).toBe('3|North|10|7|South|99|8|North|pad');
    expect(resolveCellValue(summary, summary.rows[2].cells[1])).toBe('77');
    expect(displaySpillCell(summary, 3, 3)).toMatchObject({ value: '#N/A', valueType: 'error' });
    expect(displaySpillCell(summary, 6, 2)).toMatchObject({ value: '#N/A', valueType: 'error' });
    expect(displaySpillCell(summary, 11, 1)).toMatchObject({ value: '0' });
    expect(displaySpillCell(summary, 14, 1)).toMatchObject({ value: '', valueType: 'text' });
    expect([16, 17, 18].map(row => displaySpillCell(summary, row, 1)?.value)).toEqual(['5', '4', '0']);
    const get = vi.spyOn(WorksheetCellIndex.prototype, 'get');
    expect(large.rows.map(row => resolveCellValue(large, row.cells[0]))).toEqual(['35', '6', '14', '17']);
    expect(displaySpillCell(large, 1_048_576, 16_383)).toMatchObject({ value: '0' });
    expect(displaySpillCell(large, 1_048_576, 16_384)).toMatchObject({ value: '14' });
    expect(get.mock.calls.length).toBeLessThan(65);
  });

  it('uses worksheet order for three-dimensional references and retains distinct sparse rows', async () => {
    const { sheets: [summary, , large] } = await loadXlsxWorkbook(await createDistinctRecordWorkbook());
    expect(summary.rows[0].cells.map(cell => resolveCellValue(summary, cell)))
      .toEqual(['jeans', '19', '15', '#REF!', 'jeans|JEANS|Hat', 'jeans|JEANS|Hat']);
    expect([1, 2, 3, 4].map(row => displaySpillCell(summary, row, 1)?.value)).toEqual(['jeans', 'Shirt', 'coat', 'Hat']);
    expect(displaySpillCell(summary, 8, 1)).toMatchObject({ value: 'Hat', valueType: 'text' });
    expect(displaySpillCell(summary, 8, 4)).toMatchObject({ value: 'HAt', valueType: 'text' });
    expect(displaySpillCell(summary, 8, 5)).toMatchObject({ value: '5', valueType: 'text' });
    const get = vi.spyOn(WorksheetCellIndex.prototype, 'get');
    expect(displaySpillCell(large, 6, 16_384)).toMatchObject({ value: '0' });
    expect(displaySpillCell(large, 7, 16_384)).toMatchObject({ value: '14' });
    expect(large.rows.slice(1).map(row => resolveCellValue(large, row.cells[0]))).toEqual(['17', '19']);
    expect(get.mock.calls.length).toBeLessThan(65);
  });

  it('counts array criteria with one range traversal and chooses entire sparse columns', async () => {
    const { sheets: [summary, , large] } = await loadXlsxWorkbook(await createChoiceCriteriaWorkbook());
    expect(displaySpillCell(summary, 1, 1)).toMatchObject({ value: '3' });
    expect(displaySpillCell(summary, 2, 1)).toMatchObject({ value: '7' });
    expect(displaySpillCell(summary, 5, 4)).toMatchObject({ value: 'North', valueType: 'text' });
    expect(displaySpillCell(summary, 5, 5)).toMatchObject({ value: '6' });
    const visit = vi.spyOn(WorksheetCellIndex.prototype, 'forEachInRange');
    expect(resolveCellValue(large, large.rows[0].cells[0])).toBe('11');
    expect(visit).toHaveBeenCalledExactlyOnceWith(1, 1_048_576, 1, 1, expect.any(Function), false);
    expect(large.rows.slice(1).map(row => resolveCellValue(large, row.cells[0]))).toEqual(['49', '1', '1048576', '1']);
    expect(displaySpillCell(large, 1_048_576, 16_383)).toMatchObject({ value: '0' });
    expect(displaySpillCell(large, 1_048_576, 16_384)).toMatchObject({ value: '14' });
  });

  it('projects typed XLOOKUP rows, columns and array keys through sparse spills', async () => {
    const { sheets: [summary, , large] } = await loadXlsxWorkbook(await createXlookupSpillWorkbook());
    expect(summary.rows.map(row => row.cells.map(cell => resolveCellValue(summary, cell)))).toEqual([
      ['Bea', 'Saved dept', 'Bea|Saved dept|FALSE|0'], ['West', '9'], ['88'], ['Ops'], ['no'], ['0'], ['unlisted'], ['Ana']
    ]);
    expect(displaySpillCell(summary, 1, 3)).toMatchObject({ value: 'FALSE', valueType: 'boolean' });
    expect(displaySpillCell(summary, 1, 4)).toMatchObject({ value: '0' });
    expect(displaySpillCell(summary, 5, 1)).toMatchObject({ value: '#N/A', valueType: 'error' });
    expect(displaySpillCell(summary, 7, 2)).toMatchObject({ value: 'record', valueType: 'text' });
    expect(displaySpillCell(summary, 9, 2)).toMatchObject({ value: 'FALSE', valueType: 'boolean' });
    expect(displaySpillCell(summary, 9, 3)).toMatchObject({ value: 'missing', valueType: 'text' });
    expect(displaySpillCell(summary, 10, 4)).toMatchObject({ value: '#DIV/0!', valueType: 'error' });
    expect(displaySpillCell(summary, 12, 2)?.value).toBe('131');
    expect(displaySpillCell(summary, 16, 1)?.value).toBe('Cy');

    const get = vi.spyOn(WorksheetCellIndex.prototype, 'get');
    expect(large.rows.map(row => resolveCellValue(large, row.cells[0]))).toEqual(['138', '131', '7', '138']);
    expect(displaySpillCell(large, 1048576, 16384)?.value).toBe('131');
    expect(get.mock.calls.length).toBeLessThan(60);
  });

  it('combines text, date and logical functions across sparse arrays', async () => {
    const { sheets: [summary, , large] } = await loadXlsxWorkbook(await createArrayPredicateWorkbook());
    const get = vi.spyOn(WorksheetCellIndex.prototype, 'get');
    expect([1, 2, 3, 4].map(column => displaySpillCell(summary, 1, column)?.value)).toEqual(['X3000-050', 'East', '43962', '4500']);
    expect(displaySpillCell(summary, 3, 1)).toMatchObject({ value: 'TRUE', valueType: 'boolean' });
    expect(displaySpillCell(summary, 3, 2)).toMatchObject({ value: 'FALSE', valueType: 'boolean' });
    expect(displaySpillCell(summary, 3, 3)).toMatchObject({ value: '#N/A', valueType: 'error' });
    expect(large.rows[0].cells.slice(0, 2).map(cell => resolveCellValue(large, cell))).toEqual([String(1_048_576 * 16_380 + 4), '1']);
    expect(displaySpillCell(large, 1048576, 16384)?.value).toBe('5');
    expect(get.mock.calls.length).toBeLessThan(60);
  });

  it.each([false, true])('calculates sparse workday offsets and counts in the worksheet epoch (1904=%s)', async date1904 => {
    const { sheets: [summary, , large] } = await loadXlsxWorkbook(await createWorkdayArrayWorkbook(date1904));
    const start = date1904 ? 43988 : 45450;
    const get = vi.spyOn(WorksheetCellIndex.prototype, 'get');
    for (const [row, offsets] of [[4, -2, 2], [0, 2, -2]].entries()) {
      expect(offsets.map((_, column) => displaySpillCell(summary, row + 1, column + 1)?.value))
        .toEqual(offsets.map(offset => String(start + offset)));
    }
    expect([1, 2, 3, 4].map(column => displaySpillCell(summary, 4, column)?.value)).toEqual(['2', '-1', '2', '0']);
    expect(resolveCellValue(large, large.rows[0].cells[0])).toBe('4');
    expect(displaySpillCell(large, 1048576, 16384)?.value).toBe('4');
    expect(get.mock.calls.length).toBeLessThan(60);
  });

  it('shares one holiday range scan across generated offsets', () => {
    const visit = vi.fn<ConstructorParameters<typeof FormulaReader>[2]>((_range, yieldCell) => {
      yieldCell(3, 1, 8);
      yieldCell(3, 2, 8);
    });
    const result = new FormulaReader('WORKDAY(2,SEQUENCE(4),H:H)', () => null, visit).readResult(true);
    if (!result || typeof result !== 'object') throw new Error('Expected an array.');
    expect(visit).not.toHaveBeenCalled();
    expect([0, 1, 2, 3].map(position => result.read(position))).toEqual([4, 5, 6, 9]);
    expect(visit).toHaveBeenCalledOnce();
  });

  it('projects coordinate arrays and reads the last row and column without reading referenced values', async () => {
    const { sheets: [summary, , large] } = await loadXlsxWorkbook(await createCoordinateFormulaWorkbook());
    expect(summary.rows.slice(0, 2).map(row => row.cells.map(cell => resolveCellValue(summary, cell))))
      .toEqual([['1', '2', '6', '1048574'], ['22', '2', '16384']]);
    expect([4, 5, 6].map(row => displaySpillCell(summary, row, 1)?.value)).toEqual(['1048574', '1048575', '1048576']);
    expect([4, 5].map(column => displaySpillCell(summary, 4, column)?.value)).toEqual(['16383', '16384']);
    expect(summary.rows[2].cells.map(cell => resolveCellValue(summary, cell))).toEqual(['Ledger!R1048576C16384', '131', '16384', '131']);
    expect([4, 5, 6].map(row => displaySpillCell(summary, row, 7)?.value)).toEqual(['XFD1048574', 'XFD1048575', 'XFD1048576']);
    expect(large.rows.slice(0, 2).map(row => resolveCellValue(large, row.cells[0]))).toEqual(['2097151', '32767']);
    expect(displaySpillCell(large, 1048576, 4)?.value).toBe('1048576');
    expect(displaySpillCell(large, 1048576, 16384)?.value).toBe('16384');
    const read = vi.fn(() => { throw new Error('Unexpected cell read.'); });
    expect(new FormulaReader('SUM(ROW(A100:A103))', read, read).read()).toBe(406);
    expect(read).not.toHaveBeenCalled();
  });

  it('sorts stable and typed array spills by row or column with sparse keys', async () => {
    const { sheets: [summary, , large] } = await loadXlsxWorkbook(await createSortSpillWorkbook());
    const read = (row: number, column: number) => displaySpillCell(summary, row, column)?.value;
    expect(resolveCellValue(summary, summary.rows[0].cells[1])).toBe('Cy|Di|Ana|Bea|Eva');
    for (const firstRow of [1, 11]) {
      expect(Array.from({ length: 5 }, (_, i) => [read(firstRow + i, 1), read(firstRow + i, 3)])).toEqual([
        ['north', 'Cy'], ['North', 'Di'], ['North', 'Ana'], ['south', 'Bea'], ['0', 'Eva']
      ]);
    }
    expect([read(9, 1), read(9, 2), read(9, 3)]).toEqual(['one', 'two', 'three']);
    expect([read(18, 1), read(18, 2), read(18, 3)]).toEqual(['three', 'two', 'one']);
    const scalar = (formula: string) => evaluateWorksheetFormula(summary, formula, { row: 1, column: 5 });
    expect(scalar('TEXTJOIN("|",TRUE,CHOOSECOLS(SORT({TRUE,1;#N/A,2;0,3;"Text",4;FALSE,5},1,-1),2))')).toBe('2|1|5|4|3');
    expect(scalar('IFERROR(INDEX(SORT({1,#N/A;2,0}),1,2),17)')).toBe(17);
    for (const invalid of ['SORT({2;1},0)', 'SORT({2;1},1,0)', 'SORT({2;1},1,{1,-1})',
      'SORTBY({2;1},{1,2})', 'SORTBY({2;1},{1;2},0)', 'SORTBY({2;1},{1;2},1,{1,2})']) {
      expect(scalar(`IFERROR(INDEX(${invalid},1,1),"invalid")`), invalid).toBe('invalid');
    }

    const get = vi.spyOn(WorksheetCellIndex.prototype, 'get');
    const size = 1_048_576 * 16_380;
    expect(large.rows.map(row => resolveCellValue(large, row.cells[0]))).toEqual([
      '149', '131', '4', '131', '149', String(size), String(size + 149), String(size - 4), '149'
    ]);
    expect(evaluateWorksheetFormula(large, 'SUM(INDEX(E1#,0,16380))', { row: 1, column: 1 })).toBe(131);
    expect(displaySpillCell(large, 1, 5)?.value).toBe('8');
    expect(displaySpillCell(large, 2, 5)?.value).toBe('6');
    expect(displaySpillCell(large, 1048576, 16384)?.value).toBe('131');
    expect(get.mock.calls.length).toBeLessThan(120);
    expect(scalar("AVERAGE('Large Spill'!E1#)")).toBe(149 / size);
    expect(scalar("COUNT('Large Spill'!E2:XFD1048575)")).toBe(size - 2 * 16_380);
    expect(scalar(`IFERROR(CONCAT('Large Spill'!E1#),"bounded")`)).toBe('bounded');
  });

  it('counts blank worksheet references and sparse spills with different defaults', async () => {
    const { sheets: [summary, , large] } = await loadXlsxWorkbook(await createCountBlankWorkbook());
    const size = 1_048_576 * 16_384;
    const get = vi.spyOn(WorksheetCellIndex.prototype, 'get');
    expect(summary.rows.map(row => row.cells.map(cell => resolveCellValue(summary, cell)))).toEqual([
      ['4', '1048572', '3', '1'], ['1', '1048574', String(size - 1_048_578)]
    ]);
    expect(displaySpillCell(large, 1_048_576, 2)?.value).toBe('0');
    expect(resolveCellValue(large, large.rows.at(-1)!.cells[0])).toBe(String(size - 6));
    expect(get.mock.calls.length).toBeLessThan(80);
    const resolve = (formula: string) => resolveCellValue(summary,
      { ref: 'E1', row: 1, column: 5, value: '', formula, needsCalculation: true });
    for (const formula of ['COUNTBLANK()', 'COUNTBLANK(1)', 'COUNTBLANK({1,""})',
      'COUNTBLANK((A1,A2))', 'COUNTBLANK(A1,A2)', 'COUNTBLANK(Summary:Ledger!A1:A2)']) {
      expect(resolve(formula), formula).toBe('#VALUE!');
    }
    expect(resolve('COUNTBLANK(INDIRECT("Ledger!A6"))')).toBe('1');
    expect(resolve('COUNTBLANK(INDIRECT("Ledger!A0"))')).toBe('#REF!');
    expect(resolve("COUNTBLANK('Large Spill'!B3:C1048576)")).toBe('1048572');
  });

  it('keeps the dense spill scan limit for COUNTBLANK', async () => {
    const { sheets: [, , sheet] } = await loadXlsxWorkbook(await createSequenceWorkbook());
    const evaluate = (formula: string) => evaluateWorksheetFormula(sheet, formula, { row: 1, column: 1 });
    expect(evaluate('COUNTBLANK(XFC1048576:XFD1048576)')).toBe(0);
    expect(evaluate('COUNTBLANK(B1#)')).toBeUndefined();
  });

  it('weights repeated spill errors without changing saved values or reference types', () => {
    const anchor = { ref: 'A1', row: 1, column: 1, value: '', formula: 'IF(B:B=0,1/0,B:B)', needsCalculation: true };
    const sheet: ParsedSheet = { id: 's', name: 'S', rowCount: 1048576, columnCount: 2, rows: [
      { index: 1, cells: [anchor] },
      { index: 2, cells: [{ ref: 'B2', row: 2, column: 2, value: '2' }] },
      { index: 3, cells: [{ ref: 'A3', row: 3, column: 1, value: 'saved', valueType: 'text' }] },
      { index: 4, cells: [{ ref: 'A4', row: 4, column: 1, value: '4' }] }
    ], arrayFormulas: [{ firstRow: 1, lastRow: 1048576, firstColumn: 1, lastColumn: 1 }] };
    const evaluate = (formula: string) => evaluateWorksheetFormula(sheet, formula, { row: 1, column: 2 });
    expect(evaluate('COUNT(A:A)')).toBe(2);
    expect(evaluate('COUNTA(A:A)')).toBe(1048576);
    expect(evaluate('COUNTIF(A:A,"#DIV/0!")')).toBe(1048573);
    expect(evaluate('COUNTBLANK(A:B)')).toBe(1_048_575);
    expect(evaluate('AGGREGATE(9,6,A:A)')).toBe(6);
    expect(evaluate('IFERROR(SUM(A:A),73)')).toBe(73);
  });

  it('recalculates clock-dependent spill defaults across preview refreshes', () => {
    const anchor = { ref: 'A1', row: 1, column: 1, value: '', formula: 'B:B+TODAY()', needsCalculation: true };
    const consumer = { ref: 'C1', row: 1, column: 3, value: '', formula: 'SUM(A:A)', needsCalculation: true };
    const sheet: ParsedSheet = { id: 's', name: 'S', rowCount: 1048576, columnCount: 3,
      rows: [{ index: 1, cells: [anchor, consumer] }],
      arrayFormulas: [{ firstRow: 1, lastRow: 1048576, firstColumn: 1, lastColumn: 1 }] };
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2024, 0, 1));
    expect(resolveCellValue(sheet, consumer)).toBe(String(45292 * 1048576));
    vi.setSystemTime(new Date(2024, 0, 2));
    expect(resolveCellValue(sheet, consumer)).toBe(String(45293 * 1048576));
  });
});
