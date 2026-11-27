import { describe, expect, it } from 'vitest';
import { RowHeights } from '../src/row-heights';
import { loadXlsxWorkbook } from '../src/parser';
import { createSheetTable } from '../src/table';
import { sheetTracks } from '../src/visible-tracks';
import { clonePreviewWorkbook } from '../src/workbook-cache';
import { createRowHeightWorkbook } from './fixtures/row-height-workbook.mjs';

describe('variable row heights', () => {
  it('indexes mixed source heights, sparse measurements and pixel boundaries', () => {
    const heights = new RowHeights(5, [26, 90, 40.5, 0, NaN], new Map([[4, 180]]));
    expect([1, 2, 3, 4, 5, 6].map(row => heights.before(row))).toEqual([0, 26, 116, 156.5, 336.5, 362.5]);
    expect([-10, 0, 25.9, 26, 115.9, 116, 156.5, 999].map(pixel => heights.at(pixel))).toEqual([1, 1, 1, 2, 2, 3, 4, 5]);
    expect(heights.set(2, 120)).toBe(true);
    expect(heights.before(3)).toBe(146);
    expect(heights.at(140)).toBe(2);
    expect(heights.set(2, 120.1)).toBe(false);
    expect(heights.set(0, 50)).toBe(false);
    expect(heights.set(6, 50)).toBe(false);
    expect(heights.set(2, Infinity)).toBe(false);
    expect(heights.set(2, 20)).toBe(true);
    expect(heights.height(2)).toBe(90);
  });

  it('updates a distant row without losing a million-row sheet’s cumulative position', () => {
    const heights = new RowHeights(1_048_576, [], new Map([[500_000, 200]]));
    expect(heights.before(1_048_577)).toBe(26 * 1_048_576 + 174);
    heights.set(1_000_000, 80);
    const offset = 26 * 999_999 + 174;
    expect(heights.before(1_000_000)).toBe(offset);
    expect(heights.at(offset + 79)).toBe(1_000_000);
    expect(heights.at(offset + 80)).toBe(1_000_001);
  });

  it('locates measured sparse XLSX rows without a dense source array', () => {
    const count = 1_048_576;
    const heights = new RowHeights(count, undefined, new Map([[3, 64], [count, 70]]));
    expect(heights.before(count)).toBe(26 * (count - 1) + 38);
    expect(heights.at(52 + 63)).toBe(3);
    expect(heights.at(52 + 64)).toBe(4);
    expect(heights.at(heights.before(count + 1) - 1)).toBe(count);
    heights.set(3, 26);
    expect(heights.before(count + 1)).toBe(26 * count + 44);
  });

  it('retains the same sparse height data in both XML readers and independent cached models', async () => {
    const [fast, general] = await Promise.all([false, true].map(async forceGeneral =>
      loadXlsxWorkbook(await createRowHeightWorkbook({ forceGeneral }))));
    expect(fast).toEqual(general);
    expect(fast.warnings).toEqual([]);
    const sheet = fast.sheets[0], source = sheet.rowHeightSource!;
    expect(source.height).toBe(20);
    expect([...source.rows.keys()]).toEqual([2, 3, 4, 5, 7, 500001, 1048576]);
    expect(sheet.rowHeights).toBeUndefined();
    expect(sheet.hiddenRows).toEqual([{ first: 6, last: 6 }]);
    const cached = clonePreviewWorkbook(fast).sheets[0].rowHeightSource!;
    expect(cached).toEqual(source);
    expect(cached.rows.get(2)).not.toBe(source.rows.get(2));
  });

  it('indexes a million rows with source lengths, skips hidden rows and measures only automatic rows', async () => {
    const { sheets: [sheet, compact] } = await loadXlsxWorkbook(await createRowHeightWorkbook());
    const heights = new RowHeights(sheet.rowCount, undefined, new Map([[2, 80], [3, 60], [6, 70]]), sheetTracks(sheet).rows, sheet.rowHeightSource);
    expect([1, 2, 3, 4, 5, 6, 7, 500001].map(row => heights.height(row))).toEqual([20, 8, 60, 40, 35, 0, 20, 100]);
    expect(heights.set(2, 40)).toBe(false);
    expect(heights.set(3, 10)).toBe(true);
    expect(heights.height(3)).toBe(40);
    expect(heights.at(heights.before(7))).toBe(7);
    expect(heights.at(heights.before(500001) + 99)).toBe(500001);
    expect(heights.at(heights.before(sheet.rowCount + 1) - 1)).toBe(sheet.rowCount);
    const small = new RowHeights(compact.rowCount, undefined, new Map([[1, 80], [2, 50]]), sheetTracks(compact).rows, compact.rowHeightSource);
    expect([small.height(1), small.height(2), small.before(4)]).toEqual([4, 50, 58]);
  });

  it('uses source heights in the standalone table and clips fixed merged content', async () => {
    const { sheets: [sheet] } = await loadXlsxWorkbook(await createRowHeightWorkbook());
    const table = createSheetTable({ ...sheet, columnCount: 3, columnWidths: sheet.columnWidths?.slice(0, 3) }, 7);
    const rows = [...table.tBodies[0].rows];
    expect(rows.map(row => row.style.height)).toEqual(['20px', '8px', '40px', '40px', '35px', '20px']);
    const fixed = rows[1].querySelector<HTMLElement>('.xlsxv-fixed-clip')!;
    expect(fixed.textContent).toContain('Sixth line');
    const merge = table.querySelector<HTMLElement>('[data-merge-ref="B4"]')!;
    expect(merge.querySelector('.xlsxv-merged-content')?.textContent).toContain('Sixth line');
    expect(merge.querySelector('.xlsxv-merged-clip')?.classList.contains('is-single-row')).toBe(false);
  });
});
