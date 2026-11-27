import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { loadXlsxWorkbook } from '../src/parser';
import { readSimpleRows, readSimpleWorksheet } from '../src/simple-worksheet';
import { createColumnStyledWorkbookFixture } from './fixtures/workbook.mjs';

const options = { id: '1', name: 'Sheet', sharedStrings: ['Shared 中文', 'Names & notes'] };

describe('simple worksheet XML reader', () => {
  it('decodes SpreadsheetML escapes in both parsers and preserves escaped literals', async () => {
    const encoded = 'one_x000D_two_x005F_x0001__xD83E__xDE90_';
    const expected = 'one\rtwo_x0001_🪐';
    const inline = `<c r="A1" t="inlineStr"><is><t>${encoded}</t></is></c>`;
    const saved = `<c r="B1" t="str"><f>""</f><v>${encoded}</v></c>`;
    const rich = `<c r="C1" t="inlineStr"><is><r><rPr><b/></rPr><t>${encoded}</t></r></is></c>`;
    expect(readSimpleRows(`<row r="1">${inline}</row>`, { ...options, allowInline: true })?.rows[0].cells[0].value).toBe(expected);
    const zip = await JSZip.loadAsync(await createColumnStyledWorkbookFixture(1, 1));
    zip.file('xl/worksheets/sheet.xml', `<worksheet><sheetData><row r="1">${inline}${saved}${rich}</row></sheetData></worksheet>`);
    const { sheets: [sheet] } = await loadXlsxWorkbook(await zip.generateAsync({ type: 'uint8array' }));
    expect(sheet.rows[0].cells.map(cell => cell.value)).toEqual([expected, expected, expected]);
    expect(sheet.rows[0].cells[2].richText?.runs[0].text).toBe(expected);
  });

  it.each([' custom="1"', " xmlns:x='urn:extension' x:flag='yes' ", ' custom="" another = "two"'])(
    'preserves models and column styles when sheetData has attributes: %s', async attributes => {
      const bytes = await createColumnStyledWorkbookFixture(24, 8, { sheetDataAttributes: attributes });
      const zip = await JSZip.loadAsync(bytes), file = zip.file('xl/worksheets/sheet.xml')!;
      const xml = await file.async('string');
      const direct = readSimpleWorksheet(xml, options);
      expect(direct?.rows).toHaveLength(24);
      expect(direct?.rows[0].cells[1].value).toBe('Names & notes');
      const fast = await loadXlsxWorkbook(bytes);
      zip.file(file.name, xml.replace(/(<sheetData\b[^>]*>)/, '$1<!-- general XML parser -->'));
      const general = await loadXlsxWorkbook(await zip.generateAsync({ type: 'uint8array' }));
      expect(fast).toEqual(general);
      expect(fast.sheets[0].rows[10].cells[1].font?.fontFamily).toBe('Times New Roman');
    });

  it.each([
    '<sheetData custom="&amp;">', '<sheetData custom="a>b">', '<sheetData custom="a&lt;b">'
  ])('uses XML fallback for attributes requiring general decoding: %s', opening => {
    const xml = `<worksheet>${opening}<row r="1"><c r="A1"><v>2</v></c></row></sheetData></worksheet>`;
    expect(readSimpleWorksheet(xml, options)).toBeUndefined();
  });

  it('resets shared attribute matching after rejected and completed worksheets', () => {
    const document = (attributes: string, value = '2') =>
      `<worksheet><sheetData><row r="1"><c ${attributes}><v>${value}</v></c></row></sheetData></worksheet>`;
    for (let i = 0; i < 12; i++) {
      expect(readSimpleWorksheet(document('r="A1" broken'), options)).toBeUndefined();
      expect(readSimpleWorksheet(document('r="A1" t="str"', 'text'), options)).toBeUndefined();
      const result = readSimpleWorksheet(document("r='A1' t='s' ", '1'), options);
      expect(result?.rows[0].cells[0]).toEqual({ ref: 'A1', row: 1, column: 1, value: 'Names & notes', valueType: 'text' });
    }
  });
});
