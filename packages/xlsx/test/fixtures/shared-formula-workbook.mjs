import JSZip from 'jszip';

export async function createSharedFormulaWorkbook() {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="Summary" sheetId="1" r:id="r1"/>'
    + '<sheet name="Rates 2026" sheetId="2" r:id="r2"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/>'
    + '<Relationship Id="r2" Target="worksheets/sheet2.xml"/></Relationships>');
  zip.file('xl/styles.xml', '<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="2"/></cellXfs></styleSheet>');
  zip.file('xl/worksheets/sheet1.xml', '<worksheet><sheetData>'
    // Some writers emit followers before their master in XML.
    + '<row r="4"><c r="A4"><v>6</v></c><c r="D4"><f t="shared" si="0"/><v/></c></row>'
    + '<row r="1"><c r="B1"><v>3</v></c><c r="C1"><v>10</v></c><c r="D1"><v>20</v></c>'
    + '<c r="XFC1"><f t="shared" si="6" ref="XFC1:XFD1048576">$A1+SUM(\'Rates 2026\'!$A1,$B$1)</f></c></row>'
    + '<row r="2"><c r="A2"><v>2</v></c>'
    + '<c r="D2"><f t="shared" si="0" ref="D2:E1048576">SUM($A2,C$1,\'Rates 2026\'!A2)*$B$1</f></c>'
    + '<c r="E2"><f t="shared" si="0"/></c><c r="F2"><f>D4+1</f></c>'
    + '<c r="G2"><f t="shared" si="4" ref="G2:G3">UNKNOWN(A2,"A2")</f></c>'
    + '<c r="J2"><f t="shared" si="5" ref="J2:J3">IFERROR(SUM(A1048575:A1048576),42)</f></c></row>'
    + '<row r="3"><c r="A3"><v>4</v></c><c r="D3"><f t="shared" si="0"/><v>99</v></c>'
    + '<c r="E3" t="str"><f t="shared" si="0"/><v/></c>'
    + '<c r="G3"><f t="shared" si="4"/></c><c r="J3"><f t="shared" si="5"/></c></row>'
    + '<row r="1048576"><c r="A1048576"><v>7</v></c><c r="XFD1048576" s="1"><f t="shared" si="6"/></c></row>'
    + '</sheetData></worksheet>');
  zip.file('xl/worksheets/sheet2.xml', '<worksheet><sheetData>'
    + '<row r="1"><c r="A1"><v>1</v></c><c r="C1"><f t="shared" si="0" ref="C1:C2">A1*2</f></c></row>'
    + '<row r="2"><c r="A2"><v>7</v></c><c r="B2"><v>8</v></c><c r="C2"><f t="shared" si="0"/></c></row>'
    + '<row r="3"><c r="A3"><v>5</v></c></row><row r="4"><c r="A4"><v>9</v></c></row>'
    + '<row r="1048576"><c r="A1048576"><v>2</v></c></row></sheetData></worksheet>');
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
