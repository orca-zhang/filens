import { describe, expect, it, vi } from 'vitest';
import { conditionalFormattingWindow } from '../src/conditional-formatting';
import { loadXlsxWorkbook, resolveCellValue } from '../src/parser';
import { createSheetTable } from '../src/table';
import type { ParsedSheet } from '../src/types';
import { clonePreviewWorkbook } from '../src/workbook-cache';
import { createConditionalFormattingWorkbook } from './fixtures/conditional-formatting-workbook.mjs';

const getCell = (sheet: ParsedSheet, row: number, column: number) => sheet.rows.find(entry => entry.index === row)?.cells.find(cell => cell.column === column);

describe('XLSX conditional formatting', () => {
  it('combines differential styles by priority, stops lower rules, and keeps typed conditions distinct', async () => {
    const workbook = await loadXlsxWorkbook(await createConditionalFormattingWorkbook());
    expect(workbook.warnings).toEqual([
      'Ignored 2 invalid conditional formatting rules in sheet Formats.',
      'Skipped 1 unsupported conditional formatting rules in sheet Formats.'
    ]);
    const sheet = workbook.sheets[0];
    const conditional = conditionalFormattingWindow(sheet, 1, 5, 1, 8)!;
    const style = (row: number, column: number) => {
      const cell = getCell(sheet, row, column);
      if (cell) resolveCellValue(sheet, cell);
      return conditional(row, column, cell);
    };
    expect(style(1, 1)).toMatchObject({ fill: { color: '#FFCDD2' }, color: '#9C0006', italic: true,
      numberFormat: '0.00', borders: { bottom: { width: 3, color: '#FF0000' } } });
    expect(style(2, 1)).toBeUndefined();
    expect(style(3, 1)).toMatchObject({ fill: { color: '#DCFCE7' }, numberFormat: '0.00' });
    expect(style(4, 1)).toBeUndefined();
    expect(style(5, 1)).toMatchObject({ fill: { type: 'none' }, bold: false, italic: false, strike: false, underline: 'none', numberFormat: 'General' });
    expect(getCell(sheet, 1, 1)?.value).toBe('12');
    expect(style(1, 2)).toMatchObject({ color: '#336699', bold: true });
    expect(style(2, 2)).toBeUndefined();
    expect(style(1, 3)?.fill?.color).toBe('#FDE68A');
    expect(style(2, 3)?.fill?.color).toBe('#F1F5F9');
    expect(style(3, 3)).toMatchObject({ fill: { color: '#FED7AA' }, color: '#336699' });
    expect(style(4, 3)?.fill?.color).toBe('#FFCDD2');
    expect(getCell(sheet, 1, 4)).toBeUndefined();
    for (const row of [1, 2, 3]) expect(style(row, 4)?.fill?.color).toBe('#F1F5F9');
    expect(style(2, 5)).toBeUndefined();
    expect(style(3, 5)?.fill?.color).toBe('#FED7AA');
    expect(style(500, 1)?.fill?.color).toBe('#FFCDD2');
  });

  it('retains worksheet metadata on the fast path and does not size a sheet from a conditional range', async () => {
    const [fast, general] = await Promise.all([false, true].map(async parseGeneral =>
      (await loadXlsxWorkbook(await createConditionalFormattingWorkbook(parseGeneral))).sheets[1]));
    expect(fast).toEqual(general);
    expect(fast.conditionalRules).toHaveLength(1);
    expect(fast.conditionalRules?.[0].ranges[0].lastRow).toBe(1_048_576);
    expect(fast.rowCount).toBe(2);
    const canvas = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    let table;
    try { table = createSheetTable(fast); }
    finally { canvas.mockRestore(); }
    const cells = table.querySelectorAll<HTMLElement>('.xlsxv-cell');
    expect(cells).toHaveLength(2);
    expect(cells[0].style.backgroundColor).toBe('rgb(255, 205, 210)');
    expect(cells[1].style.backgroundColor).toBe('');
  });

  it('reuses cross-sheet formula evaluation and keeps cached workbook sessions independent', async () => {
    const original = await loadXlsxWorkbook(await createConditionalFormattingWorkbook());
    const copy = clonePreviewWorkbook(original);
    const style = (sheet: ParsedSheet) => {
      const row = 1_048_576, column = 16_384, cell = getCell(sheet, row, column)!;
      resolveCellValue(sheet, cell);
      return conditionalFormattingWindow(sheet, row - 99, row, column - 19, column)!(row, column, cell);
    };
    expect(copy.sheets[0].conditionalRules?.[0].ranges).not.toBe(original.sheets[0].conditionalRules?.[0].ranges);
    const higher = copy.sheets[0].conditionalRules?.find(rule => rule.priority === 3)?.style;
    expect(higher).toBe(copy.sheets[1].conditionalRules?.[0].style);
    expect(higher).not.toBe(original.sheets[1].conditionalRules?.[0].style);
    getCell(copy.sheets[2], 1, 1)!.value = '1';
    expect(style(copy.sheets[0])).toEqual({ color: '#336699', bold: true });
    expect(style(original.sheets[0])).toMatchObject({ fill: { color: '#FFCDD2' }, color: '#9C0006', bold: true });
    expect(getCell(copy.sheets[0], 1_048_576, 16_384)?.value).toBe('3');
    expect(getCell(original.sheets[0], 1_048_576, 16_384)?.value).toBe('22');
  });
});
