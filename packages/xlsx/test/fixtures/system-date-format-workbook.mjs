import JSZip from 'jszip';

export async function createSystemDateFormatWorkbook(date1904 = false) {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', `<workbook><workbookPr date1904="${Number(date1904)}"/>
    <sheets><sheet name="Formats" sheetId="1" r:id="sheet"/></sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="sheet" Target="worksheets/sheet.xml"/></Relationships>');
  zip.file('xl/styles.xml', String.raw`<styleSheet><numFmts>
    <numFmt numFmtId="164" formatCode="[$-F800]dddd\,\ mmmm\ dd\,\ yyyy"/>
    <numFmt numFmtId="165" formatCode="[$-F400]h:mm:ss AM/PM"/>
    </numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="165"/></cellXfs>
    <dxfs><dxf><numFmt numFmtId="166" formatCode="[Blue][$-F400]h:mm:ss AM/PM"/></dxf></dxfs></styleSheet>`);
  zip.file('xl/worksheets/sheet.xml', `<worksheet><sheetFormatPr defaultColWidth="37"/><sheetData>
    <row r="1"><c r="A1" s="1"><v>60.5</v></c><c r="B1" s="2"><f>TIME(14,30,45)</f></c>
    <c r="C1" s="1"><f>DATE(2030,1,1)</f><v>${date1904 ? 43889 : 45351}</v></c>
    <c r="D1"><f>DATE(2024,3,10)+TIME(2,30,45)</f></c></row>
    <row r="5"><c r="A5" s="1" t="d"><v>2024-02-29T14:30:45</v></c></row>
    <row r="1048576"><c r="XFD1048576" s="1"><f>DATE(9999,12,31)+TIME(23,59,59)</f></c></row>
    </sheetData><mergeCells><mergeCell ref="A5:BL1500"/></mergeCells>
    <conditionalFormatting sqref="D1"><cfRule type="cellIs" operator="greaterThan" priority="1" dxfId="0">
    <formula>0</formula></cfRule></conditionalFormatting></worksheet>`);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
