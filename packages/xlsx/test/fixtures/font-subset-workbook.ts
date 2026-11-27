import JSZip from 'jszip';

export async function createFontSubsetWorkbook(repeats = 1) {
  const zip = new JSZip();
  const sheets = ['Text', 'Hidden', 'Formulas'];
  zip.file('xl/workbook.xml', '<workbook><sheets>' + sheets.map((name, index) =>
    `<sheet name="${name}" sheetId="${index + 1}" r:id="${name}"/>`).join('') + '</sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships>' + sheets.map(name =>
    `<Relationship Id="${name}" Target="worksheets/${name}.xml"/>`).join('') + '</Relationships>');
  const families = ['Noto Sans JP', 'Noto Sans TC', 'Noto Sans SC', 'Noto Sans SC', 'Noto Sans KR'];
  zip.file('xl/styles.xml', '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="0&quot;年&quot;"/>'
    + '<numFmt numFmtId="165" formatCode="0;0;0;&quot;本&quot;@&quot;語&quot;"/>'
    + '<numFmt numFmtId="166" formatCode="0&quot;件&quot;"/></numFmts><fonts>'
    + families.map((family, index) => `<font><name val="${family}"/>${index === 3 ? '<b/>' : ''}</font>`).join('')
    + '</fonts><cellXfs><xf fontId="0"/><xf fontId="1"/><xf fontId="2"/><xf fontId="3"/><xf fontId="4"/>'
    + '<xf fontId="0" numFmtId="164"/><xf fontId="0" numFmtId="165"/></cellXfs>'
    + '<dxfs><dxf><font><b/></font></dxf><dxf><numFmt numFmtId="166" formatCode="0&quot;件&quot;"/></dxf></dxfs></styleSheet>');
  zip.file('xl/sharedStrings.xml', '<sst><si><t>日本語</t></si><si>'
    + '<r><t>日</t></r><r><rPr><rFont val="Noto Emoji"/><b val="0"/><i val="0"/></rPr><t>😀</t></r>'
    + '</si></sst>');
  zip.file('xl/worksheets/Text.xml', '<worksheet><sheetFormatPr defaultColWidth="12"/><sheetData><row r="1">'
    + '<c r="A1" t="s"><v>0</v></c><c r="B1" s="6" t="s"><v>1</v></c><c r="C1" s="5"><f>2026</f><v>2026</v></c>'
    + '<c r="D1" s="1" t="inlineStr"><is><t>繁體</t></is></c><c r="E1" s="2" t="inlineStr"><is><t>简体</t></is></c>'
    + '<c r="F1" s="3" t="inlineStr"><is><t>标题</t></is></c><c r="G1" s="4"><v>25</v></c></row>'
    + Array.from({ length: repeats }, (_, index) => {
      const row = index + 2;
      return `<row r="${row}"><c r="A${row}" t="s"><v>0</v></c><c r="B${row}" s="6" t="s"><v>1</v></c></row>`;
    }).join('') + '</sheetData>'
    + '<conditionalFormatting sqref="E1"><cfRule type="expression" priority="1" dxfId="0"><formula>1</formula></cfRule></conditionalFormatting>'
    + '<conditionalFormatting sqref="G1"><cfRule type="expression" priority="2" dxfId="1"><formula>1</formula></cfRule></conditionalFormatting>'
    + '</worksheet>');
  zip.file('xl/worksheets/Hidden.xml', '<worksheet><sheetData><row r="1048576"><c r="XFC1048576" s="1">'
    + '<f>"漢"</f></c><c r="XFD1048576" t="inlineStr"><is><t>遠</t></is></c></row></sheetData></worksheet>');
  zip.file('xl/worksheets/Formulas.xml', '<worksheet><sheetViews><sheetView showFormulas="1"/></sheetViews>'
    + '<sheetData><row r="1"><c r="A1"><f t="shared" ref="A1:A2" si="0">"大阪"&amp;B1</f></c></row>'
    + '<row r="2"><c r="A2"><f t="shared" si="0"/></c></row></sheetData></worksheet>');
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
