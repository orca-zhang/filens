import { describe, expect, it, vi } from 'vitest';
import { XMLParser } from 'fast-xml-parser';
import { openZipArchive } from '@filens/core';
import { WorksheetCellIndex } from '../src/cell-index';
import { conditionalFormattingWindow } from '../src/conditional-formatting';
import { loadXlsxWorkbook, readXlsxWorkbook, resolveCellValue } from '../src/parser';
import { createSheetTable } from '../src/table';
import type { ParsedSheet } from '../src/types';
import { clonePreviewWorkbook, loadPreviewWorkbook } from '../src/workbook-cache';
import { createConditionalFormattingWorkbook } from './fixtures/conditional-formatting-workbook.mjs';
import { createRepeatedConditionalWorkbook } from './fixtures/repeated-conditional-workbook.mjs';

const getCell = (sheet: ParsedSheet, row: number, column: number) => sheet.rows.find(entry => entry.index === row)?.cells.find(cell => cell.column === column);

describe('XLSX conditional formatting', () => {
  it.each([false, true])('streams large trailing conditional metadata with prefixed worksheet=%s', async prefixed => {
    const source = await createRepeatedConditionalWorkbook(16_000, { prefixed, linkedBar: true });
    const zipEntries = await openZipArchive(source);
    const part = zipEntries.get('xl/worksheets/s1.xml')!;
    const bytes = Buffer.from(await part.bytes());
    const close = prefixed ? '</main:sheetData>' : '</sheetData>';
    const rowsEnd = bytes.indexOf(close) + close.length;
    expect(bytes.length - rowsEnd).toBeGreaterThan(512 * 1024);
    const onRows = vi.fn();
    part.chunks = async function* () {
      const first = rowsEnd + 20;
      yield bytes.subarray(0, first);
      expect(onRows).toHaveBeenCalledOnce();
      const pending = onRows.mock.calls[0][0] as ParsedSheet;
      expect(pending.rows.at(-1)?.cells[0].value).toBe('9');
      expect(pending.conditionalRules).toBeUndefined();
      for (let offset = first; offset < bytes.length; offset += 32_768) yield bytes.subarray(offset, offset + 32_768);
    };
    const read = vi.spyOn(part, 'bytes').mockRejectedValue(new Error('Unexpected second ZIP entry read'));
    const parse = vi.spyOn(XMLParser.prototype, 'parse');
    let streamed;
    try {
      streamed = await readXlsxWorkbook(source, { descriptor: { source }, zipEntries }, { onRows });
      for (const tag of [prefixed ? 'main:cfRule' : 'cfRule', 'e:cfRule']) {
        const batches = parse.mock.calls.map(([xml]) => String(xml)).filter(xml => xml.includes(`<${tag} `)
          && !xml.includes('<row ') && !xml.includes('<main:row ') && xml.length < 530_000);
        expect(batches.length).toBeGreaterThan(1);
      }
    } finally { parse.mockRestore(); }
    expect(read).not.toHaveBeenCalled();
    const bufferedEntries = new Map(zipEntries);
    const buffered = Buffer.concat([Buffer.from('<!-- parse the original rule groups together -->'), bytes]);
    bufferedEntries.set(part.name, { ...part, bytes: async () => buffered, chunks: undefined });
    const referenceContext = { descriptor: { source }, zipEntries: bufferedEntries };
    const reference = await readXlsxWorkbook(source, referenceContext, {});
    const original = await loadXlsxWorkbook(source, referenceContext);
    expect(streamed).toEqual(reference);
    expect(original.sheets[0].conditionalRules).toHaveLength(16_012);
    expect(streamed.warnings).toEqual([
      'Ignored 1 invalid conditional formatting rules in sheet Repeated Rules.',
      'Skipped 1 unsupported conditional formatting rules in sheet Repeated Rules.'
    ]);
    const [sheet] = streamed.sheets;
    expect(sheet.conditionalRules).toHaveLength(12);
    expect(sheet.conditionalRules?.at(-1)).toMatchObject({
      activeFormula: 'A1>0', condition: { type: 'dataBar', gradient: false, direction: 'rightToLeft' }
    });
    expect(conditionalFormattingWindow(sheet, 1, 4, 1, 4)!(1_048_576, 16_384, sheet.rows.at(-1)?.cells[0]))
      .toMatchObject({ fill: { color: '#FFCDD2' }, numberFormat: '0.0', strike: true });
  });

  it.each([false, true])('folds duplicate base and Office 2010 rules in the preview model (streamed=%s)', async streamed => {
    const duplicates = 2000;
    const source = await createRepeatedConditionalWorkbook(duplicates);
    const entries = new Map(await openZipArchive(source));
    const part = entries.get('xl/worksheets/s1.xml')!;
    const read = vi.fn(part.bytes.bind(part));
    const chunks = async function* () {
      const data = await part.bytes();
      for (let offset = 0; offset < data.length; offset += 32_768) yield data.subarray(offset, offset + 32_768);
    };
    entries.set(part.name, { ...part, bytes: read, chunks: streamed ? chunks : undefined });
    const context = { descriptor: { source }, zipEntries: entries };
    const { sheets: [preview], warnings } = await loadPreviewWorkbook(source, context);
    expect(read).toHaveBeenCalledTimes(streamed ? 0 : 1);
    const { sheets: [original] } = await loadXlsxWorkbook(source, context);
    expect(warnings).toEqual([]);
    expect(original.conditionalRules).toHaveLength(duplicates + 11);
    expect(preview.conditionalRules?.map(rule => rule.priority)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(preview.conditionalRules?.[4].ranges).toBe(preview.conditionalRules?.[5].ranges);
    expect(preview.conditionalRules?.[6].ranges).not.toBe(preview.conditionalRules?.[7].ranges);

    const paint = (sheet: ParsedSheet) => {
      const view = conditionalFormattingWindow(sheet, 1, 6, 1, 6)!;
      return [[1, 1], [1, 2], [2, 1], [3, 1], [1, 4], [4, 4], [1, 6], [1_048_576, 16_384]]
        .map(([row, column]) => view(row, column, getCell(sheet, row, column)));
    };
    const originalPaint = paint(original);
    const get = vi.spyOn(WorksheetCellIndex.prototype, 'get');
    const scan = vi.spyOn(WorksheetCellIndex.prototype, 'forEachInRange');
    try {
      const [first, stopped, negative, average, firstAnchor, secondAnchor, laterStop, final] = paint(preview);
      expect([first, stopped, negative, average, firstAnchor, secondAnchor, laterStop, final]).toEqual(originalPaint);
      expect(first).toMatchObject({ fill: { color: '#FFCDD2' }, italic: true });
      expect(stopped).toEqual({ fill: { type: 'solid', color: '#FFCDD2' }, bold: true });
      expect(negative).toBeUndefined();
      expect(average?.strike).toBe(true);
      expect(firstAnchor?.fill?.color).toBe('#CCDDFF');
      expect(secondAnchor).toEqual(firstAnchor);
      expect(laterStop).toEqual(firstAnchor);
      expect(final).toMatchObject({ fill: { color: '#FFCDD2' }, numberFormat: '0.0', strike: true });
      expect(get.mock.calls.length).toBeLessThan(55);
      expect(scan.mock.calls.length).toBe(2);
    } finally { get.mockRestore(); scan.mockRestore(); }
  });

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
