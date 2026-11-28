import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadXlsxWorkbook } from '../src/parser';
import { createSheetTable, SheetRowWindow } from '../src/table';
import { sheetColumnWidths, xlsxColumnWidths } from '../src/xlsx-column-widths';
import { clonePreviewWorkbook } from '../src/workbook-cache';
import { createXlsxPreviewDriver } from '../src/preview-driver';
import { createColumnWidthWorkbookFixture } from './fixtures/workbook.mjs';

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

async function workbook(metadata: string, { general = false, after = false, cells = '<c r="A1"><v>7</v></c><c r="F1"><v>8</v></c>', merges = '' } = {}) {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="Sized" sheetId="1" r:id="sheet"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="sheet" Target="worksheets/sheet.xml"/></Relationships>');
  zip.file('xl/worksheets/sheet.xml', `<worksheet>${after ? '' : metadata}<sheetData>${general ? '<!-- general -->' : ''}<row r="1">${cells}</row></sheetData>${after ? metadata : ''}${merges}</worksheet>`);
  return loadXlsxWorkbook(await zip.generateAsync({ type: 'uint8array' }));
}

describe('XLSX column dimensions', () => {
  it('uses the ISO 29500 example and distinguishes base and default widths', () => {
    expect(xlsxColumnWidths(3, { baseWidth: 8, fontSize: 11, ranges: [{ firstColumn: 1, lastColumn: 1, width: 8.7109375 }] })).toEqual([61, 61, 61]);
    expect(xlsxColumnWidths(3, { baseWidth: 8, defaultWidth: 12, fontSize: 11, ranges: [] })).toEqual([84, 84, 84]);
    expect(xlsxColumnWidths(3, { baseWidth: 8, fontSize: 11, ranges: [] }, 10)).toEqual([85, 85, 85]);
  });

  it('preserves source widths and the localized Normal style identically on both parsers', async () => {
    const fast = await loadXlsxWorkbook(await createColumnWidthWorkbookFixture());
    const general = await loadXlsxWorkbook(await createColumnWidthWorkbookFixture({ general: true }));
    expect(fast).toEqual(general);
    const sheet = fast.sheets[0];
    expect(sheet.columnWidthSource).toMatchObject({ baseWidth: 8, defaultWidth: 10, fontSize: 12, font: { fontFamily: 'Courier New' } });
    expect(sheet.columnWidthSource!.font).toBe(fast.fonts![1]);
    expect(sheet.columnWidths?.slice(0, 5)).toEqual([28, 196, 61, 84, 70]);
    expect(sheet.columnWidths?.[30]).toBe(1785);
    expect(sheet.columnWidths?.at(-1)).toBe(140);
    expect(sheet.rows).toHaveLength(7);
  });

  it.each([false, true])('keeps first-match overlaps, escaped attributes, defaults and merge endpoints (general: %s)', async general => {
    const result = await workbook('<sheetFormatPr baseColWidth="9" defaultColWidth="10"/><cols><col min="2" max="3" width="20"/>'
      + '<col min="&#51;" max="4" width="30"/><col min="6" max="16384" width="40"/></cols>',
      { general, cells: '<c r="A1"><v>7</v></c>', merges: '<mergeCells><mergeCell ref="B2:F3"/></mergeCells>' });
    expect(result.sheets[0].columnWidths).toEqual([70, 140, 140, 210, 70, 280]);
    expect(result.sheets[0].columnCount).toBe(6);
    expect(result.sheets[0].rows).toHaveLength(1);
    expect(result.warnings).toEqual([]);
  });

  it('reads late metadata through the general path and applies implicit source defaults', async () => {
    const before = await workbook('<cols><col min="2" max="4" width="20"/></cols>');
    const after = await workbook('<cols><col min="2" max="4" width="20"/></cols>', { after: true });
    expect(after).toEqual(before);
    expect(before.sheets[0].columnWidths).toEqual([61, 140, 140, 140, 61, 61]);
    expect((await workbook('<cols><col min="1" max="16384" style="0"/></cols>')).sheets[0].columnWidths).toEqual([61, 61, 61, 61, 61, 61]);
    expect((await workbook('')).sheets[0].columnWidths).toEqual([61, 61, 61, 61, 61, 61]);
  });

  it('decodes numeric XML references once in dimensions and source text', async () => {
    const result = await workbook('<cols><col min="&#x31;" max="2" width="&#49;&#50;"/></cols>',
      { cells: '<c r="A1" t="inlineStr"><is><t>&#x4E2D;&#25991; &amp;#51;</t></is></c><c r="B1"><v>8</v></c>' });
    expect(result.sheets[0].columnWidths).toEqual([84, 84]);
    expect(result.sheets[0].rows[0].cells[0].value).toBe('中文 &#51;');
  });

  it('doubles saved pixel widths in formula view on both worksheet parser paths', async () => {
    const metadata = '<sheetViews><sheetView showFormulas="true"/></sheetViews><cols><col min="2" max="2" width="16" bestFit="1"/></cols>';
    const [fast, general] = await Promise.all([false, true].map(general => workbook(metadata, { general })));
    expect(fast).toEqual(general);
    const sheet = clonePreviewWorkbook(fast).sheets[0];
    expect(sheet.showFormulas).toBe(true);
    expect(sheet.columnWidthSource?.ranges).toEqual([{ firstColumn: 2, lastColumn: 2, width: 16, bestFit: true }]);
    expect(sheet.columnWidths).toEqual([122, 224, 122, 122, 122, 122]);
    expect(sheetColumnWidths(sheet, document)).toEqual(sheet.columnWidths);
  });

  it('bounds malformed declarations and cell dimensions before allocating source tracks', async () => {
    const invalid = [[0, 2, '12'], [2.5, 4, '12'], [4, 2, '12'], [1, 4294967295, '12'], [1, 2, '-3'], [1, 2, 'NaN'], [1, 2, 'Infinity'], [1, 2, '0'], [1, 2, '1e308']];
    const result = await workbook('<sheetFormatPr baseColWidth="8"/><cols>'
      + invalid.map(([min, max, width]) => `<col min="${min}" max="${max}" width="${width}"/>`).join('') + '</cols>',
      { cells: '<c r="XFE1048577"><v>7</v></c>' });
    expect(result.sheets[0].columnCount).toBe(16384);
    expect(result.sheets[0].columnWidths).toHaveLength(16384);
    expect(result.sheets[0].columnWidths?.every(width => width === 61)).toBe(true);
    expect(result.warnings).toEqual(['Ignored 9 invalid or unsupported column width declaration(s) in sheet Sized.']);
  });

  it('falls back on unavailable canvas metrics and remeasures using the mapped Normal font', async () => {
    const result = await loadXlsxWorkbook(await createColumnWidthWorkbookFixture()), sheet = result.sheets[0];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    expect(sheetColumnWidths(sheet, document)).toEqual(sheet.columnWidths);
    const context = { font: '', measureText: vi.fn((text: string) => ({ width: text === '9' ? 10 : 8 })) };
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(context as unknown as CanvasRenderingContext2D);
    sheet.columnWidthSource!.font!.resolvedFontFamily = 'Loaded Spreadsheet Mono';
    const table = createSheetTable(sheet, 3);
    expect(context.font).toContain('16px'); expect(context.font).toContain('Loaded Spreadsheet Mono');
    expect(table.querySelector<HTMLElement>('.xlsxv-col-header')!.style.width).toBe('40px');
    expect(table.querySelector<HTMLElement>('[data-merge-ref="A1"]')!.style.width).toBe('527px');
    expect(table.querySelector<HTMLElement>('[data-merge-ref="A1"] .xlsxv-merged-content')!.style.width).toContain('527px');
    expect(context.measureText).toHaveBeenCalledTimes(10);
  });

  it('remeasures after font readiness while retaining the logical column and bounding work per scroll', async () => {
    const result = await loadXlsxWorkbook(await createColumnWidthWorkbookFixture()), sheet = result.sheets[0];
    let digitWidth = 7;
    const measureText = vi.fn(() => ({ width: digitWidth }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ font: '', measureText } as unknown as CanvasRenderingContext2D);
    const grid = document.body.appendChild(document.createElement('div'));
    Object.defineProperty(grid, 'clientWidth', { value: 800 });
    const view = new SheetRowWindow(sheet, grid);
    try {
      grid.scrollLeft = sheet.columnWidths!.slice(0, 30).reduce((sum, width) => sum + width, 1000);
      grid.scrollTop = 26 * 1000; grid.dispatchEvent(new Event('scroll'));
      await vi.waitFor(() => expect(view.table.querySelector('.xlsxv-col-header[aria-colindex="32"]')).not.toBeNull());
      const before = grid.scrollLeft, top = grid.scrollTop;
      measureText.mockClear(); digitWidth = 10; view.refresh();
      expect(grid.scrollLeft).toBeCloseTo(before * 10 / 7, 0);
      expect(grid.scrollTop).toBe(top);
      expect(view.table.querySelector<HTMLElement>('.xlsxv-col-header[aria-colindex="32"]')!.style.width).toBe('2550px');
      expect(measureText).toHaveBeenCalledTimes(10);
      measureText.mockClear(); grid.scrollLeft += 500; grid.dispatchEvent(new Event('scroll'));
      await new Promise(resolve => requestAnimationFrame(resolve));
      expect(measureText).not.toHaveBeenCalled();
      expect(view.table.querySelectorAll('.xlsxv-col-header')).toHaveLength(20);
    } finally { view.destroy(); }
  });

  it('isolates cached font mappings while preserving Normal font aliases', async () => {
    const parsed = await loadXlsxWorkbook(await createColumnWidthWorkbookFixture());
    const copy = clonePreviewWorkbook(parsed);
    expect(copy.sheets[0].columnWidthSource!.font).toBe(copy.fonts![1]);
    copy.sheets[0].columnWidthSource!.font!.resolvedFontFamily = 'Private mapping';
    expect(parsed.fonts![1].resolvedFontFamily).toBeUndefined();
  });

  it('requests the Normal font for dimensions even when all cells use another font', async () => {
    const zip = await JSZip.loadAsync(await createColumnWidthWorkbookFixture());
    zip.file('xl/worksheets/sheet.xml', (await zip.file('xl/worksheets/sheet.xml')!.async('string')).replaceAll('s="1"', 's="0"'));
    const source = await zip.generateAsync({ type: 'uint8array' });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const host = document.body.appendChild(document.createElement('div')), session = createXlsxPreviewDriver().createSession(host);
    try {
      await session.load(source, { descriptor: { source, extension: 'xlsx' } });
      expect(session.getFontReferences?.().map(font => font.fontFamily)).toEqual(['Arial', 'Courier New']);
    } finally { session.destroy(); }
  });
});
