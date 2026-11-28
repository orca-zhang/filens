import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadXlsxWorkbook } from '../src/parser';
import { createSheetTable, SheetRowWindow } from '../src/table';
import { clonePreviewWorkbook } from '../src/workbook-cache';
import { createDiagonalBorderWorkbook, createMergeBorderWorkbook, createStyledWorkbookFixture } from './fixtures/styled-workbook.mjs';
import { createShrinkTextWorkbook } from './fixtures/shrink-text-workbook.mjs';
import { createRotatedJustificationWorkbook, createRotatedWorkbook, createTrailingRotatedOverflowWorkbook } from './fixtures/rotated-workbook.mjs';
import { createCenterAcrossWorkbook } from './fixtures/center-across-workbook.mjs';
import { createPathGradientWorkbook } from './fixtures/path-gradient-workbook.mjs';
import { createHorizontalJustificationWorkbook } from './fixtures/horizontal-justification-workbook.mjs';
import { createVerticalJustificationWorkbook } from './fixtures/vertical-justification-workbook.mjs';
import { createReadingOrderWorkbook } from './fixtures/reading-order-workbook.mjs';

beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null); });
afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

describe('XLSX cell appearance', () => {
  it('retains valid direct and inherited reading order through the workbook cache', async () => {
    const { sheets: [sheet] } = clonePreviewWorkbook(await loadXlsxWorkbook(await createReadingOrderWorkbook()));
    expect(sheet.cellStyles!.formats.slice(0, 6).map(style => style.readingOrder)).toEqual([undefined, 0, 1, 2, 2, undefined]);
  });
  it('keeps vertical-writing alignment and its last-line flag through the workbook cache', async () => {
    const { sheets: [sheet] } = clonePreviewWorkbook(await loadXlsxWorkbook(await createRotatedJustificationWorkbook()));
    const styles = sheet.cellStyles!.formats;
    expect(styles[1]).toMatchObject({ textRotation: 90, verticalSpacing: 'distributed', wrap: true });
    expect(styles[2]).toMatchObject({ textRotation: -90, verticalSpacing: 'distributed', wrap: true });
    expect(styles[6]).toMatchObject({ textRotation: 255, verticalSpacing: 'justify', justifyLastLine: true, wrap: true });
    expect(createSheetTable(sheet, 4).querySelector('.xlsxv-vertical-lines')?.textContent).toBe('Alpha beta');
  });
  it('retains vertical justification and inherited distributed alignment in the cached model', async () => {
    const { sheets: [sheet] } = clonePreviewWorkbook(await loadXlsxWorkbook(await createVerticalJustificationWorkbook()));
    expect(sheet.cellStyles!.formats[1]).toMatchObject({ verticalSpacing: 'justify', wrap: true });
    expect(sheet.cellStyles!.formats[2]).toMatchObject({ verticalSpacing: 'distributed', wrap: true });
    expect(sheet.cellStyles!.formats[3]).toMatchObject({ verticalSpacing: 'distributed', horizontal: 'distributed', wrap: true });
    expect(sheet.cellStyles!.variableHeight).toBe(true);
    const table = createSheetTable(sheet, 6);
    expect(table.querySelector('.xlsxv-vertical-lines')?.textContent).toBe('First\nSecond\nThird');
  });
  it('retains horizontal justification and distributed wrapping in inherited and direct styles', async () => {
    const { sheets: [sheet] } = clonePreviewWorkbook(await loadXlsxWorkbook(await createHorizontalJustificationWorkbook()));
    const styles = sheet.cellStyles!.formats;
    expect(styles[1]).toMatchObject({ horizontal: 'distributed', wrap: true });
    expect(styles[2]).toMatchObject({ horizontal: 'justify', wrap: true });
    expect(styles[3]).toMatchObject({ horizontal: 'distributed', wrap: true, indent: 2 });
    expect(styles[4]).toMatchObject({ horizontal: 'justify', wrap: true, justifyLastLine: true });
    expect(styles[5]).toMatchObject({ horizontal: 'distributed', wrap: true });
    expect(sheet.cellStyles!.variableHeight).toBe(true);
    const table = createSheetTable(sheet, 4);
    const first = table.querySelector<HTMLTableCellElement>('tr[aria-rowindex="2"] td[aria-colindex="2"]')!;
    expect(first.style.textAlign).toBe('justify');
    expect(first.style.textAlignLast).toBe('justify');
    expect(table.querySelector<HTMLTableCellElement>('tr[aria-rowindex="4"] td[aria-colindex="2"]')!.style.textAlign).toBe('center');
  });
  it('keeps rectangular gradient bounds in static, differential and inline extension fills', async () => {
    const { sheets: [sheet] } = clonePreviewWorkbook(await loadXlsxWorkbook(await createPathGradientWorkbook()));
    const frame = sheet.cellStyles!.formats[1].fill;
    expect(frame?.pathRectangle).toEqual({ left: .2, right: .7, top: .25, bottom: .75 });
    expect(sheet.cellStyles!.formats[2].fill?.pathRectangle).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
    expect(sheet.conditionalRules?.map(rule => rule.style?.fill)).toEqual([
      expect.objectContaining({ pathRectangle: { left: .3, right: .65, top: .28, bottom: .68 }, stops: [
        { position: 0, color: '#FDE467' }, { position: .4, color: '#02AF89' }, { position: .6, color: '#02AF89' },
        { position: 1, color: '#4F81BD' }
      ] }), frame
    ]);
  });

  it('preserves center across alignment and typed blanks on both XML paths', async () => {
    const workbook = await loadXlsxWorkbook(await createCenterAcrossWorkbook({ numericOnly: true }));
    expect(await loadXlsxWorkbook(await createCenterAcrossWorkbook({ numericOnly: true, forceGeneral: true }))).toEqual(workbook);
    const { sheets: [sheet] } = clonePreviewWorkbook(workbook);
    expect(sheet.cellStyles!.formats[1]).toMatchObject({ horizontal: 'center', centerAcross: true, vertical: 'middle' });
    expect(sheet.rows[0].cells[1]).toMatchObject({ ref: 'B1', valueType: 'text', missingValue: true });
    const table = createSheetTable(sheet, 1);
    expect(table.querySelector('.xlsxv-center-across')?.textContent).toBe('42');
    expect([...table.tBodies[0].rows[0].cells].map(cell => cell.colSpan)).toEqual([1, 1, 1, 1]);
    expect(table.querySelector('td[aria-colindex="5"]')?.textContent).toBe('');
  });

  it('retains hidden and sized trailing columns without extending parsed cell dimensions', async () => {
    const { sheets } = await loadXlsxWorkbook(await createTrailingRotatedOverflowWorkbook());
    expect(sheets.map(sheet => sheet.columnCount)).toEqual([1, 1, 1, 1]);
    expect(sheets[0].hiddenColumns).toEqual([{ first: 2, last: 2 }]);
    expect(sheets[0].columnWidthSource?.ranges).toContainEqual({ firstColumn: 3, lastColumn: 3, width: 24 });
    expect(sheets[0].columnWidths).toHaveLength(1);
  });

  it('retains signed angles, stacking and style inheritance through worksheet readers and the workbook cache', async () => {
    const workbook = await loadXlsxWorkbook(await createRotatedWorkbook());
    expect(await loadXlsxWorkbook(await createRotatedWorkbook({ forceGeneral: true }))).toEqual(workbook);
    const { sheets: [sheet] } = clonePreviewWorkbook(workbook);
    expect(sheet.cellStyles!.formats.map(style => style.textRotation)).toEqual([
      undefined, -45, 45, -90, 90, 255, undefined, -45, -90, -30, undefined, 60
    ]);
    expect(sheet.cellStyles?.variableHeight).toBe(true);
  });

  it('uses terminal borders and retains consecutive continuation styles on the source perimeter', async () => {
    const { sheets: [sheet] } = await loadXlsxWorkbook(await createMergeBorderWorkbook({ includeTail: false }));
    const table = createSheetTable(sheet, 8);
    const merge = (ref: string) => table.querySelector<HTMLTableCellElement>(`[data-merge-ref="${ref}"]`)!;
    const uniform = merge('A1');
    expect(uniform.style.borderBottomStyle).toBe('double');
    expect(uniform.style.borderRightColor).toBe('rgb(18, 126, 34)');
    expect(uniform.querySelectorAll('.xlsxv-merge-border-segment')).toHaveLength(0);
    const conditional = merge('E1');
    expect(conditional.style.borderBottomWidth).toBe('0px');
    expect(conditional.style.borderRightColor).toBe('rgb(129, 57, 187)');
    const segmented = Array.from(merge('A5').querySelectorAll<HTMLElement>('.xlsxv-merge-border-segment'));
    expect(segmented.filter(segment => segment.style.borderTopColor === 'rgb(24, 71, 199)')).toHaveLength(2);
    expect(segmented.filter(segment => segment.style.borderLeftColor === 'rgb(18, 126, 34)')).toHaveLength(2);
    expect(segmented.some(segment => segment.style.borderTopColor === 'rgb(231, 139, 18)')).toBe(false);
    expect(merge('A5').textContent).toBe('Segmented');
  });

  it('retains source diagonal directions and applies differential overrides to the rendered cell', async () => {
    const { sheets: [sheet] } = clonePreviewWorkbook(await loadXlsxWorkbook(await createDiagonalBorderWorkbook()));
    const styles = sheet.cellStyles!.formats;
    expect(styles[1].diagonal).toEqual({ up: false, down: true, line: { width: 3, color: '#B91C1C' } });
    expect(styles[2].diagonal).toEqual({ up: true, down: false, line: { width: 3, color: '#4F81BD', compound: 'double' } });
    expect(styles[3].diagonal?.line).toMatchObject({ width: 2, dash: 'dash' });
    expect(styles[4].diagonal).toBeUndefined();
    expect(styles[5].diagonal).toEqual(styles[1].diagonal);
    const table = createSheetTable(sheet, 2);
    const at = (row: number, col: number) => table.querySelector<HTMLTableCellElement>(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${col + 1}"]`)!;
    expect(at(1, 1).textContent).toBe('Label');
    expect(at(1, 1).querySelector('.xlsxv-diagonal-clip')?.getAttribute('aria-hidden')).toBe('true');
    expect(at(1, 1).style.borderRightWidth).toBe('1px');
    expect(at(1, 3).querySelectorAll('.xlsxv-diagonal-source > span')).toHaveLength(2);
    expect(at(1, 4).querySelector('.xlsxv-diagonal-source')).toBeNull();
    expect(at(2, 2).querySelector<HTMLElement>('.xlsxv-diagonal-source > .is-up')?.style.borderTopStyle).toBe('dashed');
    expect(at(2, 2).querySelector('.xlsxv-diagonal-source > .is-down')).toBeNull();
    expect(at(2, 3).querySelector('.xlsxv-diagonal-source')).toBeNull();
  });

  it('retains shrink-to-fit on direct and inherited alignment in loaded and cached workbooks', async () => {
    const workbook = await loadXlsxWorkbook(await createShrinkTextWorkbook());
    expect(await loadXlsxWorkbook(await createShrinkTextWorkbook(true))).toEqual(workbook);
    const [sheet, , stored] = clonePreviewWorkbook(workbook).sheets;
    const formats = sheet.cellStyles!.formats;
    expect(formats[1]).toMatchObject({ horizontal: 'right', shrinkToFit: true });
    expect(formats[2]).toMatchObject({ indent: 1, shrinkToFit: true });
    expect(formats[4]).toMatchObject({ wrap: true, shrinkToFit: true });
    expect(formats[5]).toMatchObject({ horizontal: 'center', shrinkToFit: true });
    expect(formats[6].shrinkToFit).toBeUndefined();
    expect(stored.rows[0].cells.map(cell => cell.styleIndex)).toEqual([5, 3]);
  });

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
