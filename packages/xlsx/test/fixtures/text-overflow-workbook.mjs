import JSZip from 'jszip';

export async function createTextOverflowWorkbook() {
  const zip = new JSZip();
  const names = ['Labels', 'Trailing', 'Formulas', 'Fill'];
  zip.file('xl/workbook.xml', '<workbook><sheets>' + names.map((name, index) =>
    `<sheet name="${name}" sheetId="${index + 1}" r:id="s${index + 1}"/>`).join('') + '</sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships>' + names.map((_, index) =>
    `<Relationship Id="s${index + 1}" Target="worksheets/s${index + 1}.xml"/>`).join('') + '</Relationships>');
  zip.file('xl/styles.xml', '<styleSheet><fonts><font><sz val="11"/><name val="Arial"/></font>'
    + '<font><sz val="11"/><name val="Arial"/><color rgb="FFBE185D"/></font></fonts><cellXfs>'
    + '<xf/><xf fontId="1"/><xf><alignment horizontal="right" vertical="top"/></xf>'
    + '<xf><alignment horizontal="center" vertical="bottom"/></xf><xf><alignment shrinkToFit="1"/></xf>'
    + '<xf><alignment wrapText="1"/></xf><xf><alignment horizontal="fill"/></xf>'
    + '<xf numFmtId="2"><alignment horizontal="fill"/></xf></cellXfs></styleSheet>');
  const label = 'Wide text ' + 'W'.repeat(80);
  const long = 'W'.repeat(520);
  const row = (index, ...cells) => `<row r="${index}">${cells.join('')}</row>`;
  const text = (ref, value = label, style = 0) => `<c r="${ref}" s="${style}" t="inlineStr"><is><t>${value}</t></is></c>`;
  const number = (ref, value) => `<c r="${ref}"><v>${value}</v></c>`;
  const sheet = (rows, tail = '', view = '') => '<worksheet>' + view
    + '<sheetFormatPr defaultColWidth="8"/><cols><col min="2" max="2" hidden="1"/><col min="3" max="3" width="10" customWidth="1"/></cols>'
    + '<sheetData>' + rows.join('') + '</sheetData>' + tail + '</worksheet>';
  zip.file('xl/worksheets/s1.xml', sheet([
    row(1, text('A1', label, 1), text('B1', 'Hidden'), text('H1', 'Stop')),
    row(2, text('J2', 'Stop'), text('Q2', label, 2)),
    row(3, text('D3', 'Stop'), text('H3', label, 3), text('L3', 'Stop')),
    row(4, text('A4'), '<c r="C4" t="str"><f>""</f><v></v></c>'),
    row(5, text('A5')),
    row(6, '<c r="A6" t="inlineStr"><is><r><t>Rich</t></r><r><rPr><b/><color rgb="FF993355"/></rPr>'
      + `<t>${label}</t></r></is></c>`),
    row(7, text('A7', label, 4)),
    row(8, text('A8', label, 5)),
    row(9, text('A9', label, 6)),
    row(10, number('A10', '123456789012345')),
    row(11, `<c r="A11"><f>"${label}"</f></c>`),
    row(12, text('A12', 'Fit')),
    row(13, text('A13', long)),
    row(14, text('CC14', long, 2)),
    row(1_048_576, text('XFD1048576', 'Final ' + 'W'.repeat(30), 2))
  ], '<mergeCells><mergeCell ref="D5:F5"/></mergeCells>'));
  zip.file('xl/worksheets/s2.xml', sheet([row(1, text('A1', 'Text spans saved widths in blank columns'))]));
  zip.file('xl/worksheets/s3.xml', sheet([row(1, text('A1', label), number('D1', '1'), '<c r="E1" s="6"><f>"XY"</f></c>')], '',
    '<sheetViews><sheetView workbookViewId="0" showFormulas="1"/></sheetViews>'));
  const blank = ref => `<c r="${ref}" s="6"/>`;
  const columnName = col => col < 26 ? String.fromCharCode(65 + col)
    : String.fromCharCode(64 + Math.floor(col / 26), 65 + col % 26);
  zip.file('xl/worksheets/s4.xml', sheet([
    row(1, text('A1', 'XY', 6), blank('B1'), blank('C1'), text('D1', 'Stop'), blank('E1')),
    row(2, '<c r="A2" s="7"><v>1.2</v></c>', blank('B2'), blank('C2'),
      '<c r="D2" s="6" t="str"><f>""</f><v/></c>', blank('E2')),
    row(3, '<c r="A3" s="6" t="inlineStr"><is><r><t>R</t></r><r><rPr><b/><color rgb="FF993355"/></rPr><t>x</t></r></is></c>'),
    row(4, text('A4', label, 6), blank('B4')),
    row(5, text('A5', 'Line&#10;break', 6)),
    row(6, text('A6', 'XY', 6), blank('B6'), blank('C6'), text('E6', label, 2)),
    row(7, '<c r="A7" s="6"><f>"XY"</f></c>', ...Array.from({ length: 80 }, (_, index) => blank(columnName(index + 1) + '7'))),
    row(8, text('A8', 'AB', 6)).replace('<row', '<row ht="24" customHeight="1"'),
    row(1_048_576, text('XFC1048576', 'End', 6), blank('XFD1048576'))
  ], '<mergeCells><mergeCell ref="A8:CC8"/></mergeCells>'));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
