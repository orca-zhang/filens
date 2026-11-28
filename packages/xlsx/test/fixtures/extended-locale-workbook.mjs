import JSZip from 'jszip';

export async function createExtendedLocaleWorkbook(date1904 = false) {
  const zip = new JSZip();
  const era = '[$-ja-JP-x-gannen]ggge&quot;年&quot;m&quot;月&quot;d&quot;日&quot;';
  const thai = '[$-th-TH,0D07]dd-mm-yyyy';
  const russianGenitive = '[$-ru-RU-x-genlower]d mmmm yyyy';
  const russianNominative = '[$-ru-RU-x-nomlower]d mmmm yyyy';
  const russianUpper = '[$-ru-RU-x-genupper]d mmmm yyyy';
  zip.file('xl/workbook.xml', `<workbook><workbookPr date1904="${Number(date1904)}"/>
    <sheets><sheet name="Formats" sheetId="1" r:id="sheet"/></sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="sheet" Target="worksheets/sheet.xml"/></Relationships>');
  zip.file('xl/styles.xml', `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
     xmlns:fmt="http://schemas.microsoft.com/office/spreadsheetml/2015/02/main" xmlns:other="urn:unrelated">
    <numFmts>
      <numFmt numFmtId="164" formatCode="0" fmt:formatCode16="${era}"/>
      <numFmt numFmtId="165" formatCode="yyyy/mm/dd" other:formatCode16="0" fmt:formatCode16="${thai}"/>
      <numFmt numFmtId="166" formatCode="0" fmt:formatCode16="[$-x-sysdate]mmmm d, yyyy"/>
      <numFmt numFmtId="167" formatCode="0.00" other:formatCode16="[$-th-TH,0D00]0"/>
      <numFmt numFmtId="169" formatCode="yyyy/mm/dd" fmt:formatCode16="${russianGenitive}"/>
      <numFmt numFmtId="170" formatCode="yyyy/mm/dd" fmt:formatCode16="${russianNominative}"/>
    </numFmts>
    <cellXfs><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="165"/><xf numFmtId="166"/><xf numFmtId="167"/>
      <xf numFmtId="169"/><xf numFmtId="170"/></cellXfs>
    <dxfs>
      <dxf><numFmt numFmtId="168" formatCode="0.0" fmt:formatCode16="[Blue][$-x-systime]h:mm:ss"/></dxf>
      <dxf><numFmt numFmtId="171" formatCode="0" fmt:formatCode16="[Red]${russianUpper}"/></dxf>
    </dxfs>
    </styleSheet>`);
  zip.file('xl/worksheets/sheet.xml', `<worksheet><sheetFormatPr defaultColWidth="34"/><sheetData>
    <row r="1">
      <c r="A1" s="1"><f>DATE(2019,5,1)</f></c>
      <c r="B1" s="2"><f>DATE(2020,2,11)</f><v>${date1904 ? 42410 : 43872}</v></c>
      <c r="C1"><f>TEXT(A1,"[$-ja-JP-x-gannen]ggge")</f></c>
      <c r="D1" s="3"><f>DATE(2024,2,29)</f></c>
      <c r="E1"><f>TIME(14,30,45)</f></c>
      <c r="F1" s="4"><v>42</v></c>
    </row>
    <row r="2">
      <c r="A2" s="1"><f>DATE(2019,4,30)</f></c>
      <c r="B2"><f>B1+1</f></c>
      <c r="C2"><f>TEXT(B1,"${thai}")</f></c>
    </row>
    <row r="3">
      <c r="A3" s="5"><f>DATE(2024,2,29)</f></c>
      <c r="B3" s="6" t="d"><v>2024-02-29</v></c>
      <c r="C3"><f>TEXT(A3,"${russianUpper}")</f></c>
      <c r="D3"><f>A3</f><v>${date1904 ? 43889 : 45351}</v></c>
    </row>
    <row r="5"><c r="A5" s="1" t="d"><v>2024-05-28</v></c></row>
    <row r="1048576"><c r="XFB1048576"><f>A3</f></c><c r="XFC1048576" s="1"><f>DATE(2019,5,1)</f></c>
      <c r="XFD1048576" s="2"><f>DATE(2024,2,29)</f></c></row>
    </sheetData><mergeCells><mergeCell ref="A5:BL1500"/></mergeCells>
    <conditionalFormatting sqref="E1"><cfRule type="cellIs" operator="greaterThan" priority="1" dxfId="0">
      <formula>0</formula></cfRule></conditionalFormatting>
    <conditionalFormatting sqref="D3 XFB1048576"><cfRule type="cellIs" operator="greaterThan" priority="2" dxfId="1">
      <formula>0</formula></cfRule></conditionalFormatting></worksheet>`);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
