import JSZip from 'jszip';

export async function createNumberFormatWorkbook({ date1904 = false, general = false, formulas = false, percentCode = '0.0%' } = {}) {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', '<workbook>' + (date1904 ? '<workbookPr date1904="true"/>' : '')
    + '<sheets><sheet name="Formats" sheetId="1" r:id="sheet"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="sheet" Target="worksheets/sheet.xml"/></Relationships>');
  zip.file('xl/sharedStrings.xml', '<sst><si><t>00123</t></si><si><t>&lt;b&gt;literal&lt;/b&gt;</t></si></sst>');
  const formats = [
    [164, percentCode],
    [165, 'yyyy-mm-dd hh:mm:ss'],
    [166, '#,##0.00;[Red](#,##0.00);"—";"ID "@'],
    [167, '"unterminated'],
    [168, ';;;'],
    [169, '[$€-407]#,##0.00']
  ];
  const ids = [0, 4, 164, 165, 46, 166, 167, 168, 49, 0, 7, 12, 11, 169, 250];
  zip.file('xl/styles.xml', '<styleSheet><numFmts>'
    + formats.map(([id, code]) => '<numFmt numFmtId="' + id + '" formatCode="'
      + code.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;') + '"/>').join('')
    + '</numFmts><cellStyleXfs><xf numFmtId="164"/></cellStyleXfs><cellXfs>'
    + ids.map((id, index) => index === 9 ? '<xf numFmtId="14" xfId="0" applyNumberFormat="0"/>' : '<xf numFmtId="' + id + '"/>').join('')
    + '</cellXfs></styleSheet>');
  const cells = ([column, style, value, type]) => '<c r="' + column + '" s="' + style + '"' + (type ? ' t="' + type + '"' : '')
    + '>' + (value === undefined ? '' : '<v>' + value + '</v>') + '</c>';
  const first = [
    ['A1', 1, '1234.5'], ['B1', 2, '0.125'], ['C1', 3, '60.5'], ['D1', 4, '1.5'], ['E1', 5, '-1234.5'],
    ['F1', 5, '0'], ['G1', 5, '0', 's'], ['H1', 6, '42'], ['I1', 7, '35'], ['J1', 1, '0', 's'],
    ['K1', 10, '34.5'], ['L1', 11, '1.5'], ['M1', 12, '1234'], ['N1', 13, '1234.5'], ['O1', 14, '0007'],
    ['Q1', 7, '1', 'b'], ['R1', 2, undefined, 's'], ['S1', 5, '1', 's'], ['T1', 8, '0', 's']
  ].map(cells).join('') + '<c r="P1"><v>0.5</v></c>';
  const second = formulas ? '<c r="B2" s="2"><f>B1+1</f><v>0.376</v></c>'
    + '<c r="C2" s="3" t="d"><v>2024-02-29T14:30:00</v></c>'
    + '<c r="D2" s="2"><f>UNKNOWN(A1)</f></c>'
    + '<c r="E2" s="7" t="e"><v>#DIV/0!</v></c>'
    + '<c r="F2" s="5" t="str"><f>TEXT(A1,"0")</f><v>00123</v></c>'
    + '<c r="G2" s="5" t="str"><f>IF(A1,"","unused")</f><v/></c>'
    + '<c r="H2" s="1"><f>2+3</f><v/></c>' : '';
  zip.file('xl/worksheets/sheet.xml', '<worksheet><sheetFormatPr defaultColWidth="21"/>'
    + '<cols><col min="16" max="16" style="2" width="21"/></cols><sheetData>'
    + (general ? '<!-- force the general worksheet parser -->' : '')
    + '<row r="1">' + first + '</row>'
    + '<row r="2" s="9" customFormat="1"><c r="A2"><v>0.35</v></c><c r="P2" s="0"><v>0.5</v></c>' + second + '</row>'
    + '<row r="500"><c r="A500" s="5"><v>-1234.5</v></c></row>'
    + '<row r="2000"><c r="BL2000" s="1">' + (formulas ? '<f>A1*2+B1*8</f>' : '<v>2470</v>') + '</c></row>'
    + '</sheetData><mergeCells><mergeCell ref="A500:BL1700"/></mergeCells></worksheet>');
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
