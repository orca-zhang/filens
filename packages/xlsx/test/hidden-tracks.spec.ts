import { describe, expect, it, vi } from 'vitest';
import { loadXlsxWorkbook } from '../src/parser';
import { appendSheetRows, createSheetTable, SheetRowWindow } from '../src/table';
import { sheetTracks, VisibleTracks } from '../src/visible-tracks';
import { clonePreviewWorkbook } from '../src/workbook-cache';
import { createHiddenTracksWorkbook } from './fixtures/hidden-tracks-workbook.mjs';

describe('hidden workbook tracks', () => {
  it('combines overlapping ranges and maps visible positions at either end', () => {
    const tracks = new VisibleTracks(8, [{ first: 7, last: 10 }, { first: 1, last: 2 },
      { first: 4, last: 5 }, { first: 5, last: 5 }]);
    expect(tracks.count).toBe(2);
    expect([1, 2, 3].map(index => tracks.source(index))).toEqual([3, 6, 9]);
    expect(Array.from({ length: 9 }, (_, i) => tracks.before(i + 1))).toEqual([0, 0, 0, 1, 1, 1, 2, 2, 2]);
  });

  it('preserves hidden metadata on both XML paths and isolates cache copies', async () => {
    const [fast, general] = await Promise.all([false, true].map(async forceGeneral =>
      loadXlsxWorkbook(await createHiddenTracksWorkbook({ formulas: false, forceGeneral }))));
    expect(fast.warnings).toEqual([]);
    expect(fast).toEqual(general);
    const sheet = fast.sheets[0], { rows, columns } = sheetTracks(sheet);
    expect([rows.count, columns.count]).toEqual([3, 5]);
    expect([1, 2, 3].map(i => rows.source(i))).toEqual([3, 4, 1048576]);
    expect([1, 2, 3, 4, 5].map(i => columns.source(i))).toEqual([1, 3, 5, 16383, 16384]);
    const copy = clonePreviewWorkbook(fast);
    expect(copy.sheets[0].hiddenRows).toEqual(sheet.hiddenRows);
    expect(copy.sheets[0].hiddenRows?.[0]).not.toBe(sheet.hiddenRows?.[0]);
    expect(copy.sheets[0].hiddenColumns?.[0]).not.toBe(sheet.hiddenColumns?.[0]);
  });

  it('preserves the hidden merge anchor and formula references across visible batches', async () => {
    const { sheets: [sheet, , empty] } = await loadXlsxWorkbook(await createHiddenTracksWorkbook());
    const canvas = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    try {
      const table = createSheetTable(sheet, 3);
      expect([...table.querySelectorAll('.xlsxv-col-header')].map(element => element.textContent)).toEqual(['A', 'C', 'E', 'XFC', 'XFD']);
      const merge = table.querySelector<HTMLTableCellElement>('[data-merge-ref="B1"]')!;
      expect([merge.rowSpan, merge.colSpan, merge.textContent, merge.style.backgroundColor]).toEqual([2, 2, '8', 'rgb(220, 252, 231)']);
      expect(merge.style.borderLeftWidth).toBe('');
      expect(merge.style.borderTopWidth).toBe('');
      appendSheetRows(table.tBodies[0], sheet, 4, 1048576);
      expect([...table.tBodies[0].rows].map(row => row.getAttribute('aria-rowindex'))).toEqual(['4', '5', '1048577']);
      expect(table.querySelector('tr[aria-rowindex="1048577"] td[aria-colindex="16385"]')?.textContent).toBe('25');
      expect(table.querySelector('[data-merge-ref="D10"]')).toBeNull();
      const window = new SheetRowWindow(empty, document.createElement('div'));
      try {
        expect(window.table.querySelector('.xlsxv-col-header')).toBeNull();
        expect(window.table.querySelector('tbody tr[aria-rowindex]')).toBeNull();
        window.refresh();
      } finally { window.destroy(); }
    } finally { canvas.mockRestore(); }
  });
});
