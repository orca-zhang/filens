import JSZip from 'jszip';

export async function createRtlWorksheet() {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="RTL" sheetId="1" r:id="r1"/>'
    + '<sheet name="LTR" sheetId="2" r:id="r2"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="r1" Target="worksheets/s1.xml"/>'
    + '<Relationship Id="r2" Target="worksheets/s2.xml"/></Relationships>');
  zip.file('xl/styles.xml', '<styleSheet><borders><border/><border><right style="medium"><color rgb="FF2244CC"/></right></border>'
    + '<border><left style="thick"><color rgb="FFCC4422"/></left></border>'
    + '<border><top style="medium"><color rgb="FF228844"/></top></border></borders><cellXfs>'
    + '<xf/><xf><alignment horizontal="right" readingOrder="1"/></xf><xf><alignment horizontal="centerContinuous"/></xf>'
    + '<xf borderId="1"><alignment horizontal="center" vertical="center"/></xf><xf borderId="2"/><xf borderId="3"/>'
    + '<xf><alignment horizontal="fill"/></xf><xf><alignment horizontal="right" textRotation="25"/></xf></cellXfs></styleSheet>');

  const text = (ref, value, style = 0) => `<c r="${ref}" s="${style}" t="inlineStr"><is><t>${value}</t></is></c>`;
  const blank = (ref, style) => `<c r="${ref}" s="${style}"/>`;
  const row = (ref, ...cells) => `<row r="${ref}">${cells.join('')}</row>`;
  const columns = Array.from({ length: 98 }, (_, index) => {
    const n = index + 2;
    return (n > 26 ? String.fromCharCode(64 + Math.floor((n - 1) / 26)) : '') + String.fromCharCode(65 + (n - 1) % 26);
  });
  const long = 'Long label ' + 'X'.repeat(45);
  const rows = [
    row(1, text('A1', 'שלום / English'), text('B1', 'Hidden'), text('C1', 'שלום / English', 1),
      '<c r="D1"><f>A2+1</f></c>', text('E1', 'E')),
    row(2, '<c r="A2"><v>41</v></c>'),
    row(3, text('A3', 'Centered short', 2), blank('B3', 2), blank('C3', 2), blank('D3', 2)),
    `<row r="4" ht="22" customHeight="1">${text('A4', 'Centered wide', 2)}${columns.map(col => blank(`${col}4`, 2)).join('')}</row>`,
    row(5, text('A5', 'Merged wide', 3), blank('AX5', 5)),
    row(7, blank('CV7', 4)),
    row(8, text('A8', long, 1), text('E8', 'Stop')),
    row(9, text('CC9', 'Start ' + 'X'.repeat(490))),
    row(10, text('A10', 'AB', 6), blank('B10', 6), blank('C10', 6), blank('D10', 6)),
    row(11, text('A11', long, 7), text('E11', 'Stop')),
    row(1048576, text('XFD1048576', 'Final cell'))
  ];
  const content = `<sheetFormatPr defaultColWidth="13" defaultRowHeight="18"/>
    <cols><col min="1" max="1" width="24" customWidth="1"/><col min="2" max="2" hidden="1"/></cols>
    <sheetData>${rows.join('')}</sheetData><mergeCells><mergeCell ref="A5:CV7"/></mergeCells>`;
  for (const [index, direction] of ['1', '0'].entries()) {
    zip.file(`xl/worksheets/s${index + 1}.xml`, `<worksheet><sheetViews><sheetView workbookViewId="0" rightToLeft="${direction}"/></sheetViews>${content}</worksheet>`);
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
