import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadXlsxWorkbook } from '../src/parser';
import { appendSheetRows, createSheetTable, SheetRowWindow } from '../src/table';
import { SheetMerges } from '../src/merged-cells';
import { createMergedWorkbookFixture } from './fixtures/workbook.mjs';

beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null); });
afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

describe('merged workbook cells', () => {
  it('splits eager spans at HTML limits and suppresses overlapping declarations', () => {
    const index = new SheetMerges({ id: 'large', name: 'Large', rows: [], rowCount: 100_000, columnCount: 1100,
      merges: [{ firstRow: 1, lastRow: 100_000, firstColumn: 1, lastColumn: 1100 },
        { firstRow: 2, lastRow: 3, firstColumn: 2, lastColumn: 4 }] });
    const rows = index.window(65_534, 65_536, 1, 1100, true);
    expect(rows.size).toBe(3);
    expect(rows.get(65_534)?.map(range => [range.firstRow, range.lastRow, range.firstColumn, range.lastColumn]))
      .toEqual([[1, 65_534, 1, 1000], [1, 65_534, 1001, 1100]]);
    expect(rows.get(65_535)?.[0].firstRow).toBe(65_535);
    expect(index.window(1, 3, 1, 20).get(2)).toHaveLength(1);
  });

  it('preserves identical sparse ranges through the numeric fast path and general XML parser', async () => {
    const fast = await loadXlsxWorkbook(await createMergedWorkbookFixture());
    const general = await loadXlsxWorkbook(await createMergedWorkbookFixture({ general: true }));
    expect(fast).toEqual(general);
    const sheet = fast.sheets[0];
    expect(sheet.merges).toHaveLength(5);
    expect(sheet.merges?.[3]).toEqual({ firstRow: 500, lastRow: 1700, firstColumn: 1, lastColumn: 64 });
    expect(sheet.rows).toHaveLength(7);
    const table = createSheetTable(sheet, 100), heading = table.querySelector<HTMLTableCellElement>('[data-merge-ref="A1"]')!;
    expect([heading.rowSpan, heading.colSpan, heading.textContent]).toEqual([3, 4, 'Merged heading']);
    expect(heading.style.fontFamily).toContain('Courier New');
    expect(table.textContent).not.toContain('Covered value');
    expect(table.querySelector('tr[aria-rowindex="3"] td[aria-colindex="2"]')).toBeNull();
    appendSheetRows(table.tBodies[0], sheet, 101, 200);
    expect(table.querySelectorAll('[data-merge-ref="B90"]')).toHaveLength(1);
    expect(table.querySelector<HTMLTableCellElement>('[data-merge-ref="B90"]')!.rowSpan).toBe(41);
    expect(table.querySelector('tr[aria-rowindex="102"] td[aria-colindex="3"]')).toBeNull();
  });

  it('retains offscreen merge anchors and formula dependencies without expanding huge ranges', async () => {
    const sheet = (await loadXlsxWorkbook(await createMergedWorkbookFixture({ formulas: true }))).sheets[0];
    const grid = document.body.appendChild(document.createElement('div'));
    Object.defineProperties(grid, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
    const view = new SheetRowWindow(sheet, grid);
    try {
      grid.scrollTop = 26 * 105; grid.dispatchEvent(new Event('scroll'));
      await expect.poll(() => view.table.querySelector('[data-merge-ref="B90"]')?.parentElement?.getAttribute('aria-rowindex')).toBe('97');
      await expect.poll(() => view.table.querySelector('[data-merge-ref="B90"]')?.textContent).toBe('15');
      const boundary = view.table.querySelector<HTMLTableCellElement>('[data-merge-ref="B90"]')!;
      expect([boundary.rowSpan, boundary.colSpan]).toEqual([35, 7]);
      expect(boundary.style.fontFamily).toContain('Courier New');
      grid.scrollTop = 26 * 1000; grid.scrollLeft = 96 * 64; grid.dispatchEvent(new Event('scroll'));
      await expect.poll(() => view.table.querySelector('[data-merge-ref="A500"]')?.textContent).toBe('Tall merge');
      const distant = view.table.querySelector<HTMLTableCellElement>('[data-merge-ref="A500"]')!;
      expect([distant.rowSpan, distant.colSpan]).toEqual([100, 20]);
      expect(view.table.querySelectorAll('tbody tr[aria-rowindex]')).toHaveLength(100);
      expect(view.table.querySelectorAll('.xlsxv-cell').length).toBeLessThanOrEqual(2000);
      view.refresh();
      expect(view.table.querySelector('[data-merge-ref="A500"]')?.textContent).toBe('Tall merge');
    } finally { view.destroy(); }
  });

  it('includes blank merge endpoints in sheet dimensions and ignores invalid source ranges', async () => {
    const zip = await JSZip.loadAsync(await createMergedWorkbookFixture());
    zip.file('xl/worksheets/sheet.xml', '<worksheet><sheetData><row r="1"><c r="A1"><v>7</v></c></row></sheetData><mergeCells>'
      + ['B2:XFD1048576', 'C8:A1', 'A0:B2', 'A1:XFE2', 'A1:B1048577', '$A$$1:B2'].map(ref => `<mergeCell ref="${ref}"/>`).join('')
      + '</mergeCells></worksheet>');
    const result = await loadXlsxWorkbook(await zip.generateAsync({ type: 'uint8array' }));
    const sheet = result.sheets[0];
    expect([sheet.rowCount, sheet.columnCount, sheet.rows.length, sheet.merges?.length]).toEqual([1048576, 16384, 1, 1]);
    expect(result.warnings).toEqual(['Ignored 5 invalid merged range(s) in sheet Merged.']);
    const grid = document.body.appendChild(document.createElement('div')), view = new SheetRowWindow(sheet, grid);
    try {
      const merge = view.table.querySelector<HTMLTableCellElement>('.xlsxv-merged-cell')!;
      expect([merge.rowSpan, merge.colSpan, merge.textContent]).toEqual([99, 19, '']);
      expect(view.table.querySelectorAll('tbody tr[aria-rowindex]')).toHaveLength(100);
    } finally { view.destroy(); }
  });
});
