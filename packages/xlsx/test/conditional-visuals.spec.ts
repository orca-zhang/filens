import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { conditionalFormattingWindow } from '../src/conditional-formatting';
import { createRangeValueReader } from '../src/conditional-range-values';
import { loadXlsxWorkbook } from '../src/parser';
import type { ParsedSheet } from '../src/types';
import { clonePreviewWorkbook } from '../src/workbook-cache';
import { createConditionalVisualWorkbook } from './fixtures/conditional-visual-workbook.mjs';

const cellAt = (sheet: ParsedSheet, row: number, column: number) =>
  sheet.rows.find(entry => entry.index === row)?.cells.find(cell => cell.column === column);

describe('conditional visual rules', () => {
  it('evaluates two and three stops using thresholds, unique sparse values and offscreen formulas', async () => {
    const workbook = await loadXlsxWorkbook(await createConditionalVisualWorkbook());
    const [sheet] = workbook.sheets;
    expect(workbook.warnings).toEqual(['Ignored 1 invalid conditional formatting rules in sheet Visual Rules.']);
    expect(sheet.conditionalRules?.length).toBe(8);
    const offscreen = cellAt(sheet, 1_048_576, 1)!;
    const view = conditionalFormattingWindow(sheet, 1, 8, 1, 7)!;
    const paint = (row: number, column: number) => view(row, column, cellAt(sheet, row, column));
    expect(paint(2, 5)?.fill?.color).toBe('#004433');
    expect(paint(3, 6)?.fill?.color).toBe('#808080');
    expect(offscreen.needsCalculation).toBe(true);
    expect([1, 2, 3, 4].map(row => paint(row, 1)?.fill?.color)).toEqual(['#000000', '#800000', '#FF0000', '#FFDFDF']);
    expect(offscreen.value).toBe('100');
    for (const row of [5, 6, 7, 8]) expect(paint(row, 1)).toBeUndefined();
    expect(paint(1, 7)?.fill?.color).toBe('#FFFFFF');

    const next = conditionalFormattingWindow(sheet, 1_048_480, 1_048_576, 1, 20)!;
    expect(next(1_048_576, 1, offscreen)?.fill?.color).toBe('#FFFFFF');
  });

  it('preserves legacy lengths, linked and standalone Office 2010 settings and signed axes', async () => {
    const { sheets: [sheet] } = await loadXlsxWorkbook(await createConditionalVisualWorkbook());
    const view = conditionalFormattingWindow(sheet, 1, 5, 1, 7)!;
    const bar = (row: number, column: number) => view(row, column, cellAt(sheet, row, column))?.dataBar;
    expect([1, 2, 3, 4].map(row => bar(row, 2)?.width)).toEqual([20, 35, 50, 80]);
    expect(bar(2, 2)).toMatchObject({ start: 0, color: '#0066CC', gradient: 'right', showValue: false });
    expect(bar(2, 3)).toEqual({ start: 12.5, width: 12.5, color: '#AA1122', borderColor: '#660011',
      axis: { position: 25, color: '#334455' }, showValue: true });
    expect(bar(3, 3)).toMatchObject({ start: 25, width: 0 });
    expect(bar(4, 3)).toMatchObject({ start: 25, color: '#008866', borderColor: '#008866' });
    expect(bar(4, 3)?.width).toBeCloseTo(12.5);
    expect(bar(1, 4)).toMatchObject({ start: 50, width: 25, gradient: 'right', color: '#4466BB', axis: { position: 50, color: '#111111' } });
    expect(bar(2, 4)).toMatchObject({ start: 37.5, width: 12.5, gradient: 'left', color: '#4466BB' });
    const merged = view(500, 8, cellAt(sheet, 500, 8))?.dataBar;
    expect(merged?.width).toBeCloseTo(77.77778);
  });

  it('keeps the legacy bar if its linked extension is damaged', async () => {
    const zip = await JSZip.loadAsync(await createConditionalVisualWorkbook());
    const path = 'xl/worksheets/s1.xml';
    const xml = await zip.file(path)!.async('string');
    zip.file(path, xml.replace('v:cfvo type="autoMin"', 'v:cfvo type="invalid"'));
    const { sheets: [sheet], warnings } = await loadXlsxWorkbook(await zip.generateAsync({ type: 'uint8array' }));
    const view = conditionalFormattingWindow(sheet, 1, 8, 1, 7)!;
    const bar = view(2, 3, cellAt(sheet, 2, 3))?.dataBar;
    expect(bar).toMatchObject({ start: 0, width: 20, color: '#008866', gradient: 'right' });
    expect(bar?.axis).toBeUndefined();
    expect(warnings).toEqual(['Ignored 2 invalid conditional formatting rules in sheet Visual Rules.']);
  });

  it('shares percentile scans per range, preserves fast-path metadata and isolates cached sessions', async () => {
    const [original, general] = await Promise.all([false, true].map(async parseGeneral =>
      loadXlsxWorkbook(await createConditionalVisualWorkbook(parseGeneral))));
    expect(original.sheets[1]).toEqual(general.sheets[1]);
    expect(original.sheets[1].rowCount).toBe(2);
    expect(original.sheets[1].conditionalRules?.[0].ranges[0].lastRow).toBe(1_048_576);
    const copy = clonePreviewWorkbook(original);
    cellAt(copy.sheets[2], 1, 2)!.value = '20';
    const at = (sheet: ParsedSheet) => conditionalFormattingWindow(sheet, 1, 8, 1, 7)!(2, 5, cellAt(sheet, 2, 5))?.fill?.color;
    expect(at(copy.sheets[0])).toBe('#00221A');
    expect(at(original.sheets[0])).toBe('#004433');

    const sheet: ParsedSheet = { id: 'points', name: 'Points', rowCount: 300, columnCount: 1,
      rows: Array.from({ length: 300 }, (_, row) => ({ index: row + 1,
        cells: [{ row: row + 1, column: 1, ref: `A${row + 1}`, value: String(row) }] })) };
    const read = createRangeValueReader(sheet, [
      { firstRow: 1, lastRow: 300, firstColumn: 1, lastColumn: 1 },
      { firstRow: 1, lastRow: 150, firstColumn: 1, lastColumn: 1 }
    ], [{ type: 'colorScale', colors: ['#000000', '#FFFFFF'],
      thresholds: [{ type: 'percentile', value: 25 }, { type: 'percentile', value: 75 }] }])!;
    const cached = read();
    expect(cached).toMatchObject({ min: 0, max: 299, percentiles: new Map([[25, 74.75], [75, 224.25]]) });
    expect(read()).toBe(cached);
  });
});
