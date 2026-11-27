import JSZip from 'jszip';

export async function createDbNumberWorkbook() {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="DBNum" sheetId="1" r:id="s1"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="s1" Target="worksheets/s1.xml"/></Relationships>');
  zip.file('xl/styles.xml', '<styleSheet><numFmts>'
    + '<numFmt numFmtId="164" formatCode="[DBNum2][$-804]General"/>'
    + '<numFmt numFmtId="165" formatCode="[DBNum2]General"/>'
    + '<numFmt numFmtId="166" formatCode="[DBNum3][$-411]&quot;Q2 &quot;000.0?_7"/>'
    + '<numFmt numFmtId="167" formatCode="[DBNum4][$-412]General"/>'
    + '<numFmt numFmtId="169" formatCode="[DBNum1][$-411]ggge年m月d日"/>'
    + '<numFmt numFmtId="170" formatCode="[DBNum3][$-ja-JP]hh時mm分"/>'
    + '<numFmt numFmtId="171" formatCode="[DBNum2][$-404]yyyy年m月d日"/>'
    + '<numFmt numFmtId="172" formatCode="[DBNum4][$-412]yyyy년 m월 d일"/>'
    + '</numFmts><cellXfs><xf/><xf numFmtId="164"/><xf numFmtId="165"/><xf numFmtId="166"/><xf numFmtId="167"/>'
    + '<xf numFmtId="169"/><xf numFmtId="170"/><xf numFmtId="171"/><xf numFmtId="172"/></cellXfs>'
    + '<dxfs><dxf><numFmt numFmtId="168" formatCode="[Blue][DBNum1][$-411]General"/></dxf>'
    + '<dxf><numFmt numFmtId="173" formatCode="[Blue][DBNum1][$-804]yyyy年m月d日"/></dxf></dxfs></styleSheet>');
  const cell = (ref, style, content) => `<c r="${ref}" s="${style}">${content}</c>`;
  zip.file('xl/worksheets/s1.xml', '<worksheet><sheetFormatPr defaultColWidth="18"/><sheetData><row r="1">'
    + cell('A1', 1, '<v>120</v>') + cell('B1', 2, '<v>120</v>') + cell('C1', 0, '<f>A1+B1</f>')
    + cell('D1', 0, '<f>TEXT(C1,"[DBNum1][$-411]General")</f>') + cell('E1', 3, '<v>12.3</v>')
    + cell('F1', 0, '<v>101</v>') + '<c r="G1" s="1" t="inlineStr"><is><t>120</t></is></c>'
    + '</row><row r="2">'
    + cell('A2', 5, '<v>37972</v>') + cell('B2', 6, '<f>TIME(3,8,0)</f>')
    + '<c r="C2" s="7" t="d"><v>2024-02-29</v></c>'
    + cell('D2', 0, '<f>TEXT(A2,"[DBNum3][$-411]ggge年m月d日")</f>') + cell('E2', 0, '<f>A2+1</f>')
    + '</row><row r="5">' + cell('A5', 4, '<v>1012</v>') + '</row>'
    + '<row r="7">' + cell('A7', 8, '<v>45351</v>') + '</row>'
    + '<row r="1048576">' + cell('XFC1048576', 0, '<f>DATE(2024,2,29)</f>')
    + cell('XFD1048576', 1, '<f>C1+1</f>') + '</row></sheetData>'
    + '<mergeCells><mergeCell ref="A5:BA6"/><mergeCell ref="A7:BA8"/></mergeCells>'
    + '<conditionalFormatting sqref="F1"><cfRule type="cellIs" operator="greaterThan" dxfId="0" priority="1">'
    + '<formula>0</formula></cfRule></conditionalFormatting>'
    + '<conditionalFormatting sqref="XFC1048576"><cfRule type="cellIs" operator="greaterThan" dxfId="1" priority="1">'
    + '<formula>0</formula></cfRule></conditionalFormatting></worksheet>');
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
