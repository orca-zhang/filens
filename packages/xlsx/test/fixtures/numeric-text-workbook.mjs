import JSZip from 'jszip';

export async function createNumericTextWorkbook(date1904 = false) {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', `<workbook><workbookPr date1904="${Number(date1904)}"/><sheets>
    <sheet name="Summary" sheetId="1" r:id="rId1"/><sheet name="Input Data" sheetId="2" r:id="rId2"/>
  </sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<Relationships>
    <Relationship Id="rId1" Target="worksheets/sheet1.xml"/>
    <Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>`);
  zip.file('xl/styles.xml', `<styleSheet><numFmts><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm"/></numFmts>
    <cellXfs><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs>
    <dxfs><dxf><fill><patternFill><bgColor rgb="FFDCFCE7"/></patternFill></fill></dxf></dxfs>
  </styleSheet>`);
  zip.file('xl/worksheets/sheet1.xml', `<worksheet><sheetFormatPr defaultColWidth="19"/><sheetData>
    <row r="1">
      <c r="A1"><f>_xlfn.NUMBERVALUE("2.500,27",",",".")</f></c>
      <c r="B1"><f>_xlfn.NUMBERVALUE("1,25")</f></c>
      <c r="C1"><f>VALUE("1,234")</f></c>
      <c r="D1" s="1"><f>VALUE("2024-02-29 12:00:00")</f></c>
      <c r="E1"><f>_xlfn.NUMBERVALUE("bad")</f><v>71</v></c>
      <c r="F1"><f>_xlfn.NUMBERVALUE("3.2,1",".",",")</f></c>
      <c r="G1"><f>_xlfn.NUMBERVALUE("9%%")</f></c>
    </row>
    <row r="2"><c r="A2"><f>D1</f></c><c r="B2"><f t="array" ref="B2:B4">_xlfn.NUMBERVALUE('Input Data'!A1:A3,",",".")</f></c></row>
    <row r="1048576"><c r="XFD1048576"><f>ROUND(_xlfn.NUMBERVALUE('Input Data'!XFD1048576,",",".")+SUM(B2:B3),2)</f></c></row>
  </sheetData>
  <conditionalFormatting sqref="B2:B4 XFD1048576">
    <cfRule type="cellIs" dxfId="0" priority="1" operator="greaterThan"><formula>2500</formula></cfRule>
  </conditionalFormatting></worksheet>`);
  zip.file('xl/worksheets/sheet2.xml', `<worksheet><sheetData>
    <row r="1"><c r="A1" t="str"><v>2.500,27</v></c></row>
    <row r="2"><c r="A2" t="str"><v xml:space="preserve"> 3 000 </v></c></row>
    <row r="3"><c r="A3" t="e"><v>#N/A</v></c></row>
    <row r="1048576"><c r="XFD1048576" t="str"><v>1.000,02</v></c></row>
  </sheetData></worksheet>`);
  zip.forEach((_path, entry) => { entry.date = new Date('2024-01-01T00:00:00Z'); });
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
