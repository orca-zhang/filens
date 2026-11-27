import JSZip from 'jszip';

export async function createLocaleDateWorkbook(date1904 = false) {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', `<workbook><workbookPr date1904="${Number(date1904)}"/><sheets>
    <sheet name="Dates" sheetId="1" r:id="primary"/><sheet name="Input Dates" sheetId="2" r:id="input"/>
    </sheets><definedNames><definedName name="RegionalDate">DATEVALUE('Input Dates'!$A$1048576)</definedName></definedNames></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships>'
    + '<Relationship Id="primary" Target="worksheets/dates.xml"/><Relationship Id="input" Target="worksheets/input.xml"/></Relationships>');
  zip.file('xl/styles.xml', `<styleSheet><numFmts>
    <numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="hh:mm:ss"/>
    <numFmt numFmtId="166" formatCode="yyyy-mm-dd hh:mm:ss"/></numFmts>
    <cellXfs><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="165"/><xf numFmtId="166"/></cellXfs></styleSheet>`);
  zip.file('xl/worksheets/dates.xml', `<worksheet><sheetFormatPr defaultColWidth="22"/><sheetData>
    <row r="1"><c r="A1" s="1"><f>RegionalDate</f></c><c r="B1" s="2"><f>TIMEVALUE("29 Feb 2024 4:30 PM")</f></c>
    <c r="C1"><f>DAY("February 29, 2024")</f></c>
    <c r="D1" s="1"><f>WORKDAY("29 February 2024",1,{"1 March 2024"})</f></c>
    <c r="E1" s="3"><f>DATEVALUE("2024-02-29T16:30:00")+TIMEVALUE("2024-02-29T16:30:00")</f></c>
    <c r="F1" s="1"><f>DATEVALUE("01/02/2024")</f><v>${date1904 ? 43830 : 45292}</v></c></row>
    <row r="2"><c r="A2" s="1"><f>DATEVALUE("29-Feb")</f></c><c r="B2"><f>IFERROR(DAY(A2)=29,0)+0</f></c>
    <c r="C2"><f>DATEVALUE(1)</f></c><c r="D2"><f>TIMEVALUE("0.5")</f></c>
    <c r="E2"><f>TIMEVALUE("2024-02-29T06:30:00")=TIME(6,30,0)</f></c><c r="F2"><f>HOUR("12:50:00 PM")-8</f></c></row>
    <row r="1048576"><c r="XFD1048576" s="1"><f>RegionalDate</f></c></row>
    </sheetData></worksheet>`);
  zip.file('xl/worksheets/input.xml', '<worksheet><sheetData><row r="1048576"><c r="A1048576" t="str"><v>01/02/2024</v></c></row></sheetData></worksheet>');
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
