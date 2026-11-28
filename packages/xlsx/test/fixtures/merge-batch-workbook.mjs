import JSZip from 'jszip';
import { createRegionalNumberWorkbook } from './regional-number-workbook.mjs';
import { prefixXmlElements } from './worksheet-batches.mjs';

export async function createMergeBatchWorkbook(count = 20_000, { stored = false, prefixed = false } = {}) {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="Merge batches" sheetId="1" r:id="s1"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="s1" Target="worksheets/s1.xml"/></Relationships>');
  zip.file('xl/styles.xml', '<styleSheet><dxfs><dxf><fill><patternFill><bgColor rgb="FFCCDDFF"/></patternFill></fill></dxf></dxfs></styleSheet>');
  const merges = Array.from({ length: count }, (_, index) => `<mergeCell ref="A${index + 4}:B${index + 4}"/>`);
  const xml = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:other="urn:other">'
    + '<sheetData><row r="1"><c r="B1"><v>4</v></c></row>'
    + '<row r="1048575"><c r="XFC1048575"><f>B1*2</f><v>8</v></c></row></sheetData>'
    + `<mergeCells count="${count + 4}"><mergeCell ref="B&#49;:C2"/>${merges.join('')}`
    + '<mergeCell ref="XFE1:XFF2"/><other:mergeCell ref="A2:A3"/>'
    + '<mergeCell ref="XFC1048575:XFD1048576"/></mergeCells>'
    + '<conditionalFormatting sqref="XFC1048575"><cfRule type="expression" priority="1" dxfId="0"><formula>TRUE</formula></cfRule>'
    + '</conditionalFormatting></worksheet>';
  zip.file('xl/worksheets/s1.xml', prefixed ? prefixXmlElements(xml) : xml, { compression: stored ? 'STORE' : 'DEFLATE' });
  if (stored) zip.file('xl/media/padding.bin', new Uint8Array(128 * 1024), { compression: 'STORE' });
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createWideMergeWorkbook() {
  const zip = await JSZip.loadAsync(await createRegionalNumberWorkbook());
  const names = Array.from({ length: 2048 }, (_, index) => {
    let name = '', col = index + 1;
    while (col) { name = String.fromCharCode(65 + (col - 1) % 26) + name; col = Math.floor((col - 1) / 26); }
    return name;
  });
  const merges = Array.from({ length: 64 }, (_, index) => {
    const row = index + 1;
    return Array.from({ length: names.length / 2 }, (_, col) =>
      `<mergeCell ref="${names[col * 2]}${row}:${names[col * 2 + 1]}${row}"/>`).join('');
  }).join('');
  zip.file('xl/worksheets/sheet.xml', '<worksheet><sheetFormatPr defaultColWidth="10"/><sheetData>'
    + '<row r="1"><c r="A1" t="inlineStr"><is><t>First merge</t></is></c><c r="XFD1"><v>11</v></c></row>'
    + '<row r="1048400"><c r="XBT1048400"><f>XFD1*2</f></c></row></sheetData>'
    + `<mergeCells>${merges}<mergeCell ref="XBT1048400:XFD1048576"/></mergeCells></worksheet>`);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
