import { describe, expect, it } from 'vitest';
import { conditionalFormattingWindow } from '../src/conditional-formatting';
import { loadXlsxWorkbook } from '../src/parser';
import type { ParsedSheet } from '../src/types';
import { clonePreviewWorkbook } from '../src/workbook-cache';
import { createConditionalStatisticsWorkbook } from './fixtures/conditional-statistics-workbook.mjs';

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
});
