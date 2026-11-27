import JSZip from 'jszip';

export async function createClockFormulaWorkbook(date1904 = false, { clockOffscreen = false } = {}) {
  const zip = new JSZip();
  const first = date1904 ? 43830 : 45292;
  zip.file('xl/workbook.xml', `<workbook><workbookPr date1904="${Number(date1904)}"/><sheets>
    <sheet name="Calendar" sheetId="1" r:id="rId1"/><sheet name="Clock Source" sheetId="2" r:id="rId2"/>
    </sheets><definedNames><definedName name="NextDay">TODAY()+1</definedName></definedNames></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships>'
    + '<Relationship Id="rId1" Target="worksheets/calendar.xml"/><Relationship Id="rId2" Target="worksheets/clock.xml"/></Relationships>');
  zip.file('xl/styles.xml', `<styleSheet><numFmts>
    <numFmt numFmtId="164" formatCode="yyyy-mm-dd"/>
    <numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm:ss"/>
    </numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="165"/></cellXfs>
    <dxfs><dxf><font><color rgb="FF008000"/></font></dxf></dxfs></styleSheet>`);
  zip.file('xl/worksheets/calendar.xml', `<worksheet><sheetFormatPr defaultColWidth="22"/><sheetData>
    <row r="1"><c r="A1" s="1"><f>TODAY()</f></c><c r="B1" s="2"><f>NOW()</f></c><c r="C1" s="1"><f>NextDay</f></c>
      <c r="D1" s="1"><f>TODAY()</f><v>${first - 1}</v></c>
      <c r="E1"><f>IF(DAY(TODAY())=1,1/0,42)</f></c><c r="F1" s="2"><f>NOW()</f><v>${first - 0.75}</v></c></row>
    <row r="2"><c r="A2" s="1"><v>${first}</v></c><c r="B2" s="1"><v>${first + 1}</v></c>
      <c r="C2"><v>1</v></c><c r="D2"><v>1</v></c><c r="E2" s="1"><v>${first + 1}</v></c></row>
    <row r="1048576"><c r="D1048576"><f>IF(DAY(TODAY())=1,0,2)</f></c>
      <c r="XFC1048576" s="1"><f>'Clock Source'!$A$1</f></c>
      <c r="XFD1048576" s="2"><f>'Clock Source'!$B$1</f></c></row>
    </sheetData>
    <conditionalFormatting sqref="A2:B2"><cfRule type="timePeriod" priority="1" timePeriod="today" dxfId="0"/></conditionalFormatting>
    <conditionalFormatting sqref="C2"><cfRule type="expression" priority="2" dxfId="0"><formula>DAY($A$1)=2</formula></cfRule></conditionalFormatting>
    <conditionalFormatting sqref="D2:D1048576"><cfRule type="top10" priority="3" rank="1" dxfId="0"/></conditionalFormatting>
    <conditionalFormatting sqref="E2"><cfRule type="colorScale" priority="4"><colorScale>
      <cfvo type="formula" val="$A$1"/><cfvo type="formula" val="$A$1+2"/><color rgb="FF000000"/><color rgb="FFFFFFFF"/>
    </colorScale></cfRule></conditionalFormatting></worksheet>`);
  zip.file('xl/worksheets/clock.xml', '<worksheet><sheetData><row r="1"><c r="A1"><f>TODAY()</f></c>'
    + '<c r="B1"><f>NOW()</f></c></row></sheetData></worksheet>');
  if (clockOffscreen) {
    zip.file('xl/worksheets/calendar.xml', '<worksheet><sheetData><row r="1"><c r="A1" t="str"><v>Static</v></c></row>'
      + '<row r="1048576"><c r="XFD1048576" s="1"><f>\'Clock Source\'!A1</f></c></row></sheetData></worksheet>');
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
