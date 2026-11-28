import JSZip from 'jszip';
import { createRegionalNumberWorkbook } from './regional-number-workbook.mjs';

const formats = {
  'en-US': ['#,##0.00 €', 'dddd, dd/mm/yyyy', '0.0 %', '0.00E+00'],
  'de-DE': ['#.##0,00 €', 'TTTT, TT.MM.JJJJ', '0,0\u00a0%', '0,00E+00'],
  'fr-FR': ['#\u00a0##0,00\u00a0€', 'JJJJ, JJ/MM/AAAA', '0,0\u00a0%', '0,00E+00']
};

export async function createLocalizedTextWorkbook(locale) {
  const [money, date, percent, scientific] = formats[locale];
  const zip = await JSZip.loadAsync(await createRegionalNumberWorkbook());
  zip.file('xl/worksheets/sheet.xml', '<worksheet><sheetFormatPr defaultColWidth="24"/><sheetData>'
    + '<row r="1"><c r="A1" s="1"><v>1234.567</v></c><c r="B1"><f>TEXT(A1,A2)</f></c>'
    + `<c r="C1"><f>TEXT(DATE(2024,2,29),"${date}")</f></c><c r="D1"><f>TEXT(0.285,"${percent}")</f></c>`
    + `<c r="E1" t="str"><f>TEXT(A1,"${money}")</f><v>Saved 1,234.57 €</v></c>`
    + '<c r="F1"><f>TEXT(A1,"#,##0.00")</f></c></row>'
    + `<row r="2"><c r="A2" t="inlineStr"><is><t>${money}</t></is></c></row>`
    + `<row r="1048576"><c r="XFD1048576"><f>TEXT(12200000,"${scientific}")</f></c></row>`
    + '</sheetData></worksheet>');
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
