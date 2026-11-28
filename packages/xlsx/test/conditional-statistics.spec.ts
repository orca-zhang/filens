import { describe, expect, it, vi } from 'vitest';
import { WorksheetCellIndex } from '../src/cell-index';
import { displaySpillCell } from '../src/cell-value';
import { conditionalFormattingWindow } from '../src/conditional-formatting';
import { createRangeValueReader } from '../src/conditional-range-values';
import { withFormulaTime } from '../src/formula-clock';
import { loadXlsxWorkbook } from '../src/parser';
import type { ParsedSheet } from '../src/types';
import { clonePreviewWorkbook } from '../src/workbook-cache';
import { createConditionalStatisticsWorkbook, createDeviationCutoffWorkbook, createSpillConditionalStatisticsWorkbook,
  createWeightedDeviationCutoffWorkbook } from './fixtures/conditional-statistics-workbook.mjs';

function formatsIn(sheet: ParsedSheet) {
  const format = conditionalFormattingWindow(sheet, 1, 15, 1, 9)!;
  return (row: number, column: number) => format(row, column,
    sheet.rows.find(entry => entry.index === row)?.cells.find(cell => cell.column === column));
}

describe('XLSX range statistics', () => {
  it('ranks numbers across disjoint and overlapping ranges, including ties and offscreen formulas', async () => {
    const workbook = await loadXlsxWorkbook(await createConditionalStatisticsWorkbook());
    expect(workbook.warnings).toEqual([]);
    const sheet = workbook.sheets[0];
    const format = formatsIn(sheet);
    expect(format(1, 1)).toMatchObject({ fill: { color: '#FED7AA' }, bold: true });
    for (const row of [2, 3, 4]) expect(format(row, 1)).toEqual({ fill: { type: 'solid', color: '#FFCDD2' } });
    for (const row of [5, 6, 7]) expect(format(row, 1)).toBeUndefined();
    expect(format(1048576, 16384)?.fill?.color).toBe('#FFCDD2');
    expect(sheet.rows.at(-1)?.cells.at(-1)?.value).toBe('50');
    for (const row of [1, 2, 3, 4, 6]) expect(format(row, 2)).toBeUndefined();
    expect(format(5, 2)).toEqual({ fill: { type: 'solid', color: '#FFCDD2' } });
    expect(format(1, 9)).toBeUndefined();
  });

  it('uses population deviations and preserves inclusive comparisons and numeric precision', async () => {
    const { sheets: [sheet] } = await loadXlsxWorkbook(await createConditionalStatisticsWorkbook());
    const format = formatsIn(sheet);
    expect(format(1, 3)).toMatchObject({ fill: { color: '#FED7AA' }, italic: true });
    expect(format(2, 3)).toEqual({ italic: true, bold: true });
    expect(format(3, 3)).toMatchObject({ fill: { color: '#FFCDD2' }, bold: true });
    for (const row of [4, 5, 6]) expect(format(row, 3)).toBeUndefined();
    expect(format(1, 6)?.fill?.color).toBe('#FFCDD2');
    expect(format(2, 6)).toBeUndefined();
    expect(format(3, 6)).toBeUndefined();
    expect(format(1, 7)).toBeUndefined();
    expect(format(2, 7)).toEqual({ bold: true });
    expect(format(3, 7)).toMatchObject({ fill: { color: '#FFCDD2' }, bold: true });
    expect(format(3, 8)).toEqual({ bold: true });
  });

  it('applies signed deviations to base above-average and Office 2010 below-average rules', async () => {
    const { sheets: [sheet] } = await loadXlsxWorkbook(await createConditionalStatisticsWorkbook());
    const format = formatsIn(sheet);
    expect(format(1, 5)).toEqual({ italic: true });
    const above = { bold: true, fill: { type: 'solid', color: '#DCFCE7' } };
    expect(format(2, 5)).toEqual({ ...above, italic: true });
    expect(format(3, 5)).toEqual(above);
    expect(format(1048576, 16384)).toMatchObject({ italic: true, bold: true, fill: { color: '#FFCDD2' } });
  });

  it('distinguishes equality and adjacent binary64 numbers at deviation cutoffs', async () => {
    const { sheets: [sheet] } = await loadXlsxWorkbook(await createDeviationCutoffWorkbook());
    const format = formatsIn(sheet);
    expect(format(2, 1)).toEqual({ italic: true });
    expect(format(2, 2)).toEqual({ bold: true });
    expect(format(3, 1)).toBeUndefined();
    expect(format(3, 2)).toBeUndefined();
    expect(format(3, 3)).toBeUndefined();
    expect(format(6, 3)?.fill?.color).toBe('#FFCDD2');
    expect(format(3, 4)?.fill?.color).toBe('#FFCDD2');
    expect(format(6, 4)).toBeUndefined();
    expect(format(1048576, 16384)).toBeUndefined();
  });

  it('refreshes a deviation cutoff when an offscreen date formula changes', async () => {
    const { sheets: [sheet] } = await loadXlsxWorkbook(await createDeviationCutoffWorkbook({ volatileCutoff: true }));
    const format = formatsIn(sheet);
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date(2024, 0, 1));
      expect(format(1048576, 16384)).toBeUndefined();
      vi.setSystemTime(new Date(2024, 0, 2));
      expect(format(3, 1)).toEqual({ italic: true });
      expect(format(1048576, 16384)?.fill?.color).toBe('#FFCDD2');
    } finally { vi.useRealTimers(); }
  });

  it('checks exact cutoff ties in a full-grid range without scanning individual spill cells', async () => {
    const { sheets: [sheet] } = await loadXlsxWorkbook(await createWeightedDeviationCutoffWorkbook());
    const index = vi.spyOn(WorksheetCellIndex.prototype, 'get');
    try {
      const format = conditionalFormattingWindow(sheet, 1, 15, 1, 9)!;
      expect(format(1, 1, sheet.rows[0].cells[0])?.fill?.color).toBe('#DCFCE7');
      const last = displaySpillCell(sheet, 1048576, 16384);
      expect(last?.value).toBe('2');
      expect(format(1048576, 16384, last)).toBeUndefined();
      expect(index.mock.calls.length).toBeLessThan(200);
    } finally { index.mockRestore(); }
  });

  it.each([
    ['-2147483648', '+2147483647', [-2147483648, 2147483647]],
    ['-2147483649', '2147483648', []],
    ['-1.5', '--1', []]
  ] as const)('validates signed 32-bit deviation attributes %s and %s', async (aboveDeviation, belowDeviation, expected) => {
    const { sheets: [sheet], warnings } = await loadXlsxWorkbook(await createConditionalStatisticsWorkbook({ aboveDeviation, belowDeviation }));
    const signed = sheet.conditionalRules!.flatMap(rule =>
      rule.priority >= 18 && rule.condition.type === 'aboveAverage' ? [rule.condition.deviations] : []);
    expect(signed).toEqual(expected);
    expect(warnings).toEqual(expected.length ? [] : ['Ignored 2 invalid conditional formatting rules in sheet Statistics.']);
  });

  it('counts typed values, case-insensitive text and whole-cell wildcard matches', async () => {
    const { sheets: [sheet] } = await loadXlsxWorkbook(await createConditionalStatisticsWorkbook());
    const format = formatsIn(sheet);
    for (const row of [1, 2, 3, 4, 12, 15, 1048576]) expect(format(row, 4)?.fill?.color).toBe('#FFCDD2');
    for (const row of [5, 6, 7, 8, 9, 10, 11]) expect(format(row, 4)?.fill?.color).toBe('#DCFCE7');
    for (const row of [13, 14, 16]) expect(format(row, 4)).toBeUndefined();
  });

  it('recomputes statistics for independent workbook cache copies', async () => {
    const original = await loadXlsxWorkbook(await createConditionalStatisticsWorkbook());
    const copy = clonePreviewWorkbook(original);
    copy.sheets[1].rows[0].cells[0].value = '-30';
    expect(formatsIn(copy.sheets[0])(1, 1)?.bold).toBeUndefined();
    expect(formatsIn(original.sheets[0])(1, 1)?.bold).toBe(true);
  });

  it('uses weighted spill values across overlapping rule areas and saved cells', async () => {
    const { sheets: [sheet] } = await loadXlsxWorkbook(await createSpillConditionalStatisticsWorkbook());
    const rules = sheet.conditionalRules!;
    const index = vi.spyOn(WorksheetCellIndex.prototype, 'get');
    try {
      const stats = createRangeValueReader(sheet, rules[0].ranges, rules.map(rule => rule.condition))!();
      expect(stats).toMatchObject({ min: -10, max: 80, percentiles: new Map([[0.01, 10], [0.02, 20]]) });
      expect([...stats!.ranks.values()]).toEqual([30]);
      const weighted = [
        [-10, 1], [5, 1], [10, 2 * 1048576 - 3], [20, 16_381 * 1048576 - 3], [30, 1], [40, 1], [80, 1]
      ];
      const count = weighted.reduce((sum, [, weight]) => sum + weight, 0);
      const mean = weighted.reduce((sum, [value, weight]) => sum + value * weight, 0) / count;
      const deviation = Math.sqrt(weighted.reduce((sum, [value, weight]) => sum + (value - mean) ** 2 * weight, 0) / count);
      const { center, scale, mean: shifted, deviation: scaledDeviation } = stats!.average;
      expect((center + shifted) * scale).toBeCloseTo(mean, 10);
      expect(scaledDeviation * scale).toBeCloseTo(deviation, 10);
      expect(index.mock.calls.length).toBeLessThan(1_000);
      expect(stats!.frequency(displaySpillCell(sheet, 3, 5, sheet.rows[2].cells[0])!)).toBe(2);
      expect(stats!.frequency(sheet.rows[1].cells[0])).toBe(1);
      expect(stats!.frequency(sheet.rows[1].cells[1])).toBe(1);
      expect(stats!.frequency(sheet.rows[3].cells[0])).toBe(0);
    } finally { index.mockRestore(); }
  });

  it('refreshes a repeated date value when its spill anchor has a saved cache', () => {
    const sheet: ParsedSheet = { id: 'clock', name: 'Clock', rowCount: 1048576, columnCount: 2,
      rows: [{ index: 1, cells: [{ ref: 'A1', row: 1, column: 1, value: '1', formula: 'B:B+TODAY()' }] }],
      arrayFormulas: [{ firstRow: 1, lastRow: 1048576, firstColumn: 1, lastColumn: 1 }] };
    const read = createRangeValueReader(sheet, [{ firstRow: 1, lastRow: 1048576, firstColumn: 1, lastColumn: 1 }],
      [{ type: 'colorScale', colors: ['#000000', '#FFFFFF'], thresholds: [{ type: 'min' }, { type: 'max' }] }])!;
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date(2024, 0, 1));
      expect(withFormulaTime(sheet, read)).toMatchObject({ min: 1, max: 45292 });
      vi.setSystemTime(new Date(2024, 0, 2));
      expect(withFormulaTime(sheet, read)).toMatchObject({ min: 1, max: 45293 });
    } finally { vi.useRealTimers(); }
  });

  it('keeps the scan limit on generated values that vary by position', () => {
    const sheet: ParsedSheet = { id: 'sequence', name: 'Sequence', rowCount: 1048576, columnCount: 1,
      rows: [{ index: 1, cells: [{ ref: 'A1', row: 1, column: 1, value: '1', formula: 'SEQUENCE(1048576)' }] }],
      arrayFormulas: [{ firstRow: 1, lastRow: 1048576, firstColumn: 1, lastColumn: 1 }] };
    const read = (firstRow: number, lastRow: number) => createRangeValueReader(sheet,
      [{ firstRow, lastRow, firstColumn: 1, lastColumn: 1 }],
      [{ type: 'colorScale', colors: ['#000000', '#FFFFFF'], thresholds: [{ type: 'min' }, { type: 'max' }] }])!();
    expect(read(1, 1048576)).toBeUndefined();
    expect(read(1048574, 1048576)).toMatchObject({ min: 1048574, max: 1048576 });
  });
});
