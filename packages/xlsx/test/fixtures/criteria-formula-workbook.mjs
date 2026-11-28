import JSZip from 'jszip';

const escapeXml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const row = (index, ...cells) => `<row r="${index}">${cells.join('')}</row>`;
const scalar = (ref, value, type = 'n') => `<c r="${ref}" t="${type}"><v>${escapeXml(value)}</v></c>`;
const formula = (ref, value, attrs = '', cache = '') => `<c r="${ref}"${attrs}><f>${escapeXml(value)}</f>${cache}</c>`;
const spill = (ref, range, value, dynamic = false) =>
  `<c r="${ref}"${dynamic ? ' cm="1"' : ''}><f t="array" ref="${range}">${escapeXml(value)}</f></c>`;
const worksheet = (rows, tail = '') => '<worksheet><sheetFormatPr defaultColWidth="16"/><sheetData>' + rows.join('')
  + '</sheetData>' + tail + '</worksheet>';

export async function createCriteriaFormulaWorkbook() {
  const zip = new JSZip(), names = ['Totals', "Team's Ledger", 'Rates', 'Array Criteria', 'Large Criteria'];
  const ledger = "'Team''s Ledger'!";
  zip.file('xl/workbook.xml', '<workbook><sheets>' + names.map((name, i) =>
    `<sheet name="${name}" sheetId="${i + 1}" r:id="s${i + 1}"/>`).join('') + '</sheets>'
    + `<definedNames><definedName name="Departments">${ledger}$A:$A</definedName></definedNames></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships>' + names.map((_, i) =>
    `<Relationship Id="s${i + 1}" Target="worksheets/s${i + 1}.xml"/>`).join('')
    + '<Relationship Id="meta" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sheetMetadata" Target="metadata.xml"/>'
    + '</Relationships>');
  zip.file('xl/metadata.xml', '<metadata xmlns:xda="http://schemas.microsoft.com/office/spreadsheetml/2017/dynamicarray">'
    + '<metadataTypes><metadataType name="XLDAPR"/></metadataTypes>'
    + '<futureMetadata name="XLDAPR"><bk><extLst><ext><xda:dynamicArrayProperties fDynamic="1"/></ext></extLst></bk></futureMetadata>'
    + '<cellMetadata><bk><rc t="1" v="0"/></bk></cellMetadata></metadata>');
  zip.file('xl/styles.xml', '<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="4"/></cellXfs>'
    + '<dxfs><dxf><fill><patternFill><bgColor rgb="FFDCFCE7"/></patternFill></fill></dxf></dxfs></styleSheet>');
  zip.file('xl/worksheets/s1.xml', worksheet([
    row(1, formula('A1', 'COUNTIF(Departments,"east")'),
      formula('B1', `SUMIFS(${ledger}C:C,Departments,"east",${ledger}B:B,"closed")`),
      formula('C1', `AVERAGEIFS(${ledger}C:C,Departments,"east",${ledger}B:B,"closed")`),
      formula('D1', `_xlfn.MINIFS(${ledger}C:C,Departments,"east",${ledger}B:B,"open")`),
      formula('E1', `_xlfn.MAXIFS(${ledger}C:C,Departments,"east",${ledger}B:B,"closed")`),
      formula('F1', `COUNTIFS(Departments,"",${ledger}B:B,"<>closed")`),
      formula('G1', 'COUNTIF(Departments,"east~*")'),
      formula('H1', `SUMIF(${ledger}A1:A4,"east*",Rates!D2)`),
      formula('I1', `AVERAGEIF(${ledger}A1:A4,"east*",Rates!D2:D2)`)),
    row(2, formula('A2', 'COUNTIF(Departments,"#N/A")'),
      formula('B2', `IFERROR(SUMIF(Departments,"<>east",${ledger}C:C),"bad")`),
      formula('C2', 'SUMIFS(Rates!D2:D3,Departments,"east")'),
      formula('D2', `AVERAGEIF(Departments,"absent",${ledger}C:C)`),
      formula('E2', `SUMIF(Departments,"east",${ledger}C:C)`, '', '<v>77</v>'),
      formula('F2', 'COUNTIF(Missing!A:A,"")'),
      formula('G2', `COUNTIFS(Departments,"<>East",${ledger}B:B,"<>open")`)),
    row(1048576, formula('XFD1048576', `SUMIF(Departments,"east",${ledger}C:C)+COUNTIF(Departments,"east*")`, ' s="1"'))
  ]));
  zip.file('xl/worksheets/s2.xml', worksheet([
    row(1, scalar('A1', 'East', 'str'), scalar('B1', 'closed', 'str'), scalar('C1', 12)),
    row(2, scalar('A2', 'east', 'str'), scalar('B2', 'open', 'str'), scalar('C2', 9)),
    row(3, scalar('A3', 'West', 'str'), scalar('B3', 'closed', 'str'), scalar('C3', 0)),
    row(4, scalar('A4', 'East*', 'str'), scalar('B4', 'closed', 'str'), scalar('C4', 30, 'str')),
    row(5, scalar('B5', 'closed', 'str'), formula('C5', '2+5')),
    row(6, formula('A6', 'IF(FALSE,"unused","")', ' t="str"'), scalar('B6', 'void', 'str'), scalar('C6', -3)),
    row(7, scalar('A7', '#N/A', 'e'), scalar('B7', 'closed', 'str'), formula('C7', '1/0')),
    row(8, scalar('A8', 'EasT', 'str'), scalar('B8', 'closed', 'str'), scalar('C8', 1, 'b')),
    row(1048576, scalar('A1048576', 'EaSt', 'str'), scalar('B1048576', 'closed', 'str'), formula('C1048576', 'Rates!A1*2'))
  ]));
  zip.file('xl/worksheets/s3.xml', worksheet([
    row(1, scalar('A1', 10)), row(2, scalar('D2', 3)), row(3, scalar('D3', 8)), row(4, scalar('D4', 80)), row(5, scalar('D5', 10))
  ]));
  const amounts = ledger + 'C:C', status = ledger + 'B:B';
  const count = `COUNTIFS(Departments,"east",${status},IF(Rates!A:XFD=0,"closed","open"))`;
  zip.file('xl/worksheets/s4.xml', worksheet([
    row(1, spill('A1', 'A1:A3', `SUMIF(Departments,{"east";"west";"absent"},${amounts})`),
      spill('C1', 'C1:D2', `SUMIFS(${amounts},Departments,{"east","west"},${status},{"closed";"open"})`),
      spill('F1', 'F1:G2', `COUNTIFS(Departments,{"east","west"},${status},{"closed";"open"})`)),
    row(4, spill('A4', 'A4:C4', `AVERAGEIF(Departments,{"west","absent",#N/A},${amounts})`),
      spill('E4', 'E4:E5', `AVERAGEIFS(${amounts},Departments,{"east";"west"},${status},"closed")`)),
    row(6, spill('A6', 'A6:C6', `_xlfn.MINIFS(${amounts},Departments,{"east","west","absent"},${status},"open")`),
      spill('E6', 'E6:F6', `_xlfn.MAXIFS(${amounts},Departments,{"east","west"},${status},"closed")`)),
    row(7, spill('A7', 'A7:C7', `SUMIFS(${amounts},Departments,{"east","west","absent"},${status},{"closed","open"})`)),
    row(8, formula('A8', `SUM(COUNTIFS(Departments,{"east","west"},${status},{"closed";"open"}))`),
      formula('B8', `SUM(SUMIFS(${amounts},Departments,{"east","west"},${status},{"closed";"open"}))`),
      formula('C8', `SUM(${count})`), formula('D8', "SUM(_xlfn.ANCHORARRAY('Large Criteria'!A1))"))
  ]));
  zip.file('xl/worksheets/s5.xml', worksheet([row(1, spill('A1', 'A1:XFD1048576', count, true))],
    '<conditionalFormatting sqref="XFD1048576"><cfRule type="cellIs" operator="equal" priority="1" dxfId="0">'
    + '<formula>3</formula></cfRule></conditionalFormatting>'));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
