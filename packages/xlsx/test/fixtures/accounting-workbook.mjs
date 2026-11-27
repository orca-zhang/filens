import JSZip from 'jszip';

export async function createAccountingWorkbook() {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="Accounting" sheetId="1" r:id="s1"/>'
    + '<sheet name="Formulas" sheetId="2" r:id="s2"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="s1" Target="worksheets/s1.xml"/>'
    + '<Relationship Id="s2" Target="worksheets/s2.xml"/></Relationships>');
  zip.file('xl/styles.xml', '<styleSheet><numFmts>'
    + '<numFmt numFmtId="164" formatCode="[Red][$€-407]*·0.00_)"/>'
    + '<numFmt numFmtId="165" formatCode="0;0;0;&quot;ID &quot;*·@_W"/>'
    + '<numFmt numFmtId="166" formatCode="0.00*-"/>'
    + '<numFmt numFmtId="167" formatCode="0.0?"/><numFmt numFmtId="168" formatCode="# ???/???"/>'
    + '<numFmt numFmtId="169" formatCode="0.0?E+?0"/><numFmt numFmtId="170" formatCode="##0.00E+?0"/>'
    + '<numFmt numFmtId="171" formatCode="0.0?e-?0;[Blue](0.0?e-?0)"/>'
    + '</numFmts><fonts><font><sz val="11"/></font></fonts><cellXfs><xf/><xf numFmtId="44"/>'
    + '<xf numFmtId="164"/><xf numFmtId="165"/><xf numFmtId="166"/><xf numFmtId="167"/><xf numFmtId="168"/>'
    + '<xf numFmtId="167"><alignment horizontal="center"/></xf>'
    + '<xf numFmtId="169"/><xf numFmtId="170"/><xf numFmtId="171"/></cellXfs>'
    + '<dxfs><dxf><numFmt numFmtId="172" formatCode="[Green]0.00E+??"/></dxf></dxfs></styleSheet>');
  const number = (ref, value, style = 1) => `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
  const formula = (ref, value, style = 1) => `<c r="${ref}" s="${style}"><f>${value}</f></c>`;
  const row = (index, ...cells) => `<row r="${index}">${cells.join('')}</row>`;
  zip.file('xl/worksheets/s1.xml', '<worksheet><sheetFormatPr defaultRowHeight="15" defaultColWidth="18"/>'
    + '<cols><col min="2" max="2" width="30"/></cols><sheetData>'
    + row(1, number('A1', 1234.5), number('B1', 1234.5), number('C1', 12.3, 2),
      '<c r="D1" t="inlineStr" s="3"><is><r><rPr><color rgb="FF003399"/></rPr><t>Label</t></r></is></c>', number('E1', 1234.5))
    + row(2, number('A2', -1234.5)) + row(3, number('A3', 0))
    + row(4, '<c r="A4" t="inlineStr" s="1"><is><t>Note</t></is></c>')
    + row(5, number('A5', 12.3, 4))
    + row(7, number('A7', 8.9, 5), number('B7', 5.25, 6), number('C7', 8.9, 7))
    + row(8, number('A8', 88.99, 5), number('B8', 5.3, 6)) + row(9, number('B9', 5, 6))
    + row(10, number('A10', 5.25, 6))
    + row(12, number('A12', 1200, 8), number('B12', 99.995, 9), number('C12', -0.0012, 10), number('D12', Math.PI, 0))
    + row(13, number('A13', 12300000000, 8), number('B13', 0.000999999, 9), formula('C13', 'TEXT(A12,"0.0?E+?0")', 0))
    + row(14, number('A14', 1200, 8))
    + row(1048576, formula('XFB1048576', 'A12*10', 8), formula('XFC1048576', 'A7+80', 5), formula('XFD1048576', 'A1*2'))
    + '</sheetData><mergeCells><mergeCell ref="A5:BA6"/><mergeCell ref="A10:BA11"/><mergeCell ref="A14:BA15"/></mergeCells>'
    + '<conditionalFormatting sqref="E1"><cfRule type="iconSet" priority="1"><iconSet><cfvo type="num" val="0"/>'
    + '<cfvo type="num" val="10"/><cfvo type="num" val="20"/></iconSet></cfRule></conditionalFormatting>'
    + '<conditionalFormatting sqref="D12"><cfRule type="cellIs" operator="greaterThan" dxfId="0" priority="2"><formula>0</formula></cfRule></conditionalFormatting></worksheet>');
  zip.file('xl/worksheets/s2.xml', '<worksheet><sheetViews><sheetView showFormulas="1"/></sheetViews>'
    + `<sheetData>${row(1, formula('A1', '2+3'))}</sheetData></worksheet>`);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
