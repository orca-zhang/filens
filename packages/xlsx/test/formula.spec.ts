import { describe, expect, it } from 'vitest';
import { loadXlsxWorkbook, resolveCellValue } from '../src/parser';
import { clonePreviewWorkbook } from '../src/workbook-cache';
import type { ParsedCell, ParsedSheet } from '../src/types';
import { createFormulaWorkbook } from './fixtures/formula-workbook.mjs';

function sheet(values: string[], formula: string) {
  const result: ParsedCell = { ref: 'B1', row: 1, column: 2, value: '', formula, needsCalculation: true };
  const model: ParsedSheet = {
    id: 'sum', name: 'Sum', columnCount: 2, rowCount: values.length,
    rows: values.map((value, index) => ({ index: index + 1, cells: [{ ref: `A${index + 1}`, row: index + 1, column: 1, value }] }))
  };
  model.rows[0].cells.push(result);
  return { model, result };
}

describe('formula range evaluation', () => {
  it.each([
    ['2^3^2', '512'], ['-2^2', '4'], ['2^-2', '0.25'],
    ['1-2-3', '-4'], ['8/4/2', '1'], ['1+2*3^2', '19']
  ])('preserves existing arithmetic precedence and associativity: %s', (formula, expected) => {
    const { model, result } = sheet(['1'], formula);
    expect(resolveCellValue(model, result)).toBe(expected);
  });

  it('calculates SUM ranges larger than the engine argument limit', () => {
    const count = 160_000;
    const { model, result } = sheet(Array.from({ length: count }, (_, index) => String(index + 1)), `SUM(A1:A${count})`);
    expect(resolveCellValue(model, result)).toBe(String(count * (count + 1) / 2));
    expect(result.needsCalculation).toBe(false);
  });

  it('preserves addition order across scalars, ranges and nested SUM calls', () => {
    const { model, result } = sheet(['-10000000000000000', '1'], 'SUM(1E16,$A$1:A2,SUM(1,1))');
    expect(resolveCellValue(model, result)).toBe('3');
  });

  it.each([
    ['SUM(1E16,(( $A$1:A2 )),SUM(1,1))', '3'],
    ['SUM(1E16,SUM($A$1:A2),SUM(1,1))', '2'],
    ['SUM((A2:A1),1E16)', '0']
  ])('preserves parentheses and floating point grouping: %s', (formula, expected) => {
    const { model, result } = sheet(['-10000000000000000', '1'], formula);
    expect(resolveCellValue(model, result)).toBe(expected);
  });

  it('preserves intermediate overflow instead of pre-summing a range', () => {
    const formula = 'SUM(1E308,A1:A2)';
    const { model, result } = sheet(['1E308', '-1E308'], formula);
    expect(resolveCellValue(model, result)).toBe(`=${formula}`);
  });

  it.each(['SUM((A1:A2)+1)', 'SUM(A1:A2*0)', 'SUM((A1:A2)', 'SUM(A1:A2,)'])(
    'keeps dependency evaluation before a range-expression error: %s', formula => {
      const { model, result } = sheet(['2', ''], formula);
      Object.assign(model.rows[1].cells[0], { formula: 'A1*3', needsCalculation: true });
      expect(resolveCellValue(model, result)).toBe(`=${formula}`);
      expect(model.rows[1].cells[0]).toMatchObject({ value: '6', needsCalculation: false });
    });

  it('stops reading later dependencies when a streamed range contains nonnumeric data', () => {
    const { model, result } = sheet(['text', ''], 'SUM(A1:A2)');
    Object.assign(model.rows[1].cells[0], { formula: '1+2', needsCalculation: true });
    expect(resolveCellValue(model, result)).toBe('=SUM(A1:A2)');
    expect(model.rows[1].cells[0]).toMatchObject({ value: '', needsCalculation: true });
  });

  it.each([
    ['SUM(A1:A2+C1)', true], ['SUM((A1:A2)*C1)', true],
    ['SUM((A1:A2)^C1)', false], ['+(A1:A2)+C1', false]
  ])('preserves right-hand dependency reads for unsupported range arithmetic: %s', (formula, readsRight) => {
    const { model, result } = sheet(['2', ''], formula);
    Object.assign(model.rows[1].cells[0], { formula: 'A1*3', needsCalculation: true });
    const right: ParsedCell = { ref: 'C1', row: 1, column: 3, value: '', formula: '3+4', needsCalculation: true };
    model.rows[0].cells.push(right);
    expect(resolveCellValue(model, result)).toBe(`=${formula}`);
    expect(model.rows[1].cells[0]).toMatchObject({ value: '6', needsCalculation: false });
    expect(right).toMatchObject({ value: readsRight ? '7' : '', needsCalculation: !readsRight });
  });

  it('handles reversed absolute ranges, boolean values and empty cells', () => {
    const { model, result } = sheet([' 2 ', 'TRUE', 'FALSE', ''], 'SUM($A$4:$A$1)+$A$1');
    expect(resolveCellValue(model, result)).toBe('5');
  });

  it('calculates formula dependencies through a range and reuses cached values', () => {
    const { model, result } = sheet(['2', ''], 'SUM(A1:A2)');
    const dependency = model.rows[1].cells[0];
    Object.assign(dependency, { formula: '$A$1*3', needsCalculation: true });
    expect(resolveCellValue(model, result)).toBe('8');
    expect(dependency.value).toBe('6');
    expect(dependency.needsCalculation).toBe(false);
    expect(resolveCellValue(model, result)).toBe('8');
  });

  it('sums a full-sheet sparse range without visiting billions of empty coordinates', () => {
    const model: ParsedSheet = { id: 'sparse', name: 'Sparse', columnCount: 16384, rowCount: 1048576, rows: [
      { index: 1048576, cells: [{ ref: 'XFD1048576', row: 1048576, column: 16384, value: '7' }] },
      { index: 1, cells: [{ ref: 'A1', row: 1, column: 1, value: '2' }] },
      { index: 32, cells: [{ ref: 'AF32', row: 32, column: 32, value: '', formula: 'A1*3', needsCalculation: true }] }
    ] };
    const result: ParsedCell = { ref: 'XFE1', row: 1, column: 16385, value: '',
      formula: 'SUM($XFD$1048576:$A$1)', needsCalculation: true };
    expect(resolveCellValue(model, result)).toBe('15');
    expect(model.rows[2].cells[0].value).toBe('6');
  });

  it('keeps row-major floating point order and the last duplicate coordinate', () => {
    const model: ParsedSheet = { id: 'order', name: 'Order', columnCount: 33, rowCount: 3, rows: [
      { index: 3, cells: [{ ref: 'AG3', row: 3, column: 33, value: '1' }] },
      { index: 1, cells: [{ ref: 'AF1', row: 1, column: 32, value: '1E16' }, { ref: 'A1', row: 1, column: 1, value: '99' }] },
      { index: 2, cells: [{ ref: 'A2', row: 2, column: 1, value: '-1E16' }] },
      { index: 1, cells: [{ ref: 'A1', row: 1, column: 1, value: '0' }] }
    ] };
    const result: ParsedCell = { ref: 'AH1', row: 1, column: 34, value: '', formula: 'SUM(AG3:A1)', needsCalculation: true };
    expect(resolveCellValue(model, result)).toBe('1');
    expect(resolveCellValue(model, { ...result, formula: 'AF1+A2+AG3', needsCalculation: true })).toBe('1');
  });

  it.each(['SUM(A1:A2)', 'A1:A2+1', 'AVERAGE(A1:A2)', 'SUM(A1:A2,)', 'SUM(B1)'])('keeps unsupported, nonnumeric and circular formulas visible: %s', formula => {
    const { model, result } = sheet(['text', '1'], formula);
    expect(resolveCellValue(model, result)).toBe(`=${formula}`);
    expect(result.needsCalculation).toBe(false);
  });
});

