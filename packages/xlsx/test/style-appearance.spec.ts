import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadXlsxWorkbook } from '../src/parser';
import { createSheetTable, SheetRowWindow } from '../src/table';
import { clonePreviewWorkbook } from '../src/workbook-cache';
import { createStyledWorkbookFixture } from './fixtures/styled-workbook.mjs';

beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null); });
afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

describe('XLSX cell appearance', () => {
  it('shares source styles across both parsing paths and retains only stored cells', async () => {
    const workbook = await loadXlsxWorkbook(await createStyledWorkbookFixture());
    expect(await loadXlsxWorkbook(await createStyledWorkbookFixture(true))).toEqual(workbook);
    const sheet = workbook.sheets[0];
    expect(sheet.rows.map(row => [row.index, row.cells.length])).toEqual([[1, 4], [2, 3], [90, 0], [500, 1], [2000, 1]]);
    const formats = sheet.cellStyles!.formats;
    expect(formats[3]).toMatchObject({
      fontSize: 16, color: '#19334D', underline: 'double', strike: true,
      horizontal: 'center', vertical: 'middle', wrap: true,
      fill: { type: 'solid', color: '#FDE68A' },
      borders: { top: { color: '#B91C1C', width: 1 }, right: { color: '#0000FF', dash: 'dash', width: 2 },
        bottom: { color: '#336699', compound: 'double' }, left: { color: '#000000', dash: 'dot' } }
    });
    expect(formats[2]).toMatchObject({ color: '#0D332C', fill: { type: 'solid', color: '#8CB2D9' } });
    expect(formats[4].fill).toMatchObject({ type: 'gradient', angle: -90, stops: [{ position: 0, color: '#000000' }, { position: 1, color: '#191919' }] });
    expect(sheet.rows[0].cells[0].font).toBe(formats[3].font);
    const copy = clonePreviewWorkbook(workbook);
    expect(copy.sheets[0].cellStyles!.formats[3].font).toBe(copy.fonts![1]);
    expect(copy.sheets[0].cellStyles!.formats[3].font).toBe(copy.sheets[0].rows[0].cells[0].font);
    expect(copy.sheets[0].cellStyles!.formats[3].fill).not.toBe(formats[3].fill);
  });

  it('renders explicit, row, column and inherited blank styles and paints only real merge edges', async () => {
    const sheet = (await loadXlsxWorkbook(await createStyledWorkbookFixture())).sheets[0];
    const table = createSheetTable(sheet, 2);
    const at = (r: number, c: number) => table.querySelector<HTMLTableCellElement>(`tr[aria-rowindex="${r + 1}"] td[aria-colindex="${c + 1}"]`)!;
    expect(at(1, 1).style.fontStyle).toBe('italic');
    expect(at(1, 1).style.fontSize).toBe('16px');
    expect(at(1, 1).style.fontWeight).toBe('700');
    expect(at(1, 1).style.textDecorationLine).toBe('underline line-through');
    expect(at(1, 1).style.textDecorationStyle).toBe('double');
    expect(at(1, 1).classList.contains('xlsxv-wrap')).toBe(true);
    expect(at(1, 1).style.borderBottomStyle).toBe('double');
    expect(at(1, 2).textContent).toBe('');
    expect(at(1, 2).style.backgroundColor).toBe('rgb(140, 178, 217)');
    expect(at(1, 3).style.backgroundColor).toBe('');
    expect(at(1, 4).style.backgroundImage).toContain('repeating-linear-gradient');
    expect(at(1, 5).style.backgroundImage).toContain('linear-gradient');
    expect(at(2, 1).style.backgroundColor).toBe('rgb(253, 230, 138)');
    expect(at(2, 1).style.paddingRight).toBe('26px');
    expect(at(2, 2).style.backgroundColor).toBe('rgb(140, 178, 217)');
    expect(at(2, 3).style.backgroundColor).toBe('rgb(253, 230, 138)');
    const grid = document.body.appendChild(document.createElement('div'));
    Object.defineProperty(grid, 'clientWidth', { value: 800 });
    const view = new SheetRowWindow(sheet, grid);
    try {
      grid.scrollLeft = 12 * 7 * 15; grid.scrollTop = 26 * 115; grid.dispatchEvent(new Event('scroll'));
      const merge = () => view.table.querySelector<HTMLTableCellElement>('[data-merge-ref="B90"]')!;
      await vi.waitFor(() => expect(merge().style.borderTopWidth).toBe('0px'));
      expect(merge().style.backgroundColor).toBe('rgb(253, 230, 138)');
      expect(merge().style.borderLeftWidth).toBe('0px');
      expect(merge().querySelector<HTMLElement>('.xlsxv-merged-content')!.style.justifyContent).toBe('center');
      grid.scrollLeft = 12 * 7 * 64; grid.scrollTop = 26 * 2000; grid.dispatchEvent(new Event('scroll'));
      const last = () => view.table.querySelector<HTMLTableCellElement>('tr[aria-rowindex="2001"] td[aria-colindex="65"]')!;
      await vi.waitFor(() => expect(last().textContent).toBe('15'));
      expect(last().style.backgroundColor).toBe('rgb(140, 178, 217)');
      expect(view.table.querySelectorAll('.xlsxv-cell').length).toBeLessThanOrEqual(2000);
    } finally { view.destroy(); }
  });
});
