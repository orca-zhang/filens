import { openZipArchive } from '@filens/core';
import { XMLParser } from 'fast-xml-parser';
import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as formulaRegex from '../src/formula-regex';
import { displaySpillCell } from '../src/cell-value';
import { loadXlsxWorkbook, readXlsxWorkbook, resolveCellValue } from '../src/parser';
import { createImplicitCoordinateWorkbook, createWorksheetBatchWorkbook, prefixXmlElements } from './fixtures/worksheet-batches.mjs';
import { createColumnStyledWorkbookFixture } from './fixtures/workbook.mjs';

const chunkStart = '<worksheet><sheetData>';
const inlineBatchStart = '<inlineCells>';
afterEach(() => vi.restoreAllMocks());

describe('large worksheet XML parsing', () => {
  it.each([
    { large: false }, { large: true }, { large: true, mixed: true }, { large: true, prefixed: true }
  ])('infers XLSX row and cell positions in source order (%o)', async settings => {
    const source = await createImplicitCoordinateWorkbook(settings);
    const entries = await openZipArchive(source), entry = entries.get('xl/worksheets/data.xml')!;
    if (!settings.large) entry.chunks = undefined;
    const read = vi.spyOn(entry, 'bytes');
    const workbook = await loadXlsxWorkbook(source, { descriptor: { source }, zipEntries: entries });
    expect(read).toHaveBeenCalledTimes(settings.large ? 0 : 1);
    const [data, summary] = workbook.sheets;
    expect(data.rows[0].cells.map(cell => [cell.ref, cell.value])).toEqual([
      ['A1', '2'], ['B1', ''], ['C1', '6'], ['E1', '3'], ['F1', 'Heading']
    ]);
    expect(data.hiddenRows).toEqual([{ first: 9, last: 9 }]);
    expect(data.rowHeightSource?.rows.get(10)).toEqual({ height: 32, fixed: true });
    expect(data.rows.at(-1)!.cells.at(-1)).toMatchObject({ ref: 'XFD1048576', row: 1048576, column: 16384, value: '22' });
    if (settings.large) expect(data.rows.at(-3)).toMatchObject({ index: 14010, cells: [{ ref: 'A14010' }, { ref: 'B14010' }] });
    expect(workbook).toEqual(await loadXlsxWorkbook(await createImplicitCoordinateWorkbook({ ...settings, omit: false })));
    expect(summary.rows.map(row => [row.index, resolveCellValue(summary, row.cells.at(-1)!)]))
      .toEqual([[1, '59'], [4, '9'], [5, '12']]);
  });

  it.each([false, true])('does not infer coordinates outside the Excel grid (general: %s)', async general => {
    const zip = await JSZip.loadAsync(await createImplicitCoordinateWorkbook());
    const path = 'xl/worksheets/data.xml';
    const source = (await zip.file(path)!.async('string')).replace('</row></sheetData>',
      '<c><v>998</v></c></row><row><c><v>999</v></c></row></sheetData>');
    zip.file(path, general ? prefixXmlElements(source) : source);
    const [sheet] = (await loadXlsxWorkbook(await zip.generateAsync({ type: 'uint8array' }))).sheets;
    expect([sheet.rowCount, sheet.columnCount]).toEqual([1048576, 16384]);
    expect(sheet.rows.at(-1)?.cells.map(cell => [cell.ref, cell.value])).toEqual([['XFC1048576', '20'], ['XFD1048576', '22']]);
  });

  it.each([false, true])('keeps independent cell arrays when stored row widths change (general: %s)', async general => {
    const zip = await JSZip.loadAsync(await createColumnStyledWorkbookFixture(1, 4, { general }));
    const path = 'xl/worksheets/sheet.xml';
    const xml = await zip.file(path)!.async('string');
    zip.file(path, xml.replace('</sheetData>', '<row r="2"><c r="D2"><v>20</v></c></row><row r="3"/>'
      + '<row r="4"><c r="B4" t="s"><v>0</v></c><c r="D4"><v>40</v></c></row></sheetData>'));
    const [sheet] = (await loadXlsxWorkbook(await zip.generateAsync({ type: 'uint8array' }))).sheets;
    const cells = sheet.rows.map(row => row.cells);
    expect(cells.map(row => row.map(cell => [cell.ref, cell.value]))).toEqual([
      [['A1', '4'], ['B1', 'Names & notes'], ['C1', '6'], ['D1', '7']],
      [['D2', '20']], [], [['B4', 'Shared 中文'], ['D4', '40']]
    ]);
    expect(new Set(cells).size).toBe(4);
  });

  it('reads standard references directly and preserves other named entities through the general parser', async () => {
    const path = 'xl/worksheets/sheet.xml';
    const zip = await JSZip.loadAsync(await createColumnStyledWorkbookFixture(9500, 4));
    const xml = await zip.file(path)!.async('string');
    const text = ' 跨块\ntext with 😀 and >\t ';
    const encoded = ' &amp;lt;&lt;&gt;&quot;&apos;&#x26;amp;&#13;&#10;&#9; &#95;x0041_ _x005F_x0041_ &#x1F603; ';
    zip.file(path, xml.replace(/<c r="C(\d+)"><v>\d+<\/v><\/c>/g, (_, row) => {
      const value = row === '2' ? '' : row === '4' ? encoded : row === '4500' ? 'Named&nbsp;entity' : text;
      return `<c r="C${row}" t="inlineStr"><is><t xml:space='preserve'>${value}</t></is></c>`;
    }));
    const source = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    const zipEntries = await openZipArchive(source), entry = zipEntries.get(path)!;
    const read = vi.spyOn(entry, 'bytes'), parse = vi.spyOn(XMLParser.prototype, 'parse');
    const workbook = await loadXlsxWorkbook(source, { descriptor: { source }, zipEntries });
    expect(read).not.toHaveBeenCalled();
    const parsedRows = parse.mock.calls.flatMap(([xml]) => typeof xml === 'string' && xml.includes('<row r=') ? [xml] : []);
    expect(parsedRows).toHaveLength(1);
    expect(parsedRows[0]).toContain('Named&nbsp;entity');
    expect(parsedRows[0]).not.toContain(encoded);
    expect(parsedRows[0]).not.toMatch(/<row r="(?:1|9500)"/);
    entry.chunks = undefined;
    expect(workbook).toEqual(await loadXlsxWorkbook(source, { descriptor: { source }, zipEntries }));
    const [first, second] = workbook.sheets[0].rows;
    expect(first.cells[2]).toMatchObject({ value: text, valueType: 'text', font: { fontFamily: 'Times New Roman' } });
    expect(second.cells[2]).toMatchObject({ value: '', valueType: 'text' });
    expect(second.cells[2].missingValue).toBeUndefined();
    expect(workbook.sheets[0].rows[3].cells[2].value).toBe(' &lt;<>"\'&amp;\r\n\t A _x0041_ 😃 ');
    expect(workbook.sheets[0].rows[4499].cells[2].value).toBe('Named\u00a0entity');
  });

  it.each(['simple', 'inline', 'date'])('preserves empty value and line endings when later rows are %s', async tail => {
    const path = 'xl/worksheets/sheet.xml';
    const zip = await JSZip.loadAsync(await createColumnStyledWorkbookFixture(6000, 4));
    const xml = await zip.file(path)!.async('string');
    const last = tail === 'inline' ? '<c r="C6000" t="inlineStr"><is><t>Late text</t></is>'
      : tail === 'date' ? '<c r="C6000" t="d"><v>2024-02-29</v>' : '<c r="C6000"><v>24002</v>';
    const rows = tail === 'date' ? xml : xml.replace('<c r="A1" s="0"><v>4</v>', '<c r="A1" s="0"><v>4\r\n</v>');
    zip.file(path, rows
      .replace('<c r="B1" t="s"><v>1</v>', '<c r="B1" t="s"><v/>')
      .replace('<c r="D1"><v>7</v>', '<c r="D1" t="b"><v />')
      .replace('<c r="C6000"><v>24002</v>', last));
    const source = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    const { sheets: [sheet] } = await loadXlsxWorkbook(source);
    expect(sheet.rows[0].cells[0].value).toBe(tail === 'simple' ? '4\r\n' : tail === 'inline' ? '4\n' : '4');
    expect(sheet.rows[0].cells[1]).toMatchObject({ value: '', valueType: 'text' });
    expect(sheet.rows[0].cells[1].missingValue).toBe(tail === 'simple' ? true : undefined);
    expect(sheet.rows[0].cells[3]).toMatchObject({ value: 'FALSE', valueType: 'boolean' });
    expect(sheet.rows[0].cells[3].missingValue).toBe(tail === 'simple' ? true : undefined);
    expect(sheet.rows.at(-1)?.cells[2].value).toBe(tail === 'simple' ? '24002' : tail === 'inline' ? 'Late text' : '2024-02-29');
  });

  it('streams literal dates, errors, and empty or escaped text without parsing row objects', async () => {
    const path = 'xl/worksheets/sheet.xml';
    const zip = await JSZip.loadAsync(await createColumnStyledWorkbookFixture(9500, 4));
    const xml = await zip.file(path)!.async('string');
    zip.file(path, xml.replace(/<c r="C(\d+)"><v>\d+<\/v><\/c>/g, (_, row) => {
      const value = row === '1' ? 't="str"><v>_x0041_ &amp; &#x1F603;</v>'
        : row === '2' ? 't="str"><v/>' : 't="d"><v>2024-02-29T14:30:00</v>';
      return `<c r="C${row}" ${value}</c>`;
    }).replace('<c r="D1"><v>7</v></c>', '<c r="D1" t="e"><v>#N/A</v></c>')
      .replace('<c r="D2"><v>11</v></c>', '<c r="D2" t="inlineStr"><is><t xml:space="preserve"/></is></c>')
      .replace('<c r="D3"><v>15</v></c>', '<c r="D3" t="inlineStr"><is/></c>')
      .replace('<c r="D4"><v>19</v></c>', '<c r="D4" t="inlineStr"></c>')
      .replace('<c r="D9500"><v>38003</v></c>', '<c r="D9500" t="str"/>'));
    const source = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    const zipEntries = await openZipArchive(source), entry = zipEntries.get(path)!;
    const read = vi.spyOn(entry, 'bytes'), parse = vi.spyOn(XMLParser.prototype, 'parse');
    const context = { descriptor: { source }, zipEntries };
    const workbook = await loadXlsxWorkbook(source, context);
    expect(read).not.toHaveBeenCalled();
    expect(parse.mock.calls.some(([xml]) => typeof xml === 'string' && xml.includes('<row r='))).toBe(false);
    entry.chunks = undefined;
    expect(workbook).toEqual(await loadXlsxWorkbook(source, context));
    const [sheet] = workbook.sheets;
    expect(sheet.rows[0].cells[2]).toMatchObject({ value: 'A & 😃', valueType: 'text', font: { fontFamily: 'Times New Roman' } });
    expect(sheet.rows[0].cells[3]).toMatchObject({ value: '#N/A', valueType: 'error' });
    expect(sheet.rows[1].cells[2]).toMatchObject({ value: '', valueType: 'text' });
    expect(sheet.rows[1].cells[2].missingValue).toBeUndefined();
    expect(sheet.rows[1].cells[3].missingValue).toBeUndefined();
    expect(sheet.rows[2].cells[3].missingValue).toBeUndefined();
    expect(sheet.rows[3].cells[3]).toMatchObject({ value: '', valueType: 'text', missingValue: true });
    expect(sheet.rows.at(-1)?.cells[2]).toMatchObject({ value: '2024-02-29T14:30:00', valueType: 'date' });
    expect(sheet.rows.at(-1)?.cells[3]).toMatchObject({ value: '', valueType: 'text', missingValue: true });
  });

  it('streams ordinary, shared and array formulas across a batch that requires XML fallback', async () => {
    const path = 'xl/worksheets/rows.xml';
    const zip = await JSZip.loadAsync(await createWorksheetBatchWorkbook(2));
    const first = '<row r="1"><c r="A1"><v>2</v></c><c r="B1"><f t="normal">A1*2</f></c>'
      + '<c r="C1" t="str"><f>IF(A1&lt;3,&quot;_x0041_&quot;,&quot;&quot;)</f><v>_x0042_ &amp; &#x1F603;</v></c>'
      + '<c r="D1" t="b"><f>A1&gt;0</f><v>1</v></c><c r="E1" t="e"><f>1/0</f><v>#DIV/0!</v></c>'
      + '<c r="F1" t="d"><f>DATE(2024,2,29)</f><v>2024-02-29</v></c>'
      + '<c r="G1" t="str"><f>""</f><v/></c><c r="H1" t="b"><f>A1&gt;0</f></c>'
      + '<c r="I1"><f>_xlfn.REGEXTEST("case","c.*")</f></c>'
      + '<c r="J1"><f ref="J1:K1" t="array" aca="1">{5,6}</f></c></row>';
    const rows = Array.from({ length: 12_000 }, (_, offset) => {
      const row = offset + 2;
      let formula = `<f>A${row}+1</f><v>${row + 1}</v>`, extra = '';
      if (row === 2) formula = '<f t="shared" si="4" ref="B2:B12000">A2+1</f><v>3</v>';
      if (row === 3) formula = '<f t="shared" si="4"></f><v>40</v>';
      if (row === 6000) {
        formula = '<f t="shared" si="5" ref="B6000:B6001">A6000+1</f>';
        extra = '<c><f t="array" ref="C6000:D6000">{8,9}</f></c>';
      } else if (row === 6001) {
        formula = '<f t="shared" si="5"/>';
        extra = '<c t="inlineStr"><is><t>Requires general XML&nbsp;</t></is></c>';
      } else if (row === 12000) formula = '<f t="shared" si="4"/>';
      else if (row === 12001) extra = '<c cm="1"><f t="array" ref="C12001:F12001">_xlfn.SEQUENCE(1,4)</f></c>';
      return `<row${row === 12000 ? '' : ` r="${row}"`}><c r="A${row}"><v>${row}</v></c>`
        + `<c${row === 12000 ? ' t="str"' : ` r="B${row}"`}>${formula}</c>${extra}</row>` + ' '.repeat(65);
    });
    const relationships = 'xl/_rels/workbook.xml.rels';
    zip.file(relationships, (await zip.file(relationships)!.async('string')).replace('</Relationships>',
      '<Relationship Id="metadata" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sheetMetadata"'
      + ' Target="metadata.xml"/></Relationships>'));
    zip.file('xl/metadata.xml', '<metadata xmlns:xda="http://schemas.microsoft.com/office/spreadsheetml/2017/dynamicarray">'
      + '<metadataTypes><metadataType name="XLDAPR"/></metadataTypes>'
      + '<futureMetadata name="XLDAPR"><bk><extLst><ext><xda:dynamicArrayProperties fDynamic="1"/></ext></extLst></bk></futureMetadata>'
      + '<cellMetadata><bk><rc t="1" v="0"/></bk></cellMetadata></metadata>');
    zip.file(path, '<worksheet><sheetData>' + first + rows.join('') + '</sheetData></worksheet>');
    const source = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    const zipEntries = await openZipArchive(source), entry = zipEntries.get(path)!;
    const read = vi.spyOn(entry, 'bytes'), parse = vi.spyOn(XMLParser.prototype, 'parse');
    const prepare = vi.spyOn(formulaRegex, 'prepareFormulaRegex').mockResolvedValue(true);
    const context = { descriptor: { source }, zipEntries };
    const workbook = await readXlsxWorkbook(source, context, { onRows: vi.fn() });
    const parsedBatches = parse.mock.calls.flatMap(([xml]) => typeof xml === 'string' && xml.startsWith(chunkStart)
      && xml.includes('<row ') ? [xml] : []);
    expect(read).not.toHaveBeenCalled();
    expect(prepare).toHaveBeenCalledOnce();
    expect(parsedBatches).toHaveLength(1);
    expect(parsedBatches[0]).toContain('Requires general XML');
    expect(parsedBatches[0]).toContain('si="5" ref=');
    expect(parsedBatches[0]).not.toMatch(/r="B(?:2|12000)"|cm="1"/);
    entry.chunks = undefined;
    expect(workbook).toEqual(await readXlsxWorkbook(source, context, {}));
    expect(workbook.warnings).toEqual([]);
    const [sheet] = workbook.sheets;
    const cells = sheet.rows[0].cells;
    expect(cells[2]).toMatchObject({ formula: 'IF(A1<3,"_x0041_","")', value: 'B & 😃', valueType: 'text', needsCalculation: false });
    expect(cells[6]).toMatchObject({ value: '', valueType: 'text', needsCalculation: false });
    expect(resolveCellValue(sheet, cells[1])).toBe('4');
    expect(resolveCellValue(sheet, cells[7])).toBe('TRUE');
    expect(resolveCellValue(sheet, sheet.rows[6000].cells[1])).toBe('6002');
    expect(resolveCellValue(sheet, sheet.rows[2].cells[1])).toBe('40');
    const follower = sheet.rows[11999].cells[1];
    expect(follower).toMatchObject({ ref: 'B12000', sharedFormulaId: 4, value: '', valueType: 'text', missingValue: true, needsCalculation: true });
    expect(resolveCellValue(sheet, follower)).toBe('12001');
    expect(sheet.arrayFormulas).toEqual([
      { firstRow: 1, lastRow: 1, firstColumn: 10, lastColumn: 11 },
      { firstRow: 6000, lastRow: 6000, firstColumn: 3, lastColumn: 4 },
      { firstRow: 12001, lastRow: 12001, firstColumn: 3, lastColumn: 6, dynamic: true }
    ]);
    expect(sheet.columnCount).toBe(11);
    expect(displaySpillCell(sheet, 1, 11)?.value).toBe('6');
    expect(displaySpillCell(sheet, 12001, 6)?.value).toBe('4');
  });

  it('parses only inline rich text through the general XML reader in streamed row batches', async () => {
    const parse = vi.spyOn(XMLParser.prototype, 'parse');
    const source = await createWorksheetBatchWorkbook(6400, { sheetDataAttributes: '', extraInlineRuns: true });
    const zipEntries = await openZipArchive(source);
    const read = vi.spyOn(zipEntries.get('xl/worksheets/rows.xml')!, 'bytes').mockRejectedValue(new Error('Unexpected expanded sheet read'));
    const workbook = await loadXlsxWorkbook(source, { descriptor: { source }, zipEntries });
    const chunks = parse.mock.calls.flatMap(([xml]) => typeof xml === 'string' && xml.startsWith(inlineBatchStart) ? [xml] : []);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toContain('North &amp; 南');
    expect(chunks[0]).toContain('First detail');
    expect(chunks[1]).toContain('Last &amp; 南');
    expect(parse.mock.calls.some(([xml]) => typeof xml === 'string' && /<row\b/.test(xml))).toBe(false);
    expect(read).not.toHaveBeenCalled();
    parse.mockRestore();
    const general = await loadXlsxWorkbook(await createWorksheetBatchWorkbook(6400, { forceGeneral: true, extraInlineRuns: true }));
    expect(workbook).toEqual(general);
    const sheet = workbook.sheets[0];
    expect(sheet.rows[3999].index).toBe(4000);
    expect(sheet.hiddenRows).toEqual([{ first: 17, last: 17 }]);
    expect(sheet.rowHeightSource?.rows.get(17)).toMatchObject({ fixed: true });
    expect(sheet.rows[0].cells[1]).toMatchObject({ value: 'North & 南 branch', richText: { value: 'North & 南 branch' },
      font: { fontFamily: 'Courier New' }, styleIndex: 1 });
    expect(sheet.rows[0].cells[3].richText?.runs[0]).toMatchObject({ text: 'First detail', font: { fontStyle: 'italic' } });
    expect(sheet.rows.at(-1)?.cells[2].richText?.runs[0]).toMatchObject({ text: 'Last & 南', color: '#336699' });
    expect(resolveCellValue(sheet, sheet.rows[0].cells[2])).toBe('4');
    expect(resolveCellValue(sheet, sheet.rows.at(-1)!.cells.at(-1)!)).toBe('6430');
  });

  it.each([false, true])('streams a row larger than the XML batch even when its closing tag splits (prefixed: %s)', async prefixed => {
    const path = 'xl/worksheets/rows.xml';
    const zip = await JSZip.loadAsync(await createWorksheetBatchWorkbook(10));
    const text = '南 North &amp; West '.repeat(1250);
    const cells = Array.from({ length: 40 }, (_, i) => `<c${i ? '' : ' r="CA1"'} t="inlineStr"><is><t>${text}</t></is></c>`).join('');
    let xml = (await zip.file(path)!.async('string')).replace('</row>', cells + '</row \t\n>');
    if (prefixed) xml = prefixXmlElements(xml).replaceAll('main:', 'sheet.ml:').replace('xmlns:main=', 'xmlns:sheet.ml=');
    zip.file(path, xml);
    const source = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    const zipEntries = await openZipArchive(source), entry = zipEntries.get(path)!;
    const raw = Buffer.from(xml), close = prefixed ? '</sheet.ml:row' : '</row';
    const offset = raw.indexOf(close + ' \t\n>');
    expect(offset).toBeGreaterThan(512 * 1024);
    entry.chunks = async function* () {
      let start = 0;
      for (const limit of [offset + 3, offset + close.length + 1, offset + close.length + 3, raw.length]) {
        while (start < limit) {
          const end = Math.min(start + 16_384, limit);
          yield raw.subarray(start, end);
          start = end;
        }
      }
    };
    const read = vi.spyOn(entry, 'bytes');
    const context = { descriptor: { source }, zipEntries };
    const streamed = await loadXlsxWorkbook(source, context);
    expect(read).not.toHaveBeenCalled();
    entry.chunks = undefined;
    expect(streamed).toEqual(await loadXlsxWorkbook(source, context));
    const [sheet] = streamed.sheets;
    expect(sheet.rows[0].cells.at(-1)).toMatchObject({ column: 118, value: '南 North & West '.repeat(1250) });
    expect(resolveCellValue(sheet, sheet.rows.at(-1)!.cells.at(-1)!)).toBe('40');
  });

  it('publishes prefixed rows incrementally and gives the same model when ZIP access is buffered', async () => {
    const canonical = await createWorksheetBatchWorkbook();
    const zip = await JSZip.loadAsync(canonical), path = 'xl/worksheets/rows.xml';
    zip.file(path, prefixXmlElements(await zip.file(path)!.async('string')));
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    const entries = await openZipArchive(bytes), entry = entries.get(path)!;
    const read = vi.spyOn(entry, 'bytes'), parse = vi.spyOn(XMLParser.prototype, 'parse');
    const onRows = vi.fn();
    const context = { descriptor: { source: bytes }, zipEntries: entries };
    const streamed = await readXlsxWorkbook(bytes, context, { onRows });
    expect(read).not.toHaveBeenCalled();
    expect(onRows.mock.calls.length).toBeGreaterThan(1);
    expect(onRows.mock.calls[0][0].rows[0].cells[1].value).toBe('North & 南 branch');
    expect(onRows.mock.calls.at(-1)![0].rowCount).toBeLessThan(1_048_576);
    expect(streamed).toEqual(await readXlsxWorkbook(canonical, undefined, {}));

    entry.chunks = undefined;
    const expected = await loadXlsxWorkbook(canonical);
    parse.mockClear();
    expect(await loadXlsxWorkbook(bytes, context)).toEqual(expected);
    expect(read).toHaveBeenCalledOnce();
    const batches = parse.mock.calls.map(([xml]) => xml)
      .filter((xml): xml is string => typeof xml === 'string' && xml.includes('<main:row'));
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.every(xml => xml.length < 513 * 1024)).toBe(true);
  });

  it.each([false, true])('uses in-scope SpreadsheetML aliases with buffered fallback=%s', async fallback => {
    const zip = await JSZip.loadAsync(await createWorksheetBatchWorkbook(2));
    const path = 'xl/worksheets/rows.xml';
    const namespace = 'http://purl.oclc.org/ooxml/spreadsheetml/main';
    zip.file(path, `<worksheet xmlns="${namespace}" xmlns:s="${namespace}" xmlns:ext="urn:foreign">`
      + `<s:sheetData xmlns:cells="${namespace}">`
      + (fallback ? '<!-- Keep the XML parser’s ordinary buffered path. -->' : '')
      + '<cells:row r="1"><s:c r="A1"><v>2</v><s:v xmlns:s="urn:foreign">999</s:v></s:c></cells:row>'
      + '<ext:row r="88"><s:c r="A88"><s:v>999</s:v></s:c></ext:row>'
      + '<row xmlns="urn:foreign" r="99"><c r="A99"><v>999</v></c></row>'
      + '<row xmlns="" r="100"><c r="A100"><v>999</v></c></row>'
      + `<q:row xmlns:q="${namespace}" r="2"><q:c r="A2"><q:f>A1*2</q:f></q:c></q:row>`
      + '</s:sheetData></worksheet>');
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    const entries = await openZipArchive(bytes);
    const entry = entries.get(path)!;
    const xml = await entry.bytes();
    entry.chunks = async function* () {
      for (let offset = 0; offset < xml.length; offset += 31) yield xml.subarray(offset, offset + 31);
    };
    const read = vi.spyOn(entry, 'bytes');
    const { sheets: [sheet], warnings } = await loadXlsxWorkbook(bytes, { descriptor: { source: bytes }, zipEntries: entries });
    expect(read).toHaveBeenCalledTimes(fallback ? 1 : 0);
    expect(warnings).toEqual([]);
    expect(sheet.rows.map(row => row.index)).toEqual([1, 2]);
    expect(sheet.rows[0].cells[0].value).toBe('2');
    expect(resolveCellValue(sheet, sheet.rows[1].cells[0])).toBe('4');
  });

  it.each([false, true])('streams numeric rows across UTF-8 and tag boundaries, with final formula %s', async formula => {
    const path = 'xl/worksheets/sheet.xml';
    const zip = await JSZip.loadAsync(await createColumnStyledWorkbookFixture(8000, 6));
    const xml = await zip.file(path)!.async('string');
    const longNumbers = [' +0001.1920928955078125E-07\t ', ' 0.' + '0'.repeat(15_000) + '1 '];
    const tail = (formula ? '<row r="1048576"><c r="XFD1048576"><f>A1+A2</f></c></row>' : '')
      + '</sheetData><mergeCells><mergeCell ref="B1:B2"/></mergeCells>'
      + '<conditionalFormatting sqref="B1:B8000"><cfRule type="colorScale" priority="1"><colorScale>'
      + '<cfvo type="min"/><cfvo type="max"/><color rgb="FF0000FF"/><color rgb="FFFF0000"/>'
      + '</colorScale></cfRule></conditionalFormatting></worksheet>';
    zip.file(path, xml.replace('<worksheet>', '<worksheet label="边界">')
      .replace('<c r="C1"><v>8</v></c>', `<c r="C1"><v>${longNumbers[0]}</v></c>`)
      .replace('<c r="C7001"><v>42008</v></c>', `<c r="C7001"><v>${longNumbers[1]}</v></c>`)
      .replace('<row r="7001"', '<row').replace('</sheetData></worksheet>', tail));
    const source = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    const zipEntries = await openZipArchive(source), entry = zipEntries.get(path)!;
    const bytes = Buffer.from(await entry.bytes());
    const read = vi.spyOn(entry, 'bytes').mockRejectedValue(new Error('Unexpected expanded sheet read'));
    entry.chunks = async function* () {
      const cuts = [bytes.indexOf('边界') + 1, bytes.indexOf('<sheetData>') + 5, bytes.indexOf('</sheetData>') + 4, bytes.length];
      let start = 0;
      for (const limit of cuts) while (start < limit) {
        const end = Math.min(start + 16_384, limit);
        yield bytes.subarray(start, end);
        start = end;
      }
    };
    const workbook = await loadXlsxWorkbook(source, { descriptor: { source }, zipEntries });
    expect(read).not.toHaveBeenCalled();
    read.mockRestore();
    entry.chunks = undefined;
    expect(workbook).toEqual(await loadXlsxWorkbook(source, { descriptor: { source }, zipEntries }));
    const sheet = workbook.sheets[0];
    expect([sheet.rows[0].cells[2].value, sheet.rows[7000].cells[2].value]).toEqual(longNumbers);
    expect(sheet.rows[7000].index).toBe(7001);
    expect(sheet.conditionalRules).toHaveLength(1);
    expect(sheet.merges).toEqual([{ firstRow: 1, lastRow: 2, firstColumn: 2, lastColumn: 2 }]);
    if (formula) expect(resolveCellValue(sheet, sheet.rows.at(-1)!.cells[0])).toBe('18');
  });

  it('discards partially read rows and inline fonts on a late fallback', async () => {
    const path = 'xl/worksheets/rows.xml';
    const zip = await JSZip.loadAsync(await createWorksheetBatchWorkbook(6400, { sheetDataAttributes: '' }));
    const xml = (await zip.file(path)!.async('string')).replace('<b/>', '<rFont val="Staged-only font"/>')
      .replace('</is>', '<r><rPr><rFont val="Reused face"/></rPr><t>More</t></r></is>');
    zip.file(path, xml + '<worksheet/>');
    for (const [name, tag, extra] of [
      ['xl/workbook.xml', '</sheets>', '<sheet name="Next" sheetId="2" r:id="next"/>'],
      ['xl/_rels/workbook.xml.rels', '</Relationships>', '<Relationship Id="next" Target="worksheets/next.xml"/>']
    ]) zip.file(name, (await zip.file(name)!.async('string')).replace(tag, extra + tag));
    zip.file('xl/worksheets/next.xml', '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr">'
      + '<is><r><rPr><rFont val="Reused face"/></rPr><t>New</t></r></is></c></row></sheetData></worksheet>');
    const source = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    const zipEntries = await openZipArchive(source);
    const read = vi.spyOn(zipEntries.get(path)!, 'bytes');
    const parse = vi.spyOn(XMLParser.prototype, 'parse');
    const workbook = await loadXlsxWorkbook(source, { descriptor: { source }, zipEntries });
    expect(parse.mock.calls.some(([xml]) => typeof xml === 'string' && xml.startsWith(inlineBatchStart) && xml.includes('Staged-only font'))).toBe(true);
    expect(read).toHaveBeenCalledOnce();
    expect(workbook.sheets[0].rows).toEqual([]);
    expect(workbook.fonts?.map(font => font.fontFamily)).toEqual(['Arial', 'Courier New', 'Reused face']);
    expect(workbook.sheets[1].rows[0].cells[0].richText?.runs[0].font).toBe(workbook.fonts?.[2]);
  });

  it('yields and aborts before parsing a second batch', async () => {
    const bytes = await createWorksheetBatchWorkbook(6400, { sheetDataAttributes: '' });
    const controller = new AbortController();
    const parse = XMLParser.prototype.parse;
    let batches = 0, now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now += 20);
    vi.spyOn(XMLParser.prototype, 'parse').mockImplementation(function (this: XMLParser, xml, options) {
      if (typeof xml === 'string' && xml.startsWith(inlineBatchStart) && ++batches === 1) {
        setTimeout(() => controller.abort(), 0);
      }
      return parse.call(this, xml, options);
    });
    const outcome = await loadXlsxWorkbook(bytes, {
      descriptor: { source: bytes, extension: 'xlsx' }, signal: controller.signal
    }).then(() => undefined, error => error);
    expect(outcome).toMatchObject({ name: 'AbortError' });
    expect(batches).toBe(1);
  });

  it('decodes more than 100,000 standard character references in streamed worksheet batches', async () => {
    const zip = await JSZip.loadAsync(await createWorksheetBatchWorkbook(2));
    const path = 'xl/worksheets/rows.xml';
    const text = '&#20013;&#x1F603;&amp;&lt;'.repeat(1001);
    const rows = Array.from({ length: 26 }, (_, i) =>
      `<row r="${i + 1}"><c r="A${i + 1}" t="inlineStr"><is><t>${text} ${i} &amp;#20013;</t></is></c></row>`).join('');
    zip.file(path, '<worksheet><sheetData>' + rows + '</sheetData></worksheet>');
    const source = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    const zipEntries = await openZipArchive(source), entry = zipEntries.get(path)!;
    const read = vi.spyOn(entry, 'bytes'), parse = vi.spyOn(XMLParser.prototype, 'parse');
    const workbook = await loadXlsxWorkbook(source, { descriptor: { source }, zipEntries });
    expect(read).not.toHaveBeenCalled();
    const batches = parse.mock.calls.map(([xml]) => xml)
      .filter((xml): xml is string => typeof xml === 'string' && xml.startsWith(chunkStart) && xml.includes('<row '));
    expect(batches).toHaveLength(0);
    expect(workbook.sheets[0].rows.map(row => row.cells[0].value)).toEqual(
      Array.from({ length: 26 }, (_, i) => '中😃&<'.repeat(1001) + ` ${i} &#20013;`));
    entry.chunks = undefined;
    expect(await loadXlsxWorkbook(source, { descriptor: { source }, zipEntries })).toEqual(workbook);
  });

  it('enforces the worksheet expansion count for entities declared by the document', async () => {
    const zip = await JSZip.loadAsync(await createWorksheetBatchWorkbook(2));
    const text = '&label;'.repeat(10_001);
    const rows = Array.from({ length: 11 }, (_, i) =>
      `<row r="${i + 1}"><c r="A${i + 1}" t="inlineStr"><is><t>${text}</t></is></c></row>`).join('');
    zip.file('xl/worksheets/rows.xml', '<!DOCTYPE worksheet [<!ENTITY label "x">]>'
      + '<worksheet><sheetData>' + rows + '</sheetData></worksheet>');
    await expect(loadXlsxWorkbook(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })))
      .rejects.toThrow(/entity expansion count limit exceeded/i);
  });
});
