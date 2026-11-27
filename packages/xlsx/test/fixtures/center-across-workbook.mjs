import JSZip from 'jszip';

export async function createCenterAcrossWorkbook({ numericOnly = false, forceGeneral = false } = {}) {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="Center across" sheetId="1" r:id="s"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="s" Target="worksheets/sheet.xml"/></Relationships>');
  const aligned = '<alignment horizontal="centerContinuous" vertical="center"/>';
  zip.file('xl/styles.xml', '<styleSheet><fonts><font><name val="Arial"/><sz val="11"/></font></fonts>'
    + '<fills><fill/><fill><patternFill patternType="solid"><fgColor rgb="FFD1FAE5"/></patternFill></fill></fills>'
    + `<cellStyleXfs><xf/><xf>${aligned}</xf></cellStyleXfs><cellXfs><xf/>`
    + '<xf xfId="1" applyAlignment="0"><alignment horizontal="left"/></xf>'
    + `<xf fillId="1">${aligned}</xf><xf><alignment horizontal="centerContinuous" vertical="bottom" wrapText="1"/></xf>`
    + `<xf numFmtId="4">${aligned}</xf><xf><alignment horizontal="centerContinuous"/></xf></cellXfs></styleSheet>`);
  const text = (ref, value, style = 1) => `<c r="${ref}" s="${style}" t="str"><v>${value}</v></c>`;
  const blank = (ref, style = 1) => `<c r="${ref}" s="${style}"/>`;
  const long = 'Wide styled heading with a second line&#10;and a third line';
  let rows;
  if (numericOnly) {
    rows = '<row r="1"><c r="A1" s="1"><v>42</v></c><c r="B1" s="2" t="s"/><c r="C1"/><c r="D1" t="b"/></row>';
  } else {
    rows = '<row r="1"><c r="A1" s="1" t="inlineStr"><is><r><t>Styled </t></r>'
      + '<r><rPr><b/><color rgb="FF991155"/></rPr><t>heading</t></r></is></c>'
      + '<c r="B1" s="2" t="b"/>' + blank('C1') + blank('D1') + blank('E1', 0)
      + text('F1', 'Second') + blank('G1') + '</row>'
      + '<row r="2">' + text('A2', 'Formula stop') + blank('B2')
      + '<c r="C2" t="str" s="1"><f>IF(1,"","block")</f><v></v></c>' + blank('D2') + '</row>'
      + '<row r="3" ht="30" customHeight="1">' + text('A3', 'Merge stop', 5) + blank('B3') + blank('C3') + blank('D3') + blank('E3') + '</row>'
      + '<row r="4">' + text('A4', long, 3) + blank('B4') + blank('C4') + blank('D4') + '</row>'
      + '<row r="5" ht="18" customHeight="1">' + text('A5', long, 3) + blank('B5')
      + '<c r="D5"><f t="array" ref="D5:E6">SEQUENCE(2,2)</f><v>1</v></c></row>'
      + '<row r="6"><c r="A6" s="4"><f>12.34*1000</f><v>12340</v></c>'
      + blank('B6') + blank('C6') + blank('D6') + blank('E6') + blank('F6') + '</row>'
      + '<row r="7">' + text('A7', 'Wide centered range')
      + Array.from({ length: 78 }, (_, i) => {
        const col = i + 1;
        return blank((col >= 26 ? String.fromCharCode(64 + Math.floor(col / 26)) : '')
          + String.fromCharCode(65 + col % 26) + '7');
      }).join('') + '</row>'
      + '<row r="8">' + text('A8', 'Gap') + blank('C8') + blank('D8') + '</row>'
      + '<row r="1048576">' + text('XFC1048576', 'Tail') + blank('XFD1048576', 2) + '</row>';
  }
  zip.file('xl/worksheets/sheet.xml', '<worksheet><sheetFormatPr defaultColWidth="13" defaultRowHeight="18"/>'
    + '<cols><col min="2" max="2" width="22"/><col min="3" max="3" hidden="1"/></cols><sheetData>'
    + (forceGeneral ? '<!-- general parser -->' : '') + rows + '</sheetData>'
    + (numericOnly ? '' : '<mergeCells><mergeCell ref="E3:F3"/></mergeCells>') + '</worksheet>');
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
