import JSZip from 'jszip';

export async function createRegionalNumberWorkbook() {
  const zip = new JSZip();
  const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const pkg = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const data = 'application/vnd.openxmlformats-officedocument.spreadsheetml';
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + [['workbook.xml', 'sheet.main'], ['styles.xml', 'styles'], ['worksheets/sheet.xml', 'worksheet']].map(([name, type]) =>
      `<Override PartName="/xl/${name}" ContentType="${data}.${type}+xml"/>`).join('') + '</Types>');
  zip.file('_rels/.rels', `<Relationships xmlns="${pkg}"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file('xl/workbook.xml', `<workbook xmlns="${main}" xmlns:r="${rel}"><sheets><sheet name="Regional" sheetId="1" r:id="sheet"/></sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<Relationships xmlns="${pkg}"><Relationship Id="sheet" Type="${rel}/worksheet" Target="worksheets/sheet.xml"/>`
    + `<Relationship Id="styles" Type="${rel}/styles" Target="styles.xml"/></Relationships>`);
  zip.file('xl/styles.xml', `<styleSheet xmlns="${main}"><numFmts count="3">`
    + '<numFmt numFmtId="164" formatCode="&quot;v1.2, total &quot;#,##0.00\\."/>'
    + '<numFmt numFmtId="165" formatCode="yyyy.mm.dd"/>'
    + '<numFmt numFmtId="166" formatCode="0.0?e+?0"/>'
    + '</numFmts><cellXfs count="6">'
    + [0, 4, 164, 165, 44, 166].map(numFmtId => `<xf numFmtId="${numFmtId}" applyNumberFormat="1"/>`).join('')
    + '</cellXfs><dxfs count="1"><dxf><numFmt numFmtId="167" formatCode="[Red]#,##0.00&quot; Q1.2&quot;"/></dxf></dxfs></styleSheet>');
  zip.file('xl/worksheets/sheet.xml', `<worksheet xmlns="${main}"><sheetFormatPr defaultColWidth="18"/><sheetData>`
    + '<row r="1"><c r="A1" s="1"><v>1234.56</v></c><c r="B1"><f>TEXT(A1,"#,##0.00")</f></c>'
    + '<c r="C1" s="1"><f>A1*2</f><v>2469.12</v></c><c r="D1" s="2"><v>1234.56</v></c><c r="E1" s="3"><v>45351</v></c>'
    + '<c r="F1" s="4"><v>1234.5</v></c><c r="G1" t="inlineStr" s="1"><is><t>1234.56</t></is></c>'
    + '<c r="H1"><v>5.25</v></c><c r="I1" s="5"><v>1200</v></c></row>'
    + '<row r="1048576"><c r="XFD1048576"><f>A1+H1</f></c></row>'
    + '</sheetData><conditionalFormatting sqref="XFD1048576"><cfRule type="expression" priority="1" dxfId="0"><formula>TRUE</formula></cfRule>'
    + '</conditionalFormatting></worksheet>');
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