describe('typed workbook formulas', () => {
  it.each([
    ['-2^2+12.5%*8', '5', undefined], ['2^3^2', '512', undefined],
    ['"a ""quote""" & TRUE & 3', 'a "quote"TRUE3', 'text'],
    ['_xlfn.CONCAT("項目 ",2,LEN("測試"))', '項目 22', 'text'],
    ['IF(3<>4,TRUE,1/0)', 'TRUE', 'boolean'],
    ['IF(FALSE,UNKNOWN(A1),"ok")', 'ok', 'text'],
    ['IFERROR(5,UNKNOWN(A1))', '5', undefined],
    ['IFERROR(#N/A,"fallback")', 'fallback', 'text'],
    ['NOT(AND(OR(FALSE,TRUE),1))', 'FALSE', 'boolean'],
    ['ROUND(-2.675,2)', '-2.68', undefined], ['ROUNDUP(-4.1,0)', '-5', undefined],
    ['ROUNDDOWN(-1.9,0)', '-1', undefined], ['ROUND(1250,-2)', '1300', undefined],
    ['MIN(9,4,7)+MAX(9,4,7)', '13', undefined],
    ['1/0', '#DIV/0!', 'error'], ['XFE1', '#REF!', 'error'],
    ['SUM("x",1)', '#VALUE!', 'error'], ['ABS(-5)', '5', undefined]
  ])('evaluates %s as the expected value and type', (formula, value, type) => {
    const { model, result } = sheet(['1'], formula);
    expect(resolveCellValue(model, result)).toBe(value);
    expect(result.valueType).toBe(type);
  });

  it('evaluates cross-sheet formulas, whole columns/rows and data types on sparse source cells', async () => {
    const { sheets: [summary, input] } = await loadXlsxWorkbook(await createFormulaWorkbook());
    const row = (index: number) => summary.rows[index].cells.map(cell => resolveCellValue(summary, cell));
    expect(row(0)).toEqual(['10', '15', '7.5', 'total: 15', 'safe', '2.68', '1', '1', '6']);
    expect(input.rows[0].cells[0].value).toBe('10');
    expect(row(1)).toEqual(['=Input!B1', 'missing', '#N/A', '4:TRUE', '5', "='[remote.xlsx]Sheet1'!A1"]);
    const last = summary.rows[2].cells[0];
    expect(resolveCellValue(summary, last)).toBe('225.25');
    expect(summary.rows[0].cells[3].valueType).toBe('text');
    expect(summary.rows[1].cells[2].valueType).toBe('error');
  });

  it('resolves sibling references against the individual cached workbook copy', async () => {
    const original = await loadXlsxWorkbook(await createFormulaWorkbook());
    const copy = clonePreviewWorkbook(original);
    copy.sheets[2].rows[0].cells[0].value = '99';
    expect(resolveCellValue(copy.sheets[0], copy.sheets[0].rows[0].cells[0])).toBe('100');
    expect(resolveCellValue(original.sheets[0], original.sheets[0].rows[0].cells[0])).toBe('10');
  });

  it('bounds dependency recursion without caching failures in uncalculated dependencies', () => {
    const { model, result } = sheet(Array(75).fill(''), 'A1');
    model.rows.forEach((row, i) => Object.assign(row.cells[0], {
      formula: i === model.rows.length - 1 ? '1' : 'A' + (i + 2) + '+1',
      needsCalculation: true
    }));
    expect(resolveCellValue(model, result)).toBe('=A1');
    expect(model.rows[50].cells[0].needsCalculation).toBe(true);
    expect(resolveCellValue(model, model.rows[50].cells[0])).toBe('25');
  });
});
