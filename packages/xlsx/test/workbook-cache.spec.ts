import { webcrypto } from 'node:crypto';
import { Blob as NodeBlob } from 'node:buffer';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { previewModelCache, type PreviewLoadContext } from '@filens/core';
import * as parser from '../src/parser';
import { CsvPreviewData, csvPreviewData } from '../src/csv-preview-data';
import { XlsxPreviewSession } from '../src/preview-driver';
import { readCellScalar } from '../src/cell-value';
import { WorksheetValueCell } from '../src/worksheet-cell';
import { createSheetTable } from '../src/table';
import { loadPreviewWorkbook } from '../src/workbook-cache';
import { createColumnStyledWorkbookFixture, createWorkbookFixture } from './fixtures/workbook.mjs';
import { createRangeWorkbookFixture } from './fixtures/range-workbook.mjs';

const context = (extension = 'xlsx'): PreviewLoadContext => ({ descriptor: { extension, name: `same.${extension}` } });
beforeEach(() => {
  previewModelCache.clear();
  vi.stubGlobal('crypto', webcrypto);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => { previewModelCache.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('workbook preview reuse', () => {
  it.each([
    { activeTab: '1', expected: 'Second' },
    { activeTab: '1', hidden: 'Second', expected: 'First' },
    { activeTab: '0', hidden: 'First', expected: 'Second' },
    { activeTab: '42', expected: 'First' },
    { activeTab: '1', missing: true, expected: 'Second' }
  ])('opens the saved worksheet in source order after a cache hit (%j)', async ({ activeTab, hidden, missing, expected }) => {
    const zip = await JSZip.loadAsync(await createWorkbookFixture());
    const path = 'xl/workbook.xml';
    let xml = (await zip.file(path)!.async('string')).replace('<sheets>',
      `<bookViews><workbookView activeTab="${activeTab}"/></bookViews><sheets>`);
    if (hidden) xml = xml.replace(`<sheet name="${hidden}"`, `<sheet name="${hidden}" state="veryHidden"`);
    if (missing) zip.remove('xl/worksheets/sheet1.xml');
    zip.file(path, xml);
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const names = missing ? ['Second'] : ['First', 'Second'];
    const parse = vi.spyOn(parser, 'readXlsxWorkbook');
    const host = document.createElement('div');
    const session = new XlsxPreviewSession(host);
    try {
      for (let pass = 0; pass < 2; pass++) {
        await session.load(bytes, context());
        expect(session.getState().sheets.map(sheet => sheet.name)).toEqual(names);
        expect(session.getState().activeSheetIndex).toBe(names.indexOf(expected));
        expect(host.querySelector('.xlsxv-sheet-tab.is-active')?.textContent).toBe(expected);
        expect(host.querySelector('.xlsxv-grid')?.textContent).toContain(`${expected} 1`);
        if (names.length > 1) session.goToPage(1 - names.indexOf(expected));
      }
      expect(parse).toHaveBeenCalledOnce();
    } finally { session.destroy(); }
  });

  it.each([false, true])('reuses parsing while isolating cells, formulas and font aliases (general XML: %s)', async general => {
    const bytes = await createColumnStyledWorkbookFixture(11, 8, { general });
    const { sheets: [publicSheet] } = await parser.loadXlsxWorkbook(bytes, context());
    const parse = vi.spyOn(parser, 'readXlsxWorkbook');
    const first = await loadPreviewWorkbook(bytes, context()), expected = structuredClone(first);
    first.sheets[0].rows[0].cells[0].value = 'tab 1'; first.fonts![0].resolvedFontFamily = 'tab font';
    const second = await loadPreviewWorkbook(bytes, context());
    expect(second).toEqual(expected); expect(parse).toHaveBeenCalledOnce();
    expect(second.fonts![0]).not.toBe(first.fonts![0]);
    const [sheet] = second.sheets;
    expect(sheet.cellStyles!.formats.map(style => style.font)).toEqual(second.fonts);
    expect(sheet.cellStyles!.formats[0].font).toBe(second.fonts![0]);
    expect(sheet.rows.every(row => row.cells.every(cell => !Object.hasOwn(cell, 'font')))).toBe(true);
    expect(publicSheet.rows[0].cells.map(cell => cell.font?.fontFamily)).toEqual([
      'Arial', 'Courier New', 'Times New Roman', 'Arial', 'Courier New', 'Times New Roman', 'Arial', 'Arial'
    ]);
    expect(createSheetTable(sheet).outerHTML).toBe(createSheetTable(publicSheet).outerHTML);
    const formulas = await createWorkbookFixture(), one = await loadPreviewWorkbook(formulas, context());
    const formula = one.sheets[0].rows[0].cells.find(cell => cell.formula)!;
    formula.value = 'calculated'; formula.needsCalculation = false;
    const two = await loadPreviewWorkbook(formulas, context());
    expect(two.sheets[0].rows[0].cells.find(cell => cell.formula)).toMatchObject({ value: '', needsCalculation: true });
  });
  it('invalidates by content even for identical filenames and preserves borrowed input', async () => {
    const source = await createWorkbookFixture(), saved = source.slice();
    const task = loadPreviewWorkbook(source, context()); source.fill(0); const first = await task;
    expect(first.sheets[0].name).toBe('First');
    const zip = await JSZip.loadAsync(saved); zip.file('xl/workbook.xml', (await zip.file('xl/workbook.xml')!.async('string')).replace('First', 'Changed'));
    const next = await loadPreviewWorkbook(await zip.generateAsync({ type: 'uint8array' }), context());
    expect(next.sheets[0].name).toBe('Changed');
  });
  it('bypasses protected and CSV input and refuses a pre-aborted cache hit', async () => {
    const bytes = await createWorkbookFixture(); await loadPreviewWorkbook(bytes, context());
    const parse = vi.spyOn(parser, 'readXlsxWorkbook');
    await loadPreviewWorkbook(bytes, { descriptor: { extension: 'xlsx', password: 'secret' } });
    expect(parse).toHaveBeenCalledOnce();
    await loadPreviewWorkbook(bytes, { descriptor: { source: bytes, extension: 'xlsx', sensitive: true } });
    expect(parse).toHaveBeenCalledTimes(2);
    await loadPreviewWorkbook(new TextEncoder().encode('a,b'), context('.CSV')); expect(previewModelCache.size).toBe(1);
    const controller = new AbortController(); controller.abort();
    await expect(loadPreviewWorkbook(bytes, { ...context(), signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('renders compact CSV preview records with the same values as the public workbook', async () => {
    const bytes = new TextEncoder().encode('\uFEFF"甲\r\n乙","say ""hi""",\r\n\r\n,,7\r\nlast');
    const format = context('csv');
    const { sheets: [preview] } = await loadPreviewWorkbook(bytes, format, { csvRows: vi.fn(), worksheet: vi.fn() });
    const { sheets: [workbook] } = await parser.loadCsvWorkbook(bytes, format);
    expect(preview).toMatchObject({ rowCount: 4, columnCount: 3, rows: [] });
    const data = csvPreviewData.get(preview)!;
    expect(data.rowOffsets).toEqual([0, 3, 4, 7, 8]);
    expect(Array.from({ length: 8 }, (_, index) => data.valueAt(index)))
      .toEqual(['甲\r\n乙', 'say "hi"', '', '', '', '', '7', 'last']);
    expect(csvPreviewData.has(workbook)).toBe(false);
    expect(workbook.rows.at(-1)?.cells).toEqual([{ ref: 'A4', row: 4, column: 1, value: 'last' }]);
    expect(createSheetTable(preview).outerHTML).toBe(createSheetTable(workbook).outerHTML);
    expect(previewModelCache.size).toBe(0);
  });

  it('reads compact CSV records across field and text block boundaries during loading', () => {
    const data = new CsvPreviewData();
    const fields = Array.from({ length: 4097 }, (_, index) => `Field ${index}`);
    fields[4095] = '';
    fields[4096] = ' 甲😀 ';
    const wideField = '甲\r\n😀'.repeat(60_000);
    const tail = ['', wideField, '"last"', ''];
    data.appendRow(fields);
    expect(data.valueAt(4095)).toBe('');
    expect(data.valueAt(4096)).toBe(' 甲😀 ');
    data.appendRow(tail);
    expect(data.rowOffsets).toEqual([0, fields.length, fields.length + tail.length]);
    const expected = fields.concat(tail);
    const read = () => expected.map((_, index) => data.valueAt(index));
    expect(read()).toEqual(expected);
    data.finishBlock();
    expect(read()).toEqual(expected);
  });

  it('preserves cell addresses, merge anchors and cross-sheet formulas in compact XLSX previews and cache copies', async () => {
    const zip = new JSZip();
    zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="Simple" sheetId="1" r:id="simple"/>' +
      '<sheet name="General" sheetId="2" r:id="general"/></sheets></workbook>');
    zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="simple" Target="worksheets/simple.xml"/>' +
      '<Relationship Id="general" Target="worksheets/general.xml"/></Relationships>');
    zip.file('xl/worksheets/simple.xml', '<worksheet><cols><col min="4" max="16383" hidden="1"/></cols>' +
      '<sheetData><row r="1"><c r="A1"><v>5</v></c>' +
      '<c r="b1"><v>6</v></c></row><row r="1048576"><c r="XFD1048576"><v>8</v></c></row></sheetData>' +
      '<mergeCells><mergeCell ref="A1:A2"/><mergeCell ref="B1:C1"/></mergeCells></worksheet>');
    zip.file('xl/worksheets/general.xml', '<worksheet><sheetData><row r="1"><c r="A1">' +
      '<f>Simple!A1+Simple!B1+Simple!XFD1048576</f></c><c r="B1" t="inlineStr"><is><t>label</t></is></c>' +
      '<c r="C01"><v>9</v></c></row></sheetData></worksheet>');
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const publicWorkbook = await parser.loadXlsxWorkbook(bytes, context());
    const parse = vi.spyOn(parser, 'readXlsxWorkbook');
    const first = await loadPreviewWorkbook(bytes, context());
    const second = await loadPreviewWorkbook(bytes, context());
    expect(parse).toHaveBeenCalledOnce();
    expect(second.sheets[0].rows[0].cells[0]).not.toBe(first.sheets[0].rows[0].cells[0]);
    const expected = [['A1', 'b1', 'XFD1048576'], ['A1', 'B1', 'C01']];
    for (const workbook of [publicWorkbook, first, second]) {
      expect(workbook.sheets.map(sheet => sheet.rows.flatMap(row => row.cells.map(cell => cell.ref)))).toEqual(expected);
      for (const index of [0, 1]) {
        expect(createSheetTable(workbook.sheets[index], 2).outerHTML)
          .toBe(createSheetTable(publicWorkbook.sheets[index], 2).outerHTML);
      }
      expect(parser.resolveCellValue(workbook.sheets[1], workbook.sheets[1].rows[0].cells[0])).toBe('19');
    }
    const ownRefs = (sheet: ParsedSheet) => sheet.rows.flatMap(row => row.cells.map(cell => Object.keys(cell).includes('ref')));
    expect(ownRefs(publicWorkbook.sheets[0])).toEqual([true, true, true]);
    expect(ownRefs(second.sheets[0])).toEqual([false, true, false]);
    expect(ownRefs(second.sheets[1])).toEqual([true, false, true]);
  });

  it('keeps integer text, numeric-looking strings and formula values equivalent across both worksheet readers', async () => {
    const raw = ['0', '-1073741824', '1073741823', '1073741824', '-1073741825', '000123', '-0', ' 17 ', '1e3', '17.0', '1.25', '+123'];
    const zip = await JSZip.loadAsync(await createWorkbookFixture());
    const rows = raw.map((value, index) => `<row r="${index + 1}"><c r="A${index + 1}"><v>${value}</v></c></row>`).join('');
    const xml = '<worksheet><sheetData>' + rows + '<row r="13"><c r="A13" t="s"><v>0</v></c></row></sheetData></worksheet>';
    zip.file('xl/sharedStrings.xml', '<sst><si><t>42</t></si></sst>');
    zip.file('xl/worksheets/sheet1.xml', xml);
    zip.file('xl/worksheets/sheet2.xml', xml.replace('<sheetData>', '<sheetData><!-- general reader -->'));
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const workbook = await parser.loadXlsxWorkbook(bytes, context());
    const preview = await loadPreviewWorkbook(bytes, context());
    const cached = await loadPreviewWorkbook(bytes, context());

    for (const model of [workbook, preview, cached]) for (const sheet of model.sheets) {
      const cells = sheet.rows.flatMap(row => row.cells);
      expect(cells.map(cell => cell.value)).toEqual([...raw, '42']);
      expect(cells.map(cell => readCellScalar(sheet, cell))).toEqual([...raw.map(Number), '42']);
    }
    for (const model of [preview, cached]) for (const sheet of model.sheets) {
      const cells = sheet.rows.flatMap(row => row.cells) as WorksheetValueCell[];
      expect(cells.map(cell => cell.numericValue)).toEqual([0, -1073741824, 1073741823, ...Array(10).fill(undefined)]);
    }
    preview.sheets[0].rows[0].cells[0].value = '0005';
    expect(readCellScalar(preview.sheets[0], preview.sheets[0].rows[0].cells[0])).toBe(5);
    expect(cached.sheets[0].rows[0].cells[0].value).toBe('0');
  });

  it('parses a large local XLSX directly from slices without hashing its archive', async () => {
    vi.stubGlobal('Blob', NodeBlob);
    const bytes = await createRangeWorkbookFixture();
    const source = new NodeBlob([new Uint8Array(bytes)]) as unknown as Blob;
    const readWhole = vi.spyOn(source, 'arrayBuffer'), slice = vi.spyOn(source, 'slice');
    const workbook = await loadPreviewWorkbook(source, context());
    expect(workbook.sheets[1].rows[0].cells[0].value).toBe('Second 1');
    expect(readWhole).not.toHaveBeenCalled();
    expect(slice.mock.results.reduce((sum, result) => sum + result.value.size, 0)).toBeLessThan(bytes.length / 8);
    expect(previewModelCache.size).toBe(0);
  });
});
