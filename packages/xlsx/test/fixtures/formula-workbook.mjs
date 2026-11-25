import JSZip from 'jszip';

const escapeXml = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export async function createFormulaWorkbook() {
  const zip = new JSZip();
  const names = ['Summary', 'Input', "Data's 2026"];
  zip.file('xl/workbook.xml', '<workbook><sheets>' + names.map((name, i) =>
    '<sheet name="' + name + '" sheetId="' + (i + 1) + '" r:id="r' + (i + 1) + '"/>').join('') + '</sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships>' + names.map((_, i) =>
    '<Relationship Id="r' + (i + 1) + '" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') + '</Relationships>');
  zip.file('xl/styles.xml', '<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="4"/></cellXfs></styleSheet>');
  const formula = (ref, text, attrs = '', cached = '') =>
    '<c r="' + ref + '"' + attrs + '><f>' + escapeXml(text) + '</f>' + cached + '</c>';
  const row = (index, cells) => '<row r="' + index + '">' + cells.join('') + '</row>';
  const worksheet = rows => '<worksheet><sheetFormatPr defaultColWidth="18"/><sheetData>' + rows.join('') + '</sheetData></worksheet>';
  const data = "'Data''s 2026'!";
  zip.file('xl/worksheets/sheet1.xml', worksheet([
    row(1, [
      formula('A1', 'input!$A$1'),
      formula('B1', 'SUM(' + data + '$A:$A)'),
      formula('C1', 'AVERAGE(' + data + 'A:A)'),
      formula('D1', 'IF(B1>=15,_xlfn.CONCAT("total: ",B1),D1)', ' t="str"'),
      formula('E1', 'IFERROR(1/0,"safe")'),
      formula('F1', 'ROUND(2.675,2)'),
      formula('G1', 'IF("FiLens"="filens",100%,0)'),
      formula('H1', 'COUNT(' + data + 'A1:B4)'),
      formula('I1', 'COUNTA(' + data + '$1:$4)')
    ]),
    row(2, [
      formula('A2', 'Input!B1'),
      formula('B2', 'IFERROR(Missing!A1,"missing")'),
      formula('C2', 'SUM(' + data + 'A1:B4)'),
      formula('D2', data + 'A2 & ":" & ' + data + 'A3'),
      formula('E2', '9*9', '', '<v>5</v>'),
      formula('F2', "'[remote.xlsx]Sheet1'!A1")
    ]),
    row(1048576, [formula('XFD1048576', 'SUM(' + data + 'A:A)*B1+0.25', ' s="1"')])
  ]));
  zip.file('xl/worksheets/sheet2.xml', worksheet([
    row(1, [formula('A1', data + 'A1+1'), formula('B1', 'Summary!A2')])
  ]));
  zip.file('xl/worksheets/sheet3.xml', worksheet([
    row(1, ['<c r="A1"><v>9</v></c>', '<c r="B1" t="e"><v>#N/A</v></c>']),
    row(2, ['<c r="A2" t="inlineStr"><is><t>4</t></is></c>', '<c r="B2" t="inlineStr"><is><t></t></is></c>']),
    row(3, ['<c r="A3" t="b"><v>1</v></c>', formula('B3', 'IF(FALSE,"unused","")', ' t="str"', '<v/>')]),
    row(1048576, ['<c r="A1048576"><v>6</v></c>'])
  ]));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
