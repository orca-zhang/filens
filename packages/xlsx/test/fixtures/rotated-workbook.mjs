import JSZip from 'jszip';

export async function createRotatedWorkbook({ forceGeneral = false } = {}) {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="Orientation" sheetId="1" r:id="sheet"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="sheet" Target="worksheets/sheet.xml"/></Relationships>');
  const align = (angle, extra = '') => `<alignment textRotation="${angle}" ${extra}/>`;
  const center = 'horizontal="center" vertical="center"';
  zip.file('xl/styles.xml', '<styleSheet><fonts><font><name val="Arial"/><sz val="11"/></font></fonts>'
    + `<cellStyleXfs><xf/><xf>${align(30, center)}</xf></cellStyleXfs><cellXfs><xf/>`
    + [align(45, center), align(135, center), align(90, center), align(180, center), align(255, center),
      align(181), align(45, 'horizontal="right" vertical="bottom" wrapText="1"'),
      align(90, 'horizontal="right" vertical="center" shrinkToFit="1"')]
      .map(alignment => `<xf>${alignment}</xf>`).join('')
    + `<xf xfId="1" applyAlignment="0">${align(0)}</xf><xf xfId="1" applyAlignment="1">${align(0)}</xf>`
    + `<xf numFmtId="4">${align(150, center)}</xf></cellXfs></styleSheet>`);
  const text = (ref, style, value) => `<c r="${ref}" s="${style}" t="str"><v>${value}</v></c>`;
  zip.file('xl/worksheets/sheet.xml', '<worksheet><sheetFormatPr defaultColWidth="16" defaultRowHeight="18"/>'
    + '<cols><col min="1" max="1" width="18"/><col min="8" max="8" width="14"/></cols><sheetData>'
    + (forceGeneral ? '<!-- general parser -->' : '')
    + '<row r="1">' + text('A1', 1, 'Upwards') + text('B1', 2, 'Downwards')
    + text('C1', 3, 'Vertical up') + text('D1', 4, 'Vertical down') + text('E1', 5, 'A中é')
    + text('F1', 6, 'Unrotated') + text('G1', 9, 'Inherited') + text('H1', 10, 'Cleared') + '</row>'
    + '<row r="2" ht="27" customHeight="1">' + text('A2', 4, 'Fixed height clipping')
    + text('B2', 8, 'Shrunk in the fixed row') + '</row>'
    + '<row r="3">' + text('A3', 7, 'A wrapped headline with enough words to wrap automatically&#10;with a second part')
    + '<c r="B3" s="11"><f>12345.67</f><v>12345.67</v></c>'
    + '<c r="C3" s="2" t="inlineStr"><is><r><t>Rich </t></r><r><rPr><b/><sz val="20"/><color rgb="FF991155"/></rPr><t>run</t></r></is></c>'
    + '</row><row r="4">' + text('A4', 3, 'Long upright label '.repeat(60)) + '</row>'
    + '<row r="12">' + text('H12', 1, 'Centred rotated merge') + '</row>'
    + '<row r="1048576">' + text('XFD1048576', 3, 'Tail') + '</row></sheetData>'
    + '<mergeCells><mergeCell ref="H12:AW230"/></mergeCells></worksheet>');
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createRotatedOverflowWorkbook() {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="Overflow" sheetId="1" r:id="sheet"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="sheet" Target="worksheets/sheet.xml"/></Relationships>');
  zip.file('xl/styles.xml', '<styleSheet><fonts><font><name val="Arial"/><sz val="11"/></font>'
    + '<font><name val="Arial"/><sz val="14"/><color rgb="FFBE185D"/></font></fonts>'
    + '<cellXfs><xf/><xf fontId="1"><alignment textRotation="6"/></xf>'
    + '<xf fontId="1"><alignment textRotation="96" horizontal="right" vertical="center"/></xf>'
    + '<xf fontId="1"><alignment textRotation="1" vertical="center"/></xf>'
    + '<xf fontId="1"><alignment textRotation="91" horizontal="right" vertical="center"/></xf>'
    + '<xf fontId="1"><alignment textRotation="45" horizontal="center" wrapText="1"/></xf></cellXfs></styleSheet>');
  const text = (ref, style, value) => `<c r="${ref}" s="${style}" t="str"><v>${value}</v></c>`;
  const title = 'A long rotated caption crosses its own cell and continues through the empty cells';
  const long = 'Rotated text remains in source coordinates while scrolling. '.repeat(12).trimEnd();
  zip.file('xl/worksheets/sheet.xml', '<worksheet><sheetFormatPr defaultColWidth="12" defaultRowHeight="18"/>'
    + '<cols><col min="3" max="3" hidden="1"/><col min="4" max="4" width="20"/></cols><sheetData>'
    + '<row r="1">' + text('A1', 1, title) + text('C1', 0, 'Hidden') + '<c r="D1" s="5"/>' + text('E1', 0, 'Occupied') + '</row>'
    + '<row r="2" ht="38" customHeight="1"><c r="D2" t="str"><f>IF(1,"","value")</f><v></v></c>'
    + text('H2', 2, title) + '</row>'
    + '<row r="3">' + text('A3', 1, title) + '</row>'
    + '<row r="4"><c r="D4"><f t="array" ref="D4:E4">SEQUENCE(1,2)</f><v>1</v></c>' + text('H4', 2, title) + '</row>'
    + '<row r="5">' + text('A5', 5, title) + '</row>'
    + '<row r="6" ht="54" customHeight="1">' + text('A6', 3, long) + text('BM6', 0, 'Right stop') + '</row>'
    + '<row r="7">' + text('A7', 0, 'Left stop') + text('AZ7', 4, long) + '</row>'
    + '<row r="8" ht="35" customHeight="1">' + text('A8', 1, title) + text('B8', 0, 'Immediate stop') + '</row>'
    + '<row r="1048576">' + text('XFC1048576', 1, title) + '</row></sheetData>'
    + '<mergeCells><mergeCell ref="D3:E3"/></mergeCells></worksheet>');
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createTrailingRotatedOverflowWorkbook() {
  const zip = new JSZip(), names = ['Single cell', 'Long title', 'Short title', 'Late title'];
  zip.file('xl/workbook.xml', '<workbook><sheets>' + names.map((name, i) => `<sheet name="${name}" sheetId="${i + 1}" r:id="s${i + 1}"/>`).join('')
    + '</sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships>' + names.map((_, i) => `<Relationship Id="s${i + 1}" Target="worksheets/s${i + 1}.xml"/>`).join('')
    + '</Relationships>');
  zip.file('xl/styles.xml', '<styleSheet><fonts><font><name val="Arial"/><sz val="11"/></font></fonts>'
    + '<cellXfs><xf/><xf><alignment textRotation="30"/></xf><xf><alignment textRotation="1"/></xf></cellXfs></styleSheet>');
  const row = (r, value, style) => `<row r="${r}"><c r="A${r}" s="${style}" t="str"><v>${value}</v></c></row>`;
  const long = 'A long label across the trailing blank columns. '.repeat(14).trimEnd();
  const write = (number, rows, columns = '') => zip.file(`xl/worksheets/s${number}.xml`,
    `<worksheet><sheetFormatPr defaultColWidth="9" defaultRowHeight="18"/>${columns}<sheetData>${rows}</sheetData></worksheet>`);
  write(1, row(1, 'This text is rotated', 1), '<cols><col min="2" max="2" hidden="1"/><col min="3" max="3" width="24"/></cols>');
  write(2, row(1, long, 2));
  write(3, row(1, 'A', 1));
  write(4, row(1, 'Start', 0) + row(180, 'A heading appears in the last row', 1));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
