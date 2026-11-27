import JSZip from 'jszip';

const escapeXml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;');
const cell = (ref, value, type = 'str') => `<c r="${ref}" t="${type}"><v>${escapeXml(value)}</v></c>`;
const formula = (ref, expression, attrs = '', cached = '') =>
  `<c r="${ref}"${attrs}><f>${escapeXml(expression)}</f>${cached}</c>`;
const row = (index, ...cells) => `<row r="${index}">${cells.join('')}</row>`;
const worksheet = rows => `<worksheet><sheetFormatPr defaultColWidth="25"/><sheetData>${rows.join('')}</sheetData></worksheet>`;

export async function createTextFormulaWorkbook(date1904 = false) {
  const zip = new JSZip();
  const source = "'Data''s Text'!";
  zip.file('xl/workbook.xml', `<workbook><workbookPr date1904="${Number(date1904)}"/><sheets>
    <sheet name="Labels" sheetId="1" r:id="rId1"/><sheet name="Data's Text" sheetId="2" r:id="rId2"/>
    </sheets><definedNames><definedName name="Tags">${source}$A:$A</definedName>
    <definedName name="Pair">${source}$B$1:$C$2</definedName></definedNames></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<Relationships>
    <Relationship Id="rId1" Target="worksheets/labels.xml"/>
    <Relationship Id="rId2" Target="worksheets/inputs.xml"/></Relationships>`);
  zip.file('xl/styles.xml', '<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="0"><alignment wrapText="1"/></xf></cellXfs></styleSheet>');
  zip.file('xl/worksheets/labels.xml', worksheet([
    row(1, formula('A1', `TEXT(${source}D1,"mmmm d, yyyy")`),
      formula('B1', '_xlfn.TEXTJOIN(" · ",TRUE,Tags)'), formula('C1', '_xlfn.TEXTJOIN("|",FALSE,Pair)'),
      formula('D1', `_xlfn.FORMULATEXT(${source}E3)`), formula('E1', 'TEXT("1234.567","$#,##0.00")'),
      formula('F1', 'TEXT(DATE(1904,1,1),"0")')),
    row(2, formula('A2', 'TRIM("  sku   04  ")&CHAR(10)&TEXT(321,"00000")', ' s="1"'),
      formula('B2', '_xlfn.TEXTJOIN("|",TRUE,{"A","";"B","C"},TRUE,0)'),
      formula('C2', `_xlfn.TEXTJOIN(",",FALSE,${source}F:F)`),
      formula('D2', '_xlfn.FORMULATEXT(D2)'),
      formula('E2', 'TEXT(4.34,"# ???/???")', ' t="str"', '<v xml:space="preserve">4  17/50 </v>'),
      formula('F2', `_xlfn.FORMULATEXT(${source}G1)`),
      formula('G2', `_xlfn.TEXTJOIN(${source}H1:I1,TRUE,{"a","b","c","d"})`)),
    row(3, formula('A3', '_xlfn.TEXTBEFORE("alpha--beta",{"-","--"},-1)'),
      `<c r="B3"><f t="array" ref="B3:B5">_xlfn.TEXTAFTER(${source}J1:J3,{":",": "},,,,"missing")</f></c>`,
      formula('C3', '_xlfn.TEXTBEFORE("none",":")', ' t="str"', '<v>saved</v>')),
    row(1048576, formula('XFD1048576', `_xlfn.TEXTJOIN(" | ",TRUE,Tags,TEXT(${source}D1048576,"0.00%"),_xlfn.TEXTBEFORE(${source}J1048576," / "))`))
  ]));
  zip.file('xl/worksheets/inputs.xml', worksheet([
    row(1, cell('A1', 'North'), cell('B1', 'R1C1'), cell('D1', '2024-02-29', 'd'), formula('G1', '1/0'),
      cell('H1', '/'), cell('I1', ':'), cell('J1', 'sku: Aurora')),
    row(2, cell('A2', 'South'), cell('C2', 'R2C2'), cell('D2', '1', 'n'),
      '<c r="E2"><f t="shared" si="0" ref="E2:E3">D2+1</f></c>', cell('J2', 'No separator')),
    row(3, cell('D3', '2', 'n'), '<c r="E3"><f t="shared" si="0"/></c>', cell('J3', '#DIV/0!', 'e')),
    row(1048576, cell('A1048576', 'Far'), formula('D1048576', '1/8'), cell('J1048576', 'Deep / Archive'))
  ]));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
