import JSZip from 'jszip';

export async function createDateFormulaWorkbook(date1904 = false) {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', `<workbook><workbookPr date1904="${Number(date1904)}"/><sheets>
    <sheet name="Calendar" sheetId="1" r:id="rId1"/><sheet name="Input Dates" sheetId="2" r:id="rId2"/>
    </sheets><definedNames><definedName name="CloseOfMonth">EOMONTH('Input Dates'!$A$1048576,1)</definedName>
    <definedName name="HolidayDates">'Input Dates'!$B:$B</definedName></definedNames></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships>'
    + '<Relationship Id="rId1" Target="worksheets/calendar.xml"/><Relationship Id="rId2" Target="worksheets/inputs.xml"/></Relationships>');
  zip.file('xl/styles.xml', `<styleSheet><numFmts>
    <numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm:ss"/>
    <numFmt numFmtId="166" formatCode="hh:mm:ss"/></numFmts>
    <cellXfs><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="165"/><xf numFmtId="166"/></cellXfs>
    <dxfs><dxf><font><color rgb="FF008000"/></font></dxf></dxfs></styleSheet>`);
  zip.file('xl/worksheets/calendar.xml', `<worksheet><sheetFormatPr defaultColWidth="25"/><sheetData>
    <row r="1"><c r="A1" s="1"><f>DATE(2024,2,29)</f></c><c r="B1" s="1"><f>CloseOfMonth</f></c>
      <c r="C1"><f>WEEKDAY('Input Dates'!A1048576,2)</f></c>
      <c r="D1" s="1"><f>DATE(2024,2,1)</f><v>${date1904 ? 43889 : 45351}</v></c>
      <c r="E1" s="3"><f>TIME(25,61,61)</f></c><c r="F1"><f>IFERROR(EDATE(A1,100000),"invalid")</f></c></row>
    <row r="2"><c r="A2"><f>DATE(1904,1,1)</f></c><c r="B2"><f>WEEKDAY(0)</f></c></row>
    <row r="3"><c r="A3"><f>NETWORKDAYS(A1,DATE(2024,3,6),'Input Dates'!B:B)</f></c>
      <c r="B3" s="1"><f>_xlfn.WORKDAY.INTL(A1,2,"0000110",HolidayDates)</f></c>
      <c r="C3" s="1"><f>WORKDAY(DATE(2024,3,6),-2,HolidayDates)</f></c>
      <c r="D3"><f>_xlfn.NETWORKDAYS.INTL(A1,DATE(2024,3,5),,HolidayDates)</f></c>
      <c r="E3" s="1"><f>WORKDAY(A1,1,HolidayDates)</f><v>${date1904 ? 43890 : 45352}</v></c>
      <c r="F3"><f>IFERROR(WORKDAY.INTL(A1,1,"1111111"),"invalid weekend")</f></c></row>
    <row r="1048576"><c r="XFC1048576" s="1"><f>WORKDAY(A1,1,'Input Dates'!B:B)</f></c>
      <c r="XFD1048576" s="2"><f>EDATE('Input Dates'!A1048576,12)+TIME(23,59,59)</f></c></row>
    </sheetData><conditionalFormatting sqref="A1"><cfRule type="expression" priority="1" dxfId="0">
    <formula>WEEKDAY(A1,2)=4</formula></cfRule></conditionalFormatting></worksheet>`);
  zip.file('xl/worksheets/inputs.xml', `<worksheet><sheetData>
    <row r="1"><c r="B1" t="d"><v>2024-03-01</v></c></row>
    <row r="4"><c r="B4" t="d"><v>2024-03-01T18:00:00</v></c></row>
    <row r="7"><c r="B7" t="d"><v>2024-03-02</v></c></row>
    <row r="1048576"><c r="A1048576" t="d"><v>2024-02-29T22:10:45</v></c>
      <c r="B1048576" t="d"><v>2024-03-04</v></c></row></sheetData></worksheet>`);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
