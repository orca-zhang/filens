import JSZip from 'jszip';

export function prefixXmlElements(xml, namespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main') {
  return xml.replace(/<(\/?)([A-Za-z][\w.-]*)(?=[ \t\r\n/>])/g, '<$1main:$2')
    .replace(/(<main:[\w.-]+)(?: xmlns="[^"]+")?/, `$1 xmlns:main="${namespace}"`);
}

export async function createWorksheetBatchWorkbook(rowCount = 6400, {
  forceGeneral = false, sheetDataAttributes = ' custom="a>b"', extraInlineRuns = false
} = {}) {
  const zip = new JSZip(), date = new Date('2020-01-01T00:00:00Z');
  const add = (name, xml) => zip.file(name, xml, { date });
  add('xl/workbook.xml', '<workbook><sheets><sheet name="Batches" sheetId="1" r:id="rows"/></sheets></workbook>');
  add('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rows" Target="worksheets/rows.xml"/></Relationships>');
  add('xl/styles.xml', '<styleSheet><fonts><font><name val="Arial"/></font><font><name val="Courier New"/></font></fonts>'
    + '<cellXfs><xf/><xf fontId="1" numFmtId="2"/></cellXfs></styleSheet>');
  const first = '<row r="1"><c r="A1"><v>2</v></c><c r="B1" t="inlineStr"><is><r><rPr><b/></rPr>'
    + '<t>North &amp; 南</t></r><r><t xml:space="preserve"> branch</t></r></is></c>'
    + '<c r="C1"><f t="shared" si="7"/></c>'
    + (extraInlineRuns ? '<c r="D1" t="inlineStr"><is><r><rPr><i/></rPr><t>First detail</t></r></is></c>' : '') + '</row>';
  const rows = Array.from({ length: rowCount - 1 }, (_, index) => {
    const r = index + 2;
    if (r === 17) return '<row r="17" hidden="1" ht="22" customHeight="1"/>';
    const attributes = r === 4000 ? '' : ` r="${r}"`;
    const label = r % 29 === 0 ? 'East &amp; West' : 'East and West';
    return `<row${attributes}><c r="A${r}"><v>${r}</v></c><c r="B${r}" t="inlineStr"><is><t>${label} ${r}</t></is></c>`
      + `<c r="D${r}" s="1"><f>A${r}*2</f><v>${r * 2}</v></c><c r="E${r}" t="b"><v>1</v></c></row>`;
  });
  const last = '<row r="1048576"><c r="A1048576"><v>12</v></c>'
    + '<c r="C1048576"><f t="shared" si="7" ref="C1:C1048576">A1048576*2</f></c>'
    + (extraInlineRuns ? '<c r="E1048576" t="inlineStr"><is><r><rPr><b/><color rgb="FF336699"/></rPr><t>Last &amp; 南</t></r></is></c>' : '')
    + `<c r="XFD1048576" s="1"><f>A1+A${rowCount}+C1+C1048576</f></c></row>`;
  add('xl/worksheets/rows.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<sheetFormatPr defaultColWidth="14"/><cols><col min="2" max="2" width="20" style="1"/></cols>'
    + `<sheetData${sheetDataAttributes}>` + (forceGeneral ? '<!-- full worksheet parser -->' : '')
    + first + rows.join('\r\n') + last + '</sheetData>'
    + '<mergeCells><mergeCell ref="B1:B2"/></mergeCells></worksheet>');
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createImplicitCoordinateWorkbook({ omit = true, large = false, mixed = false, prefixed = false } = {}) {
  const zip = new JSZip();
  const row = (index, cells, implicit = false, attrs = '') =>
    `<row${omit && implicit ? '' : ` r="${index}"`}${attrs}>${cells}</row>`;
  const cell = (ref, value, implicit = false, attrs = '') =>
    `<c${omit && implicit ? '' : ` r="${ref}"`}${attrs}>${value}</c>`;
  const value = number => `<v>${number}</v>`;
  const filler = large ? Array.from({ length: 14_000 }, (_, offset) => {
    const index = offset + 11;
    const second = mixed && offset === 2
      ? cell(`B${index}`, '<is><t>East &amp; West</t></is>', true, ' t="inlineStr"')
      : cell(`B${index}`, value(index * 2), true);
    return row(index, cell(`A${index}`, value(index), true) + second, true);
  }).join('') : '';
  const data = '<worksheet><sheetFormatPr defaultRowHeight="15"/><sheetData>'
    + row(1, cell('A1', value(2), true) + (omit ? '<c> \r\n </c>' : '<c r="B1"/>') + cell('C1', value(6), true)
      + cell('E1', value(3)) + cell('F1', value(0), true, ' t="s"'), true)
    + row(9, cell('A9', value(4)), false, ' hidden="1"')
    + row(10, cell('A10', value(10), true) + cell('C10', value(8)) + cell('D10', value(12), true, ' s="1"'), true, ' ht="24" customHeight="1"')
    + filler + row(1048575, cell('XFC1048575', value(21)))
    + row(1048576, cell('XFC1048576', value(20)) + cell('XFD1048576', value(22), true), true)
    + '</sheetData><mergeCells><mergeCell ref="F1:G1"/></mergeCells></worksheet>';
  const summary = '<worksheet><sheetData>'
    + row(1, cell('A1', '<f>SUM(Data!A1:F1,Data!A9:A10,Data!D10,Data!XFD1048576)</f>', true), true)
    + row(4, cell('C4', value(5)) + cell('D4', '<f t="shared" si="1" ref="D4:D5">ROW()+C4</f>', true))
    + row(5, cell('C5', value(7)) + cell('D5', '<f t="shared" si="1"/>', true), true)
    + '</sheetData></worksheet>';
  zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="Data" sheetId="1" r:id="data"/>'
    + '<sheet name="Summary" sheetId="2" r:id="summary"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="data" Target="worksheets/data.xml"/>'
    + '<Relationship Id="summary" Target="worksheets/summary.xml"/></Relationships>');
  zip.file('xl/sharedStrings.xml', '<sst><si><t>Heading</t></si></sst>');
  zip.file('xl/styles.xml', '<styleSheet><fonts><font><name val="Arial"/></font></fonts>'
    + '<cellXfs><xf/><xf numFmtId="2"/></cellXfs></styleSheet>');
  zip.file('xl/worksheets/data.xml', prefixed ? prefixXmlElements(data) : data);
  zip.file('xl/worksheets/summary.xml', prefixed ? prefixXmlElements(summary) : summary);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
