import JSZip from 'jszip';

const row = (index, ...cells) => `<row r="${index}">${cells.join('')}</row>`;
const value = (address, content, type = 'n') => `<c r="${address}" t="${type}"><v>${content}</v></c>`;
const formula = (address, expression) => `<c r="${address}"><f>${expression}</f></c>`;
const spill = (address, ref, expression, cache = '', type = 'n', metadata = 0) =>
  `<c r="${address}" t="${type}"${metadata ? ` cm="${metadata}"` : ''}><f t="array" ref="${ref}">${expression}</f>${cache}</c>`;
const sheet = (...rows) => `<worksheet><sheetData>${rows.join('')}</sheetData></worksheet>`;

export async function createBroadcastWorkbook() {
  const zip = await JSZip.loadAsync(await createArraySpillWorkbook());
  zip.file('xl/worksheets/summary.xml', sheet(
    row(1, spill('A1', 'A1:B3', 'Ledger!A1:A3*Ledger!C1:D1', '', 'n', 2)),
    row(5, spill('A5', 'A5:C6', 'Ledger!A1:B2*{10,100,1000}', '', 'n', 2)),
    row(8, spill('A8', 'A8:C9', 'LEFT({"lima";"oslo"},{1,2,3})', '', 'str', 2))));
  zip.file('xl/worksheets/ledger.xml', sheet(
    row(1, value('A1', 2), value('B1', 7), value('C1', 3), value('D1', 5), value('XFD1', 131)),
    row(2, value('A2', 4), value('B2', 11)), row(3, value('A3', 6)),
    row(1048576, value('A1048576', 7))));
  zip.file('xl/worksheets/large.xml', sheet(
    row(1, formula('A1', 'SUM(_xlfn.TAKE((Ledger!A:A+1)*(Ledger!B1:XFD1+2),-1,-2))'),
      spill('B1', 'B1:XFD1048576', '(Ledger!A:A+1)*(Ledger!B1:XFD1+2)', '', 'n', 2)),
    row(2, formula('A2', 'INDEX(B1#,1048576,16383)')),
    row(3, formula('A3', 'SUM(_xlfn.TAKE(B1#,-1,-2))')),
    row(4, formula('A4', 'SUM(_xlfn.SEQUENCE(1048576,,5,0)+_xlfn.SEQUENCE(1,16384,2,0))'))));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createOrderedConditionalWorkbook() {
  const zip = await JSZip.loadAsync(await createArraySpillWorkbook());
  zip.file('xl/styles.xml', '<styleSheet><dxfs><dxf><fill><patternFill><bgColor rgb="FFDCFCE7"/></patternFill></fill></dxf></dxfs></styleSheet>');
  zip.file('xl/worksheets/summary.xml', sheet(row(1,
    spill('A1', 'A1:A4', '_xlfn.IFS(Ledger!A1:A4=1,"first",Ledger!A1:A4=2,FALSE,Ledger!A1:A4=3,NA())', '', 'str', 2),
    spill('B1', 'B1:B4', '_xlfn.SWITCH(Ledger!A1:A4,1,"red",2,TRUE,3,NA(),"missing")', '', 'str', 2),
    '<c r="C1"><f>_xlfn.IFS(1/0,49)</f><v>42</v></c>')));
  zip.file('xl/worksheets/ledger.xml', sheet(row(1, value('A1', 1), value('B1', 7)),
    row(2, value('A2', 2)), row(3, value('A3', 3)), row(4, value('A4', 4)), row(1048576, value('XFD1048576', 19))));
  zip.file('xl/worksheets/large.xml', sheet(row(1, formula('A1', 'SUM(B1#)'),
    spill('B1', 'B1:XFD1048576', '_xlfn.IFS(Ledger!B:XFD>0,_xlfn.SWITCH(Ledger!B:XFD,7,77,19,99,4),TRUE,3)', '', 'n', 2)))
    .replace('</worksheet>', '<conditionalFormatting sqref="XFD1048576"><cfRule type="expression" dxfId="0" priority="1">'
      + '<formula>_xlfn.SWITCH(XFD1048576,99,TRUE,FALSE)</formula></cfRule></conditionalFormatting></worksheet>'));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createReferenceInfoWorkbook() {
  const zip = await JSZip.loadAsync(await createArraySpillWorkbook());
  const workbook = await zip.file('xl/workbook.xml').async('string');
  zip.file('xl/workbook.xml', workbook.replace('</definedNames>',
    '<definedName name="LedgerAreas">(Ledger!$A$1,Ledger!$B$1:$B$4)</definedName></definedNames>'));
  zip.file('xl/worksheets/summary.xml', sheet(
    row(1, formula('A1', "ISREF('Large Spill'!B1#)"), formula('B1', 'AREAS(LedgerAreas)'), formula('C1', 'ISREF(Ledger!A1)')),
    row(2, formula('A2', "TYPE(_xlfn.ANCHORARRAY('Large Spill'!B1))"), formula('B2', 'TYPE(Ledger!A2)'),
      formula('C2', 'SUMSQ(Ledger!A4:A7)')),
    row(3, spill('A3', 'A3:C3', 'ERROR.TYPE({#REF!,5,#N/A})', '', 'n', 2))));
  zip.file('xl/worksheets/ledger.xml', sheet(
    row(1, formula('A1', 'NOTIMPLEMENTED(1)'), value('B1', 7)), row(2, value('A2', 1, 'b')),
    row(4, value('A4', 7)), row(5, value('A5', '8', 'str')), row(6, value('A6', 1, 'b')), row(7, value('A7', -2)),
    row(1048576, value('XFC1048576', 19))));
  zip.file('xl/worksheets/large.xml', sheet(
    row(1, spill('B1', 'B1:XFC1048576', 'Ledger!B:XFC+2', '', 'n', 2)),
    row(1048576, formula('XFD1048576', 'IF(ISREF(B1#),TYPE(B1#)+AREAS((B1,B1#))+SUMSQ(B1#),NA())'))));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createReferenceOperatorsWorkbook() {
  const zip = await JSZip.loadAsync(await createReferenceInfoWorkbook());
  zip.file('xl/worksheets/summary.xml', sheet(
    row(1, formula('A1', "SUM('Large Spill'!B1# 'Large Spill'!XFC:XFC)"),
      formula('B1', 'ERROR.TYPE(Ledger!A1:A3 Ledger!B1:B3)'),
      formula('C1', 'AREAS((Ledger!B1,Ledger!XFC1048576) Ledger!B:XFC)'),
      formula('D1', 'SUM(Ledger!A1:B1 Ledger!B1:C1)')),
    row(2, formula('A2', "SUM(Ledger!A1:B1 'Large Spill'!A1:B1)"),
      formula('B2', '_xlfn.ANCHORARRAY((Ledger!B1,Ledger!XFC1048576))'))));
  zip.file('xl/worksheets/large.xml', sheet(
    row(1, spill('B1', 'B1:XFC1048576', 'Ledger!B:XFC+2', '', 'n', 2)),
    row(1048576, formula('XFD1048576', 'SUM((_xlfn.ANCHORARRAY(OFFSET(B1,0,0)) B:XFC,(B1)))'))));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createConditionalReferencesWorkbook() {
  const zip = await JSZip.loadAsync(await createReferenceOperatorsWorkbook());
  zip.file('xl/worksheets/summary.xml', sheet(
    row(1, formula('A1', "SUM(('Large Spill'!B1,IF(TRUE,'Large Spill'!B1#,NOTIMPLEMENTED(1))))"),
      formula('B1', 'SUM(Ledger!B1:SWITCH(2,1,Ledger!A1,2,Ledger!B4))'),
      formula('C1', 'ISREF(IFS(TRUE,Ledger!A1))')),
    row(2, formula('A2', "SUM(IFS(FALSE,Ledger!B:XFC,TRUE,'Large Spill'!B1#))"),
      formula('B2', 'AREAS((Ledger!B1,IFS(TRUE,Ledger!XFC1048576)))'),
      formula('C2', 'FORMULATEXT(IF(TRUE,Ledger!A1,Ledger!A2))'))));
  zip.file('xl/worksheets/large.xml', sheet(
    row(1, spill('B1', 'B1:XFC1048576', 'Ledger!B:XFC+2', '', 'n', 2)),
    row(1048576, formula('XFD1048576', 'SUM((SWITCH(1,1,INDEX(B1#,0,16382)),IFS(TRUE,Ledger!XFC1048576)))'))));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createImplicitIntersectionWorkbook() {
  const zip = await JSZip.loadAsync(await createReferenceInfoWorkbook());
  zip.file('xl/worksheets/ledger.xml', sheet(
    row(1, value('B1', 7), value('C1', '#N/A', 'e')), row(2, value('B2', 12)),
    row(1048576, value('XFC1048576', 19))));
  zip.file('xl/worksheets/summary.xml', sheet(
    row(1, formula('A1', 'Ledger!$B$1:$XFD$1'), formula('B1', 'Ledger!$B$1:$XFD$1+1'),
      formula('C1', 'Ledger!$B$1:$XFD$1'), formula('D1', 'Ledger!$B$1:$XFD$1')),
    row(2, formula('A2', '_xlfn.SINGLE(CHOOSE(1,Ledger!B:B,NA()))'), formula('B2', '@(Ledger!B:B+1)'),
      formula('C2', '@Ledger!B:B'), formula('D2', "SUM('Large Spill'!A1#)")),
    row(3, '<c r="A3"><f>@Ledger!B:B</f><v>42</v></c>')));
  zip.file('xl/worksheets/large.xml', sheet(
    row(1, spill('A1', 'A1:A1048576', 'Ledger!B:B', '', 'n', 2),
      spill('D1', 'D1:XFC1048576', 'Ledger!D:XFC+2', '', 'n', 2)),
    row(2, formula('B2', 'A1#'), formula('C2', '@A1#')),
    row(1048576, formula('XFD1048576', '@CHOOSE(1,INDEX(D1#,0,16380))+@Ledger!XFC:XFC'))));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createFormulaDisplayWorkbook() {
  const zip = await JSZip.loadAsync(await createArraySpillWorkbook());
  zip.file('xl/worksheets/ledger.xml', sheet(
    row(1, formula('A1', '$G$7:$G$9'), spill('B1', 'B1:B4', '_xlfn._xlws.SORT($G$7:$G$10)', '', 'n', 2)),
    row(2, formula('A2', '_xlfn.SINGLE((_xlfn.ANCHORARRAY(B1)%))')),
    row(3, formula('A3', '_xlfn.FUTURE("_xlpm.x",Table[_xlfn.SINGLE])')),
    row(4, '<c r="A4"><f t="shared" ref="A4:A5" si="1">_xlfn.LET(_xlpm.x,C4:C7,_xlpm.x)</f></c>'),
    row(5, '<c r="A5"><f t="shared" si="1"/></c>')));
  zip.file('xl/worksheets/summary.xml', sheet(
    row(1, formula('A1', 'FORMULATEXT(Ledger!A1)'), formula('B1', 'FORMULATEXT(Ledger!B1)')),
    row(2, formula('A2', 'FORMULATEXT(Ledger!A2)'), formula('B2', 'FORMULATEXT(Ledger!A3)')),
    row(3, formula('A3', 'FORMULATEXT(Ledger!A5)'))));
  zip.file('xl/worksheets/large.xml', sheet(
    row(1048576, formula('XFD1048576', 'FORMULATEXT(Ledger!$A$1)'))));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createCountBlankWorkbook() {
  const zip = await JSZip.loadAsync(await createArraySpillWorkbook());
  const workbook = await zip.file('xl/workbook.xml').async('string');
  zip.file('xl/workbook.xml', workbook.replace('</definedNames>',
    '<definedName name="LedgerCells">Ledger!$A:$A</definedName></definedNames>'));
  zip.file('xl/styles.xml', '<styleSheet><dxfs><dxf><fill><patternFill><bgColor rgb="FFDCFCE7"/></patternFill></fill></dxf></dxfs></styleSheet>');
  zip.file('xl/worksheets/summary.xml', sheet(
    row(1, formula('A1', 'COUNTBLANK(Ledger!A1:A8)'), formula('B1', 'COUNTBLANK(LedgerCells)'),
      formula('C1', 'COUNTBLANK(OFFSET(Ledger!A1,5,0,3))'), formula('D1', 'COUNTBLANK(INDEX(Ledger!A:A,6))')),
    row(2, formula('A2', 'COUNTBLANK(SpillValues)'), formula('B2', "COUNTBLANK('Large Spill'!C1#)"),
      formula('C2', "COUNTBLANK('Large Spill'!A:XFD)"))));
  zip.file('xl/worksheets/ledger.xml', sheet(
    row(1, value('A1', 0), value('B1', 2)), row(2, formula('A2', 'IF(FALSE,1,"")'), value('B2', '', 'str')),
    row(3, value('A3', ' ', 'str')), row(4, value('A4', 0, 'b')), row(5, formula('A5', 'NA()')),
    row(7, '<c r="A7" s="0"/>'), row(8, value('A8', '', 'str')), row(1048576, value('C1048576', 19))));
  zip.file('xl/worksheets/large.xml', sheet(
    row(1, spill('B1', 'B1:B1048576', '_xlfn.TAKE(Ledger!B:B,1048576)', '', 'n', 2),
      spill('C1', 'C1:C1048576', 'IF(Ledger!C:C=0,"",Ledger!C:C)', '', 'str', 2)),
    row(4, value('C4', 0)), row(1048576, formula('XFD1048576', 'COUNTBLANK(Ledger!A:XFD)')))
    .replace('</worksheet>', '<conditionalFormatting sqref="XFD1048576"><cfRule type="expression" dxfId="0" priority="1">'
      + '<formula>COUNTBLANK(LedgerCells)=1048572</formula></cfRule></conditionalFormatting></worksheet>'));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createXmatchWorkbook() {
  const zip = await JSZip.loadAsync(await createArraySpillWorkbook());
  const fill = '<styleSheet><dxfs><dxf><fill><patternFill><bgColor rgb="FFDCFCE7"/></patternFill></fill></dxf></dxfs></styleSheet>';
  const highlighted = '<conditionalFormatting sqref="XFD1048576"><cfRule type="cellIs" operator="equal" dxfId="0" priority="1"><formula>1048576</formula></cfRule></conditionalFormatting>';
  zip.file('xl/styles.xml', fill);
  zip.file('xl/worksheets/summary.xml', sheet(
    row(1, spill('A1', 'A1:C2', 'TRANSPOSE(Ledger!A1:B3)', '', 'str', 2),
      formula('E1', '_xlfn.XMATCH(TRUE,EXACT(Ledger!A1:A5,"East"))')),
    row(4, spill('A4', 'A4:C5', '_xlfn.XMATCH({"EAST","bad",33;"End","West","east"},Ledger!A:A,0,-1)', '', 'n', 2)),
    row(7, spill('A7', 'A7:B7', '_xlfn.XMATCH({"EA*","W?ST"},TRANSPOSE(Ledger!A1:A6),2)', '', 'n', 2))));
  zip.file('xl/worksheets/ledger.xml', sheet(
    row(1, value('A1', 'east', 'str'), value('B1', 'Alpha', 'str')),
    row(2, value('A2', 'East', 'str')),
    row(3, value('A3', 33), value('B3', 1, 'b')),
    row(4, value('A4', 0)),
    row(5, value('A5', 'West', 'str')),
    row(1048576, value('A1048576', 'end', 'str'), value('XFD1048576', 'end', 'str'))));
  zip.file('xl/worksheets/large.xml', sheet(row(1, formula('A1', 'SUM(_xlfn.IFNA(B1#,0))'),
    spill('B1', 'B1:XFD1048576', '_xlfn.XMATCH(Ledger!B:XFD,Ledger!A:A)', '', 'n', 2)))
    .replace('</worksheet>', highlighted + '</worksheet>'));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createTextSplitWorkbook() {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="Summary" sheetId="1" r:id="s1"/><sheet name="Source" sheetId="2" r:id="s2"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="s1" Target="worksheets/summary.xml"/><Relationship Id="s2" Target="worksheets/source.xml"/></Relationships>');
  zip.file('xl/styles.xml', '<styleSheet><dxfs><dxf><fill><patternFill><bgColor rgb="FFDCFCE7"/></patternFill></fill></dxf></dxfs></styleSheet>');
  zip.file('xl/worksheets/summary.xml', sheet(
    row(2, spill('B2', 'B2:D4', '_xlfn.TEXTSPLIT(Source!A1,{":",": "},"|",,,"pad")', '', 'str'),
      value('C2', 'saved', 'str'), formula('E2', 'TEXTJOIN("/",FALSE,B2:D4)')),
    row(3, formula('E3', 'COUNTIF(B2:D4,"pad")')),
    row(1048574, spill('XFB1048574', 'XFB1048574:XFD1048576', '_xlfn.TEXTSPLIT(Source!XFD1048576,",",";",,,"End")', '', 'str')))
    .replace('</worksheet>', '<conditionalFormatting sqref="XFD1048576"><cfRule type="cellIs" operator="equal" dxfId="0" priority="1"><formula>"End"</formula></cfRule></conditionalFormatting></worksheet>'));
  zip.file('xl/worksheets/source.xml', sheet(
    row(1, value('A1', 'sku: Aurora: Harbor|Latitude::62|single', 'str')),
    row(1048576, value('XFD1048576', 'a,b,c;d,e,f;Polar,Station', 'str'))));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createArraySelectionWorkbook() {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="Summary" sheetId="1" r:id="s1"/><sheet name="Ledger" sheetId="2" r:id="s2"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="s1" Target="worksheets/summary.xml"/><Relationship Id="s2" Target="worksheets/ledger.xml"/></Relationships>');
  zip.file('xl/worksheets/summary.xml', sheet(
    row(1,
      formula('A1', 'SUM(_xlfn._xlws.FILTER(Ledger!A1:C5,Ledger!B1:B5="North"))'),
      formula('B1', 'INDEX(_xlfn.CHOOSEROWS(Ledger!A1:C5,-1,2,2),2,3)'),
      formula('C1', 'TEXTJOIN("|",TRUE,_xlfn.CHOOSECOLS(Ledger!A1:C2,3,1,3))'),
      formula('D1', 'LET(filtered,FILTER(Ledger!A1:C5,Ledger!B1:B5="North"),INDEX(IF(ISBLANK(filtered),"-",filtered),2,3))'),
      formula('E1', 'FILTER(10,FALSE,90)'),
      formula('F1', 'SUM(IFERROR(FILTER({1,#N/A;3,4},{TRUE;TRUE}),0))')),
    row(1048576, formula('XFD1048576', 'SUM(_xlfn._xlws.FILTER(Ledger!E:XFD,Ledger!D:D=0))'))));
  zip.file('xl/worksheets/ledger.xml', sheet(
    row(1, value('A1', 3), value('B1', 'North', 'str'), value('C1', 2)),
    row(2, value('A2', 7), value('B2', 'South', 'str'), value('C2', 5), value('D2', 1)),
    row(3, value('A3', 8), value('B3', 'North', 'str')),
    row(4, value('A4', 1), value('B4', 'South', 'str'), value('C4', 4)),
    row(5, value('A5', 6), value('B5', 'North', 'str'), value('C5', 9)),
    row(1048576, value('XFD1048576', 14))));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createArraySpillWorkbook() {
  const zip = await JSZip.loadAsync(await createArraySelectionWorkbook());
  const workbook = await zip.file('xl/workbook.xml').async('string');
  const relations = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  zip.file('xl/workbook.xml', workbook.replace('</sheets>', '<sheet name="Large Spill" sheetId="3" r:id="s3"/></sheets>')
    .replace('</workbook>', '<definedNames><definedName name="SpillValues">_xlfn.ANCHORARRAY(\'Large Spill\'!$B$1)</definedName></definedNames></workbook>'));
  zip.file('xl/_rels/workbook.xml.rels', relations.replace('</Relationships>',
    '<Relationship Id="s3" Target="worksheets/large.xml"/>'
    + '<Relationship Id="s4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sheetMetadata" Target="metadata/arrays.xml"/>'
    + '</Relationships>'));
  zip.file('xl/metadata/arrays.xml', '<metadata xmlns:xda="http://schemas.microsoft.com/office/spreadsheetml/2017/dynamicarray">'
    + '<metadataTypes><metadataType name="OTHER"/><metadataType name="XLDAPR"/></metadataTypes>'
    + '<futureMetadata name="XLDAPR"><bk><extLst><ext><xda:dynamicArrayProperties fDynamic="0"/></ext></extLst></bk>'
    + '<bk><extLst><ext><xda:dynamicArrayProperties fDynamic="1" fCollapsed="0"/></ext></extLst></bk></futureMetadata>'
    + '<cellMetadata><bk><rc t="2" v="0"/></bk><bk><rc t="1" v="0"/><rc t="2" v="1"/></bk></cellMetadata></metadata>');
  zip.file('xl/styles.xml', '<styleSheet><cellXfs><xf/><xf numFmtId="2"/></cellXfs></styleSheet>');
  zip.file('xl/worksheets/summary.xml', '<worksheet><cols><col min="2" max="2" style="1"/></cols><sheetData>' + [
    row(1, spill('A1', 'A1:C3', 'LET(data,FILTER(Ledger!A1:C5,Ledger!B1:B5="North"),IF(ISBLANK(data),"-",data))', '', 'n', 2),
      value('B1', 'saved', 'str'), value('C1', 0), formula('D1', 'A2+1'), formula('E1', 'SUM(A1:A3)'),
      formula('F1', 'COUNTIF(B1:B3,"North")'), formula('G1', 'XMATCH("North",B1:B3,0,-1)'),
      formula('H1', 'IFERROR(E4,88)'), formula('I1', 'SUMPRODUCT(--(B1:B3="North"))'), formula('J1', 'ISBLANK(B5)'),
      spill('K1', 'K1:K3', '{1;2}'), spill('M1', 'M1:N3', '{1,2;3,4;5,6}'), spill('N1', 'N1:O3', '{1,2;3,4;5,6}'),
      spill('P1', 'P2:P3', '{1;2}')),
    row(2, '<c r="B2" t="b"/>', formula('E2', 'AGGREGATE(9,6,A1#)'),
      formula('F2', 'INDEX(_xlfn.ANCHORARRAY($A$1),2,2)'), formula('G2', 'INDEX(SpillValues,1048576,16383)')),
    row(3, formula('A3', '30+1'), value('B3', 0, 'b'), value('C3', '#N/A', 'e')),
    row(4, spill('A4', 'A4:B4', 'CHOOSECOLS({3,4},1,2)', '<v>999</v>', 'n', 2), spill('D4', 'D4:E4', 'FILTER({1,#N/A},TRUE)'),
      spill('F4', 'F4', 'FILTER(7,TRUE)', '', 'n', 2), spill('G4', 'G4', 'FILTER(5,TRUE)', '', 'n', 1),
      spill('H4', 'H4:H4', 'FILTER({1;2},TRUE)', '<v>#SPILL!</v>', 'e', 2)),
    row(5, spill('A5', 'A5:B5', '{"shown",8}', '', 'str'), '<c r="B5" t="str"><v/></c>')
  ].join('') + '</sheetData><conditionalFormatting sqref="A1:A3"><cfRule type="colorScale" priority="1">'
    + '<colorScale><cfvo type="min"/><cfvo type="max"/><color rgb="FF000000"/><color rgb="FFFFFFFF"/></colorScale>'
    + '</cfRule></conditionalFormatting></worksheet>');
  zip.file('xl/worksheets/large.xml', '<worksheet><sheetFormatPr zeroHeight="1"/><sheetData>' + row(1,
    formula('A1', 'SUM(_xlfn.ANCHORARRAY(B1))'), spill('B1', 'B1:XFD1048576', 'FILTER(Ledger!B:XFD,Ledger!D:D>=0)', '', 'n', 2))
    + '</sheetData></worksheet>');
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createSequenceWorkbook() {
  const zip = await JSZip.loadAsync(await createArraySpillWorkbook());
  zip.file('xl/worksheets/summary.xml', sheet(
    row(1, spill('A1', 'A1:E4', '_xlfn.SEQUENCE(4,5)', '', 'n', 2), formula('F1', 'SUM(_xlfn.ANCHORARRAY(A1))')),
    row(6, spill('A6', 'A6:C7', '_xlfn.SEQUENCE(2,3,7,-0.5)', '<v>700</v>', 'n', 2),
      formula('D6', 'SUM(A6#)')),
    row(8, spill('A8', 'A8:A11', 'INDEX(A1#,0,3)', '', 'n', 2))));
  zip.file('xl/worksheets/large.xml', '<worksheet><sheetFormatPr zeroHeight="1"/><sheetData>' + [
    row(1, formula('A1', 'INDEX(SpillValues,1048576,16383)'),
      spill('B1', 'B1:XFD1048576', '_xlfn.SEQUENCE(1048576,16383)', '', 'n', 2)),
    row(2, formula('A2', 'SUM(XFC1048576:XFD1048576)')),
    row(3, formula('A3', 'XMATCH(17178820608,XFD:XFD,0,-1)')),
    row(4, formula('A4', 'SUM(_xlfn.TAKE(B1#,-1,-2))')),
    row(5, formula('A5', 'SUM(_xlfn.TAKE(LET(data,_xlfn.DROP(B1#,,1),data),-1,-2))')),
    row(6, formula('A6', 'TEXTJOIN("|",TRUE,_xlfn.TAKE(ISNUMBER(_xlfn.DROP(B1#,,1)),-1,-2))'))
  ].join('') + '</sheetData></worksheet>');
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createSliceSpillWorkbook() {
  const zip = await JSZip.loadAsync(await createArraySpillWorkbook());
  zip.file('xl/worksheets/summary.xml', sheet(
    row(1, spill('A1', 'A1:B2', '_xlfn.TAKE(Ledger!A1:C5,-2,2)', '', 'n', 2),
      formula('C1', 'TEXTJOIN("|",TRUE,A1#)')),
    row(2, value('B2', 'Saved', 'str')),
    row(5, spill('A5', 'A5:B6', '_xlfn.DROP(_xlfn.TAKE(Ledger!A1:C5,3),1,-1)', '', 'n', 2)),
    row(8, formula('A8', '_xlfn.DROP(Ledger!A1:C5,5)'))));
  zip.file('xl/worksheets/large.xml', sheet(
    row(1, formula('A1', 'SUM(B1#)'), spill('B1', 'B1:XFD1048576', '_xlfn.DROP(Ledger!A:XFD,,1)', '', 'str', 2)),
    row(2, formula('A2', 'COUNT(B1#)')),
    row(3, formula('A3', 'SUM(_xlfn.TAKE(B1#,-1,-2))')),
    row(4, formula('A4', 'SUM(_xlfn.DROP(Ledger!A:XFD,-1,2))'))));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createStackSpillWorkbook() {
  const zip = await JSZip.loadAsync(await createArraySpillWorkbook());
  zip.file('xl/worksheets/summary.xml', sheet(
    row(1, spill('A1', 'A1:C3', '_xlfn.HSTACK(Ledger!A1:B3,{10;#N/A})', '', 'n', 2),
      formula('D1', 'TEXTJOIN("|",TRUE,_xlfn.IFNA(A1#,"pad"))')),
    row(2, value('C2', 99)),
    row(5, spill('A5', 'A5:B7', '_xlfn.VSTACK({1,2},{3},{4,5})', '', 'n', 2),
      formula('D5', '_xlfn.IFNA(B6,77)')),
    row(10, spill('A10', 'A10:A14', '_xlfn.VSTACK(Ledger!C2:C4,{0;""})', '', 'n', 2)),
    row(16, spill('A16', 'A16:A18', 'LET(stacked,_xlfn.VSTACK(Ledger!C2:C4,{0;""}),FILTER(stacked,stacked&lt;&gt;""))', '', 'n', 2))));
  zip.file('xl/worksheets/large.xml', sheet(
    row(1, formula('A1', 'SUM(B1#)'), spill('B1', 'B1:XFD1048576', '_xlfn.HSTACK(Ledger!B:E,Ledger!F:XFD)', '', 'str', 2)),
    row(2, formula('A2', 'COUNT(B1#)')),
    row(3, formula('A3', 'SUM(TAKE(HSTACK(Ledger!B:E,Ledger!F:XFD),-1,-2))')),
    row(4, formula('A4', 'INDEX(IFNA(HSTACK(Ledger!A:A,7),17),1048576,2)'))));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createDistinctRecordWorkbook() {
  const zip = await JSZip.loadAsync(await createArraySpillWorkbook());
  const stores = [
    ['Jan', 'jeans', 2, 'Shirt', 3],
    ['Feb stock', 'JEANS', 2, 'coat', 4],
    ['Mar', 'Hat', 5, 'Shirt', 3],
    ["May's stock", 'Boots', 6]
  ];
  const workbook = await zip.file('xl/workbook.xml').async('string');
  const relations = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  zip.file('xl/workbook.xml', workbook.replace('</sheets>', stores.map(([name], i) =>
    `<sheet name="${name}" sheetId="${i + 4}" r:id="store${i}"${i === 1 ? ' state="hidden"' : ''}/>`).join('') + '</sheets>')
    .replace('</definedNames>', '<definedName name="StoreSpan">Jan:Mar!$A$1</definedName></definedNames>'));
  zip.file('xl/_rels/workbook.xml.rels', relations.replace('</Relationships>', stores.map((_, i) =>
    `<Relationship Id="store${i}" Target="worksheets/store${i}.xml"/>`).join('') + '</Relationships>'));
  stores.forEach(([, first, firstValue, second, secondValue], i) => {
    zip.file(`xl/worksheets/store${i}.xml`, sheet(
      row(1, value('A1', first, 'str'), value('B1', firstValue)),
      ...(second ? [row(2, value('A2', second, 'str'), value('B2', secondValue))] : []),
      ...(i === 2 ? [row(1_048_576, value('XFD1048576', 17))] : [])));
  });
  zip.file('xl/worksheets/summary.xml', sheet(
    row(1, spill('A1', 'A1:B4', '_xlfn.UNIQUE(_xlfn.VSTACK(Jan:Mar!A1:B2))', '', 'str', 2),
      formula('D1', 'SUM(Mar:Jan!B1:B2)'), formula('E1', "SUM('Jan:May''s stock'!B1)"), formula('F1', 'SUM(Missing:Mar!B1)'),
      formula('G1', "TEXTJOIN(\"|\",TRUE,HSTACK('Jan:Mar'!A1))"), formula('H1', 'TEXTJOIN("|",TRUE,VSTACK(StoreSpan))')),
    row(7, spill('A7', 'A7:B8', '_xlfn.UNIQUE(_xlfn.VSTACK(Jan:Mar!A1:B2),,TRUE)', '', 'str', 2),
      spill('D7', 'D7:E8', 'SUBSTITUTE(_xlfn.VSTACK(Jan!A1:B1,Mar!A1:B1),"a","A")', '', 'str', 2))));
  zip.file('xl/worksheets/large.xml', sheet(
    row(1, spill('A1', 'A1:XFD7', '_xlfn.UNIQUE(_xlfn.HSTACK(Ledger!A:E,Ledger!F:XFD))', '', 'n', 2)),
    row(9, formula('A9', 'SUM(Jan:Mar!XFD:XFD)')),
    row(10, formula('A10', "SUM('Jan:Mar'!B:B)"))));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createChoiceCriteriaWorkbook() {
  const zip = await JSZip.loadAsync(await createArraySpillWorkbook());
  const path = 'xl/worksheets/ledger.xml';
  const ledger = await zip.file(path).async('string');
  zip.file(path, ledger.replace('<row r="1048576">', row(6, value('A6', 7)) + row(7, value('A7', 3)) + '<row r="1048576">'));
  zip.file('xl/worksheets/summary.xml', sheet(
    row(1, spill('A1', 'A1:A2', '_xlfn.UNIQUE(FILTER(Ledger!A1:A8,COUNTIF(Ledger!A1:A8,Ledger!A1:A8)>1))', '', 'n', 2),
      spill('D1', 'D1:E5', '_xlfn.UNIQUE(CHOOSE({1,2},Ledger!B1:B5,Ledger!A1:A5))', '', 'str', 2))));
  zip.file('xl/worksheets/large.xml', sheet(
    row(1, formula('A1', 'SUM(COUNTIF(Ledger!A:A,Ledger!A:A))'),
      spill('XFC1', 'XFC1:XFD1048576', 'CHOOSE({2,1},Ledger!XFD:XFD,Ledger!A:A)', '', 'n', 2)),
    row(2, formula('A2', 'SUM(CHOOSE({2,1},Ledger!XFD:XFD,Ledger!A:A))')),
    row(3, formula('A3', 'INDEX(COUNTIF(Ledger!XFD:XFD,Ledger!XFD:XFD),1048576)')),
    row(4, formula('A4', 'ROWS(COUNTIF(Ledger!A:XFD,Ledger!A:XFD))')),
    row(5, formula('A5', 'INDEX(TAKE(COUNTIF(Ledger!A:XFD,Ledger!A:XFD),-1,-1),1)'))));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createXlookupSpillWorkbook() {
  const zip = await JSZip.loadAsync(await createArraySpillWorkbook());
  zip.file('xl/worksheets/summary.xml', sheet(
    row(1, spill('A1', 'A1:D1', '_xlfn.XLOOKUP(22,Ledger!$A$1:$A$3,Ledger!B1:E3,1/0)', '', 'str', 2),
      value('B1', 'Saved dept', 'str'), formula('F1', 'TEXTJOIN("|",TRUE,A1#)')),
    row(3, spill('A3', 'A3:A5', '_xlfn.XLOOKUP(15,Ledger!A5:C5,Ledger!A6:C8,,1,2)', '', 'str', 2),
      formula('F3', 'INDEX(A3#,2,1)')),
    row(4, formula('F4', 'IFERROR(INDEX(A3#,3,1),88)')),
    row(5, formula('F5', '_xlfn.XLOOKUP(22,Ledger!A1:A3,_xlfn.XLOOKUP("Dept",Ledger!B4:E4,Ledger!B1:E3))')),
    row(7, spill('A7', 'A7:B7', '_xlfn.XLOOKUP("none",Ledger!A1:A3,Ledger!B1:C3,{"no","record"})', '', 'str', 2)),
    row(9, spill('A9', 'A9:D10', '_xlfn.XLOOKUP({33,22,90,11;11,22,33,#DIV/0!},Ledger!A1:A3,Ledger!D1:D3,"missing")', '', 'n', 2)),
    row(12, spill('A12', 'A12:B12', '_xlfn.LET(miss,"unlisted",_xlfn.XLOOKUP({"absent","l*"},Ledger!A:A,Ledger!XFD:XFD,miss,2,-1))', '', 'str', 2)),
    row(14, spill('A14', 'A14:A16', '_xlfn.XLOOKUP(Ledger!A1:A3,Ledger!A1:A3,Ledger!B1:B3,1/0,0,-1)', '', 'str', 2))));
  zip.file('xl/worksheets/ledger.xml', sheet(
    row(1, value('A1', 11), value('B1', 'Ana', 'str'), value('C1', 'Sales', 'str')),
    row(2, value('A2', 22), value('B2', 'Bea', 'str'), value('C2', 'Ops', 'str'), value('D2', 0, 'b')),
    row(3, value('A3', 33), value('B3', 'Cy', 'str'), value('C3', 'QA', 'str')),
    row(4, value('B4', 'Name', 'str'), value('C4', 'Dept', 'str')),
    row(5, value('A5', 10), value('B5', 20), value('C5', 30)),
    row(6, value('B6', 'West', 'str')),
    row(7, value('B7', 9)),
    row(8, value('B8', '#N/A', 'e')),
    row(1048576, value('A1048576', 'last', 'str'), value('B1048576', 7), value('XFD1048576', 131))));
  zip.file('xl/worksheets/large.xml', sheet(
    row(1, formula('A1', 'SUM(_xlfn.XLOOKUP("last",Ledger!A:A,Ledger!B:XFD))'),
      spill('B1', 'B1:XFD1048576', '_xlfn.XLOOKUP(Ledger!B:XFD,{0,7,131},{0,7,131},0)', '', 'n', 2)),
    row(2, formula('A2', 'INDEX(B1#,1048576,16383)')),
    row(3, formula('A3', '_xlfn.XLOOKUP(1048576,SEQUENCE(1048576),Ledger!B:B,,0,2)')),
    row(4, formula('A4', 'SUM(IFERROR(B1#,0))'))));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createArrayPredicateWorkbook() {
  const zip = await JSZip.loadAsync(await createArraySpillWorkbook());
  zip.file('xl/worksheets/summary.xml', sheet(
    row(1, spill('A1', 'A1:D1', '_xlfn.XLOOKUP(1,(LEFT(Ledger!A:A)="x")*(Ledger!B:B="east")*NOT(MONTH(Ledger!C:C)=4),Ledger!A:D)', '', 'str', 2)),
    row(3, spill('A3', 'A3:C3', 'NOT({0,1,#N/A})', '', 'b', 2))));
  zip.file('xl/worksheets/ledger.xml', sheet(
    row(1, value('A1', 'X-April', 'str'), value('B1', 'EAST', 'str'), value('C1', 43932), value('D1', 24000)),
    row(2, value('A2', 'Y-May', 'str'), value('B2', 'East', 'str'), value('C2', 43962), value('D2', 100)),
    row(3, value('A3', 'X-West', 'str'), value('B3', 'West', 'str'), value('C3', 43962), value('D3', 800)),
    row(1048576, value('A1048576', 'X3000-050', 'str'), value('B1048576', 'East', 'str'),
      value('C1048576', 43962), value('D1048576', 4500), value('XFD1048576', 43962))));
  zip.file('xl/worksheets/large.xml', sheet(
    row(1, formula('A1', 'SUM(E1#)'), formula('B1', 'COUNT(NOT(Ledger!C1048576))'),
      spill('E1', 'E1:XFD1048576', 'MONTH(Ledger!E:XFD)', '', 'n', 2))));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createWorkdayArrayWorkbook(date1904 = false) {
  const zip = await JSZip.loadAsync(await createArraySpillWorkbook());
  const workbook = await zip.file('xl/workbook.xml').async('string');
  zip.file('xl/workbook.xml', workbook.replace('<workbook>', `<workbook><workbookPr date1904="${Number(date1904)}"/>`));
  zip.file('xl/worksheets/summary.xml', sheet(
    row(1, spill('A1', 'A1:C2', '_xlfn.LET(holidays,Ledger!A:A,WORKDAY.INTL(DATE(2024,6,7),{1,-1,1;0,1,-1},{1,1,"0000000";1,7,"0000000"},holidays))', '', 'n', 2)),
    row(4, spill('A4', 'A4:D4', 'NETWORKDAYS.INTL(DATE(2024,6,{7,10,8,7}),DATE(2024,6,{11,7,11,9}),{1,1,"0000000","1111111"},Ledger!A:A)', '', 'n', 2))));
  zip.file('xl/worksheets/ledger.xml', sheet(
    row(1, value('A1', '2024-06-06', 'd')), row(2, value('A2', '2024-06-08', 'd')),
    row(3, value('A3', '2024-06-10', 'd')), row(4, value('A4', '2024-06-10', 'd')),
    row(1048576, value('XFD1048576', 1))));
  zip.file('xl/worksheets/large.xml', sheet(row(1, formula('A1', 'SUM(E1#)'),
    spill('E1', 'E1:XFD1048576', '_xlfn.LET(start,DATE(2024,6,7),WORKDAY(start,Ledger!E:XFD,Ledger!A:A)-start)', '', 'n', 2))));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createCoordinateFormulaWorkbook() {
  const zip = await JSZip.loadAsync(await createArraySpillWorkbook());
  const workbook = await zip.file('xl/workbook.xml').async('string');
  zip.file('xl/workbook.xml', workbook.replace('</definedNames>',
    '<definedName name="NumberedRange">Ledger!$XFC$1048574:$XFD$1048576</definedName></definedNames>'));
  zip.file('xl/worksheets/summary.xml', sheet(
    row(1, formula('A1', 'ROW()'), formula('B1', 'COLUMN()'), formula('C1', 'SUM(ROW(Ledger!A1:A3))'),
      formula('D1', '_xlfn.SINGLE(ROW(NumberedRange))')),
    row(2, formula('A2', '_xlfn.SINGLE(Ledger!A1:A3)'), formula('B2', 'ROW(Ledger!B2)'),
      formula('C2', 'COLUMN(Ledger!XFD1048576)')),
    row(3, formula('A3', 'ADDRESS(1048576,16384,1,FALSE,"Ledger")'),
      formula('B3', 'INDIRECT(ADDRESS(1048576,16383,1,FALSE,"Ledger"),FALSE)'),
      formula('C3', 'INDIRECT("\'Large Spill\'!R1048576C16384",FALSE)'),
      formula('D3', 'INDIRECT("Ledger!R[1048573]C[16379]",FALSE)')),
    row(4, spill('A4', 'A4:A6', 'ROW(NumberedRange)', '', 'n', 2),
      spill('D4', 'D4:E4', 'COLUMN(NumberedRange)', '', 'n', 2),
      spill('G4', 'G4:G6', 'ADDRESS(ROW(NumberedRange),16384,4)', '', 'str', 2))));
  zip.file('xl/worksheets/ledger.xml', sheet(row(2, value('A2', 22), value('B2', '#N/A', 'e')),
    row(1048576, value('XFC1048576', 131), value('XFD1048576', '#DIV/0!', 'e'))));
  zip.file('xl/worksheets/large.xml', sheet(
    row(1, formula('A1', '_xlfn.LET(coords,ROW(Ledger!A:A),SUM(_xlfn.TAKE(coords,-2)))'),
      spill('D1', 'D1:D1048576', 'ROW(Ledger!A:A)', '', 'n', 2)),
    row(2, formula('A2', 'SUM(_xlfn.TAKE(COLUMN(Ledger!1:1),,-2))')),
    row(1048576, spill('XFC1048576', 'XFC1048576:XFD1048576', 'COLUMN(Ledger!XFC:XFD)', '', 'n', 2))));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createOffsetWorkbook() {
  const zip = await JSZip.loadAsync(await createArraySpillWorkbook());
  const workbook = await zip.file('xl/workbook.xml').async('string');
  zip.file('xl/workbook.xml', workbook.replace('</definedNames>',
    '<definedName name="Tail">OFFSET(Ledger!$XFD$1048576,-1,-1,2,2)</definedName></definedNames>'));
  zip.file('xl/worksheets/summary.xml', sheet(
    row(1, formula('A1', 'SUM(OFFSET(Ledger!A1,0,0,1048576,16384))'), formula('B1', 'SUM(Tail)')),
    row(2, spill('A2', 'A2', 'OFFSET(Ledger!A1:B2,0,0)'),
      spill('C2', 'C2:D2', 'OFFSET(Ledger!A1:B2,0,0)'))));
  zip.file('xl/worksheets/ledger.xml', sheet(row(1, value('A1', 10), value('B1', 20)), row(2, value('A2', 90)),
    row(1048575, value('XFC1048575', 4), value('XFD1048575', 'Station', 'str')), row(1048576, value('XFD1048576', 131))));
  zip.file('xl/worksheets/large.xml', sheet(row(1, formula('A1', 'SUM(XFC1048575#)')),
    row(1048575, spill('XFC1048575', 'XFC1048575:XFD1048576', 'OFFSET(Tail,0,0)', '', 'n', 2))));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createSortSpillWorkbook() {
  const zip = await JSZip.loadAsync(await createArraySpillWorkbook());
  zip.file('xl/worksheets/summary.xml', sheet(
    row(1, spill('A1', 'A1:C5', '_xlfn.SORTBY(Ledger!A1:C5,Ledger!A1:A5,,Ledger!B1:B5,-1)', '', 'str', 2),
      formula('E1', 'TEXTJOIN("|",TRUE,CHOOSECOLS(A1#,3))')),
    row(8, spill('A8', 'A8:C9', '_xlfn._xlws.SORT({3,1,2;"three","one","two"},1,,TRUE)', '', 'n', 2)),
    row(11, spill('A11', 'A11:C15', '_xlfn._xlws.SORT(Ledger!A1:C5,{1,2},{1,-1})', '', 'str', 2)),
    row(17, spill('A17', 'A17:C18', '_xlfn.SORTBY({3,1,2;"three","one","two"},{3,1,2},-1)', '', 'n', 2))));
  zip.file('xl/worksheets/ledger.xml', sheet(
    row(1, value('A1', 'North', 'str'), value('B1', 20), value('C1', 'Ana', 'str'), value('D1', 9), value('E1', 4)),
    row(2, value('A2', 'south', 'str'), value('B2', 30), value('C2', 'Bea', 'str')),
    row(3, value('A3', 'north', 'str'), value('B3', 31), value('C3', 'Cy', 'str'), value('D3', -3), value('E3', 8)),
    row(4, value('A4', 'North', 'str'), value('B4', 31), value('C4', 'Di', 'str'), value('D4', 0), value('E4', 6)),
    row(5, value('B5', 99), value('C5', 'Eva', 'str')),
    row(1048576, value('XFD1048576', 131))));
  zip.file('xl/worksheets/large.xml', sheet(
    row(1, formula('A1', 'SUM(_xlfn.SORTBY(Ledger!E:XFD,Ledger!D:D))'),
      spill('E1', 'E1:XFD1048576', '_xlfn.SORTBY(Ledger!E:XFD,Ledger!D:D)', '', 'n', 2)),
    row(2, formula('A2', 'INDEX(SORTBY(Ledger!E:XFD,Ledger!D:D+0),1048575,16380)')),
    row(3, formula('A3', 'INDEX(SORTBY(Ledger!E:XFD,Ledger!D:D+0),1048576,1)')),
    row(4, formula('A4', 'INDEX(SORTBY(Ledger!E:XFD,Ledger!E1:XFD1,-1),1048576,16380)')),
    row(5, formula('A5', 'SUM(E1#)')),
    row(6, formula('A6', 'COUNT(_xlfn.ANCHORARRAY(E1))')),
    row(7, formula('A7', 'SUMPRODUCT(E1#+1)')),
    row(8, formula('A8', 'COUNTIF(E1#,0)')),
    row(9, formula('A9', 'AGGREGATE(9,6,E1#)'))));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createFlattenSpillWorkbook() {
  const zip = await JSZip.loadAsync(await createArraySpillWorkbook());
  const fill = '<styleSheet><dxfs><dxf><fill><patternFill><bgColor rgb="FFDCFCE7"/></patternFill></fill></dxf></dxfs></styleSheet>';
  const highlighted = '<conditionalFormatting sqref="XFD1048576"><cfRule type="cellIs" operator="equal" dxfId="0" priority="1"><formula>33</formula></cfRule></conditionalFormatting>';
  zip.file('xl/styles.xml', fill);
  zip.file('xl/worksheets/summary.xml', sheet(
    row(1, spill('A1', 'A1:F1', '_xlfn.TOROW(Ledger!A1:B3)', '', 'n', 2)),
    row(3, spill('A3', 'A3:E3', '_xlfn.TOROW(Ledger!A1:B3,1,TRUE)', '', 'n', 2)),
    row(5, spill('A5', 'A5:A9', '_xlfn.TOCOL(Ledger!A1:B3,2,TRUE)', '', 'n', 2),
      spill('C5', 'C5:H5', '_xlfn.TOROW(Ledger!A:XFD,3,TRUE)', '', 'n', 2)),
    row(10, formula('A10', 'COUNT(C5#)'), formula('B10', 'COLUMNS(C5#)'))));
  zip.file('xl/worksheets/ledger.xml', sheet(
    row(1, value('A1', 5), value('B1', '#DIV/0!', 'e')),
    row(2, value('B2', 0)), row(3, formula('A3', '""'), value('B3', 1, 'b')),
    row(524288, value('B524288', 33)), row(1048576, value('XFD1048576', -7))));
  zip.file('xl/worksheets/large.xml', sheet(
    row(1, formula('A1', 'SUM(XFD2#)'), formula('B1', 'COUNT(XFD2#)')),
    row(2, spill('XFD2', 'XFD2:XFD1048576', '_xlfn.TOCOL(Ledger!A1:B524288,2,TRUE)', '', 'n', 2)))
    .replace('</worksheet>', highlighted + '</worksheet>'));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createWrapExpandWorkbook() {
  const zip = await JSZip.loadAsync(await createArraySpillWorkbook());
  const manifest = await zip.file('xl/workbook.xml').async('string');
  const relationships = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  zip.file('xl/workbook.xml', manifest.replace('</sheets>', '<sheet name="Expand Spill" sheetId="4" r:id="s5"/></sheets>'));
  zip.file('xl/_rels/workbook.xml.rels', relationships.replace('</Relationships>',
    '<Relationship Id="s5" Target="worksheets/expand.xml"/></Relationships>'));
  zip.file('xl/styles.xml', '<styleSheet><dxfs><dxf><fill><patternFill><bgColor rgb="FFDCFCE7"/></patternFill></fill></dxf></dxfs></styleSheet>');
  const highlight = number => `<conditionalFormatting sqref="XFD1048576"><cfRule type="cellIs" operator="equal" dxfId="0" priority="1"><formula>${number}</formula></cfRule></conditionalFormatting></worksheet>`;
  zip.file('xl/worksheets/summary.xml', sheet(
    row(1, spill('A1', 'A1:C2', '_xlfn.WRAPROWS(Ledger!A1:A5,3,"")', '', 'n', 2)),
    row(4, spill('A4', 'A4:B6', '_xlfn.WRAPCOLS(Ledger!A1:A5,3)', '', 'n', 2)),
    row(8, spill('A8', 'A8:C10', '_xlfn.EXPAND(Ledger!A1:B2,3,3,FALSE)', '', 'n', 2)),
    row(12, formula('A12', "SUM('Large Spill'!XFC524288#)"), formula('B12', "SUM('Expand Spill'!A1#)")),
    row(13, formula('A13', "COUNT('Expand Spill'!A1#)"), formula('B13', "SUM(TAKE('Expand Spill'!A1#,-2,-2))"))));
  zip.file('xl/worksheets/ledger.xml', sheet(row(1, value('A1', 2), value('XFD1', 11)),
    row(2, value('A2', 4), value('B2', 8)), row(3, formula('A3', '""')), row(4, value('A4', '#REF!', 'e')),
    row(5, value('A5', 6)), row(524289, value('XFD524289', 3)), row(1048576, value('XFD1048576', 22))));
  zip.file('xl/worksheets/large.xml', sheet(row(524288,
    spill('XFC524288', 'XFC524288:XFD1048576', '_xlfn.WRAPCOLS(Ledger!XFD:XFD,524289,7)', '', 'n', 2)))
    .replace('</worksheet>', highlight(7)));
  zip.file('xl/worksheets/expand.xml', sheet(row(1,
    spill('A1', 'A1:XFD1048576', '_xlfn.EXPAND(Ledger!A1:B2,1048576,16384,9)', '', 'n', 2)))
    .replace('</worksheet>', highlight(9)));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createLambdaWorkbook() {
  const zip = await JSZip.loadAsync(await createArraySpillWorkbook());
  const manifest = await zip.file('xl/workbook.xml').async('string');
  zip.file('xl/workbook.xml', manifest.replace('</definedNames>',
    '<definedName name="Totals">_xlfn.LAMBDA(_xlpm.group,SUM(_xlpm.group))</definedName>'
    + '<definedName name="Factorial">_xlfn.LAMBDA(_xlpm.n,IF(_xlpm.n&lt;=1,1,_xlpm.n*Factorial(_xlpm.n-1)))</definedName>'
    + '<definedName name="LoopFn">_xlfn.LAMBDA(_xlpm.n,LoopFn(_xlpm.n))</definedName>'
    + '<definedName name="ScopedTotal" localSheetId="1">_xlfn.LAMBDA(group,SUM(group)+$E$1)</definedName>'
    + '<definedName name="SalePrice">_xlfn.LAMBDA(_xlpm.price,_xlop.discount,IF(_xlfn.ISOMITTED(_xlpm.discount),_xlpm.price*0.9,_xlpm.price*(1-_xlpm.discount)))</definedName>'
    + '<definedName name="LoopFactory">_xlfn.LAMBDA(_xlfn.LAMBDA(LoopFactory()()))</definedName></definedNames>'));
  zip.file('xl/styles.xml', '<styleSheet><dxfs><dxf><fill><patternFill><bgColor rgb="FFDCFCE7"/></patternFill></fill></dxf></dxfs></styleSheet>');
  zip.file('xl/worksheets/summary.xml', sheet(
    row(1, spill('A1', 'A1:A3', '_xlfn.BYROW(Ledger!A1:C3,_xlfn.LAMBDA(_xlpm.group,COUNTIF(_xlpm.group,"&gt;0")))', '', 'n', 2)),
    row(5, spill('A5', 'A5:C5', '_xlfn.LET(bonus,10,fn,_xlfn.LAMBDA(group,SUM(group)+bonus),_xlfn.BYCOL(Ledger!A1:C3,fn))', '', 'n', 2)),
    row(7, formula('A7', 'Totals(Ledger!A1:C1)'), formula('B7', 'Factorial(5)'), formula('C7', 'LoopFn(1)'), formula('D7', 'LoopFactory()()')),
    row(9, formula('A9', "SUM('Large Spill'!XFD1#)"), formula('B9', 'INDEX(_xlfn.BYROW(Ledger!E:XFD,_xlfn.LAMBDA(group,SUM(group)+ROWS(group))),1048576)'),
      formula('C9', 'INDEX(_xlfn.BYCOL(Ledger!1:1048576,_xleta.SUM),1,16384)'), formula('D9', 'Ledger!ScopedTotal(A1:A3)')),
    row(11, spill('A11', 'A11:A13', '_xlfn.BYROW(A1:A3,Ledger!ScopedTotal)', '', 'n', 2)),
    row(15, spill('A15', 'A15', 'SalePrice(40)', '', 'n', 2),
      spill('B15', 'B15', 'SalePrice(40,0.25)', '', 'n', 2),
      spill('C15', 'C15', 'SalePrice(40,Ledger!D1)', '', 'n', 2))));
  zip.file('xl/worksheets/ledger.xml', sheet(row(1, value('A1', 3), value('C1', 5), value('E1', 7)),
    row(2, value('A2', -1), value('B2', 7)), row(3, value('C3', 9)), row(1048576, value('XFD1048576', 130))));
  zip.file('xl/worksheets/large.xml', sheet(row(1,
    spill('XFD1', 'XFD1:XFD1048576', '_xlfn.BYROW(Ledger!E:XFD,Totals)', '', 'n', 2)))
    .replace('</worksheet>', '<conditionalFormatting sqref="XFD1048576"><cfRule type="cellIs" operator="equal" dxfId="0" priority="1"><formula>130</formula></cfRule></conditionalFormatting></worksheet>'));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createMapWorkbook() {
  const zip = await JSZip.loadAsync(await createArraySpillWorkbook());
  const manifest = await zip.file('xl/workbook.xml').async('string');
  zip.file('xl/workbook.xml', manifest.replace('</definedNames>',
    '<definedName name="VisibleAmount">_xlfn.LAMBDA(_xlpm.c,SUBTOTAL(109,_xlpm.c))</definedName></definedNames>'));
  zip.file('xl/styles.xml', '<styleSheet><dxfs><dxf><fill><patternFill><bgColor rgb="FFDCFCE7"/></patternFill></fill></dxf></dxfs></styleSheet>');
  zip.file('xl/worksheets/summary.xml', sheet(
    row(1, spill('A1', 'A1:A3', '_xlfn.MAP(Ledger!A1:A3,_xlfn.LAMBDA(_xlpm.c,COUNTIF(Ledger!$A$1:_xlpm.c,_xlpm.c)))', '', 'n', 2),
      spill('B1', 'B1:B3', '_xlfn.MAP(Ledger!A1:A3,VisibleAmount)', '', 'n', 2),
      spill('C1', 'C1', 'SUM((Ledger!A1:A3&gt;0)*_xlfn.MAP(Ledger!A1:A3,VisibleAmount))', '', 'n', 2)),
    row(5, formula('A5', "SUM('Large Spill'!A1#)"), formula('B5', 'INDEX(_xlfn.MAP(Ledger!A:XFD,_xlfn.LAMBDA(item,ROW(item)+COLUMN(item))),1048576,16384)')),
    row(6, formula('A6', 'LET(COL,LAMBDA(item,item),SUM(Ledger!A:A)+ROWS(COL:COL))'),
      formula('B6', '_xlfn.LET(edge,A3,COUNTIF(edge:A1,1))'))));
  zip.file('xl/worksheets/ledger.xml', sheet(
    row(1, value('A1', 3)), '<row r="2" hidden="1">' + value('A2', 6) + '</row>', row(3, value('A3', 3)),
    row(1048576, value('XFD1048576', 130))));
  zip.file('xl/worksheets/large.xml', sheet(row(1,
    spill('A1', 'A1:XFD1048576', '_xlfn.MAP(Ledger!A:XFD+0,_xlfn.SEQUENCE(1048576,16384,4,0),_xlfn.LAMBDA(item,offset,item*2+offset))', '', 'n', 2)))
    .replace('</worksheet>', '<conditionalFormatting sqref="XFD1048576"><cfRule type="cellIs" operator="equal" dxfId="0" priority="1"><formula>264</formula></cfRule></conditionalFormatting></worksheet>'));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createGroupByWorkbook() {
  const zip = await JSZip.loadAsync(await createArraySpillWorkbook());
  zip.file('xl/styles.xml', '<styleSheet><dxfs><dxf><fill><patternFill><bgColor rgb="FFDCFCE7"/></patternFill></dxf></dxfs></styleSheet>');
  zip.file('xl/worksheets/summary.xml', sheet(
    row(1, spill('A1', 'A1:C6', '_xlfn.GROUPBY(Ledger!A:B,Ledger!C:C,_xleta.SUM,0,2,{-1,2},Ledger!A:A&lt;&gt;"")', '', 'str', 2)),
    row(8, formula('A8', "SUM('Large Spill'!XFD1048575:XFD1048576)"))));
  zip.file('xl/worksheets/ledger.xml', sheet(
    row(1, value('A1', 'North', 'str'), value('B1', 'Red', 'str'), value('C1', 7)),
    row(2, value('A2', 'North', 'str'), value('B2', 'Blue', 'str'), value('C2', 3)),
    row(1000000, value('A1000000', 'South', 'str'), value('B1000000', 'Blue', 'str'), value('C1000000', 5)),
    row(1048576, value('A1048576', 'South', 'str'), value('B1048576', 'Blue', 'str'), value('C1048576', 40))));
  zip.file('xl/worksheets/large.xml', sheet(row(1048575,
    spill('XFB1048575', 'XFB1048575:XFD1048576', '_xlfn.GROUPBY(Ledger!A:B,Ledger!C:C,_xleta.SUM,0,1,,Ledger!A:A="South")', '', 'str', 2)))
    .replace('</worksheet>', '<conditionalFormatting sqref="XFD1048576"><cfRule type="cellIs" operator="equal" dxfId="0" priority="1"><formula>45</formula></cfRule></conditionalFormatting></worksheet>'));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createRegexWorkbook() {
  const zip = await JSZip.loadAsync(await createGroupByWorkbook());
  zip.file('xl/worksheets/summary.xml', sheet(
    row(1, formula('A1', '_xlfn.REGEXTEST("Élise","(?i)^é")'),
      formula('B1', String.raw`_xlfn.REGEXREPLACE("a1 b2 c3","\d","!",-2)`)),
    row(2, spill('A2', 'A2:B2', String.raw`_xlfn.REGEXEXTRACT("A17 B42","\d+",1)`, '', 'str', 2))));
  zip.file('xl/worksheets/ledger.xml', sheet(row(1, value('A1', 'ID01', 'str')),
    row(1048576, value('A1048576', 'ID123', 'str'))));
  zip.file('xl/worksheets/large.xml', sheet(row(1,
    spill('XFD1', 'XFD1:XFD1048576', String.raw`_xlfn.REGEXREPLACE(Ledger!A:A,"\d+","")`, '', 'str', 2)))
    .replace('</worksheet>', '<conditionalFormatting sqref="XFD1048576"><cfRule type="expression" dxfId="0" priority="1"><formula>_xlfn.REGEXTEST(XFD1048576,"^ID$")</formula></cfRule></conditionalFormatting></worksheet>'));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createMakeArrayWorkbook() {
  const zip = await JSZip.loadAsync(await createArraySpillWorkbook());
  const workbook = await zip.file('xl/workbook.xml').async('string');
  zip.file('xl/workbook.xml', workbook.replace('</definedNames>',
    '<definedName name="GridValue">_xlfn.LAMBDA(_xlpm.rr,_xlpm.cc,Ledger!$A$1+_xlpm.rr*10+_xlpm.cc)</definedName></definedNames>'));
  zip.file('xl/worksheets/summary.xml', sheet(
    row(1, spill('A1', 'A1:B2', '_xlfn.MAKEARRAY(2,2,GridValue)', '', 'n', 2),
      formula('C1', 'SUM(A1#)')),
    row(2, value('B2', 900)),
    row(4, spill('A4', 'A4:B5', '_xlfn.MAKEARRAY(2,2,_xlfn.LAMBDA(_xlpm.rr,_xlpm.cc,IF(_xlpm.rr=1,IF(_xlpm.cc=1,TRUE,""),IF(_xlpm.cc=1,NA(),"end"))))', '', 'b', 2)),
    row(7, formula('A7', 'LARGE({8,9,7},2)'), formula('B7', 'ROUND(CORREL({1,2,3},{4,3,2}),10)'),
      formula('C7', "SUM(_xlfn.TAKE('Large Spill'!A1#,-1,-2))"))));
  zip.file('xl/worksheets/ledger.xml', sheet(row(1, value('A1', 4))));
  zip.file('xl/styles.xml', '<styleSheet><dxfs><dxf><fill><patternFill><bgColor rgb="FFDCFCE7"/></patternFill></fill></dxf></dxfs></styleSheet>');
  zip.file('xl/worksheets/large.xml', sheet(row(1, spill('A1', 'A1:XFD1048576',
    '_xlfn.MAKEARRAY(1048576,16384,_xlfn.LAMBDA(_xlpm.rr,_xlpm.cc,_xlpm.rr+_xlpm.cc))', '', 'n', 2)))
    .replace('</worksheet>', '<conditionalFormatting sqref="XFD1048576"><cfRule type="cellIs" operator="equal" dxfId="0" priority="1"><formula>1064960</formula></cfRule></conditionalFormatting></worksheet>'));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createPivotByWorkbook() {
  const zip = await JSZip.loadAsync(await createGroupByWorkbook());
  zip.file('xl/worksheets/summary.xml', sheet(
    row(1, spill('A1', 'A1:D4', '_xlfn.PIVOTBY(Ledger!A:A,Ledger!B:B,Ledger!C:C,_xleta.SUM,0,,,,,Ledger!A:A&lt;&gt;"")', '', 'str', 2)),
    row(6, formula('A6', "SUM('Large Spill'!XFC1048576:XFD1048576)")),
    row(10, spill('A10', 'A10:ALM1010', '_xlfn.PIVOTBY(_xlfn.SEQUENCE(1000),_xlfn.SEQUENCE(1000),_xlfn.SEQUENCE(1000,1,7,0),_xleta.SUM,0,0,,0)', '', 'str', 2))));
  zip.file('xl/worksheets/large.xml', sheet(row(1048575,
    spill('XFC1048575', 'XFC1048575:XFD1048576', '_xlfn.PIVOTBY(,Ledger!B:B,Ledger!C:C,_xleta.SUM,0,,,,,Ledger!A:A="South")', '', 'str', 2)))
    .replace('</worksheet>', '<conditionalFormatting sqref="XFD1048576"><cfRule type="cellIs" operator="equal" dxfId="0" priority="1"><formula>45</formula></cfRule></conditionalFormatting></worksheet>'));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createAccumulationWorkbook() {
  const zip = await JSZip.loadAsync(await createArraySpillWorkbook());
  const manifest = await zip.file('xl/workbook.xml').async('string');
  zip.file('xl/workbook.xml', manifest.replace('</definedNames>',
    '<definedName name="AddItem">_xlfn.LAMBDA(_xlpm.acc,_xlpm.item,_xlpm.acc+_xlpm.item)</definedName></definedNames>'));
  zip.file('xl/styles.xml', '<styleSheet><dxfs><dxf><fill><patternFill><bgColor rgb="FFDCFCE7"/></patternFill></dxf></dxfs></styleSheet>');
  zip.file('xl/worksheets/summary.xml', sheet(
    row(1, spill('A1', 'A1:B2', '_xlfn.SCAN(,Ledger!A1:B2,AddItem)', '', 'n', 2)),
    row(4, spill('A4', 'A4:A5', '_xlfn.REDUCE({10;20},Ledger!A1:B2,AddItem)', '', 'n', 2),
      formula('B4', '_xlfn.REDUCE(0,Ledger!A:XFD,_xleta.SUM)')),
    row(6, formula('A6', 'INDEX(_xlfn.SCAN(0,_xlfn.SEQUENCE(1048576,16384),AddItem),1,3)'),
      formula('B6', "SUM('Large Spill'!XFC1048575#)"))));
  zip.file('xl/worksheets/ledger.xml', sheet(row(1, value('A1', 2), value('B1', 3)),
    row(2, value('B2', 5)), row(1048576, value('XFD1048576', 100))));
  zip.file('xl/worksheets/large.xml', sheet(row(1048575,
    spill('XFC1048575', 'XFC1048575:XFD1048576', '_xlfn.SCAN(0,Ledger!A1:B2,AddItem)', '', 'n', 2)))
    .replace('</worksheet>', '<conditionalFormatting sqref="XFD1048576"><cfRule type="cellIs" operator="equal" dxfId="0" priority="1"><formula>10</formula></cfRule></conditionalFormatting></worksheet>'));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createTrimRangeWorkbook() {
  const zip = await JSZip.loadAsync(await createArraySpillWorkbook());
  const manifest = await zip.file('xl/workbook.xml').async('string');
  zip.file('xl/workbook.xml', manifest.replace('</definedNames>',
    '<definedName name="TailData">_xlfn.DROP(_xlfn.TRIMRANGE(Ledger!$XFC:$XFD),1)</definedName></definedNames>'));
  zip.file('xl/styles.xml', '<styleSheet><dxfs><dxf><fill><patternFill><bgColor rgb="FFDCFCE7"/></patternFill></fill></dxf></dxfs></styleSheet>');
  zip.file('xl/worksheets/summary.xml', sheet(
    row(1, formula('A1', 'ROWS(_xlfn.TRIMRANGE(Ledger!A1:E10))'), formula('B1', 'COLUMNS(_xlfn.TRIMRANGE(Ledger!A1:E10))'),
      formula('C1', 'ROWS(Ledger!A1.:E10)'), formula('D1', 'ROWS(Ledger!A1:.E10)'), formula('E1', 'ROWS(Ledger!A1.:.E10)')),
    row(2, formula('A2', 'ROW(INDEX(_xlfn.TRIMRANGE(Ledger!A1:E10),1,1))'),
      formula('B2', 'ISBLANK(INDEX(_xlfn.TRIMRANGE(Ledger!A1:E10),2,2))'),
      formula('C2', 'INDEX(_xlfn.TRIMRANGE(Ledger!A1:E10),3,3)'),
      formula('D2', 'INDEX(_xlfn.TRIMRANGE(Ledger!A1:E10),5,5)'), formula('E2', 'INDEX(_xlfn.TRIMRANGE(Ledger!A1:E10),6,5)')),
    row(3, formula('A3', 'ROWS(TailData)'), formula('B3', 'SUM(TailData)'),
      formula('C3', "SUM('Large Spill'!XFC1048574#)"), formula('D3', 'ROWS(Ledger!1.:.10)'),
      formula('E3', 'COLUMNS(Ledger!A.:XFD)'))));
  zip.file('xl/worksheets/ledger.xml', sheet(row(1, '<c r="A1" t="str"/>'), row(4, value('A4', 0)),
    row(6, value('C6', 0, 'b')), row(8, value('E8', '#N/A', 'e')), row(9, formula('E9', '""')),
    row(1048574, value('XFC1048574', 7)), row(1048576, value('XFD1048576', 15))));
  zip.file('xl/worksheets/large.xml', sheet(row(1048574,
    spill('XFC1048574', 'XFC1048574:XFD1048576', '_xlfn._TRO_ALL(Ledger!XFC:XFD)', '', 'n', 2)))
    .replace('</worksheet>', '<conditionalFormatting sqref="XFD1048576"><cfRule type="cellIs" operator="equal" dxfId="0" priority="1"><formula>15</formula></cfRule></conditionalFormatting></worksheet>'));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
