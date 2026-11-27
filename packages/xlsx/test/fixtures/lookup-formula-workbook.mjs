import JSZip from 'jszip';

const row = (index, ...cells) => '<row r="' + index + '">' + cells.join('') + '</row>';
const scalar = (ref, value, type = 'n') => '<c r="' + ref + '" t="' + type + '"><v>' + value + '</v></c>';
const formula = (ref, value, attrs = '', cache = '') => '<c r="' + ref + '"' + attrs + '><f>' + value + '</f>' + cache + '</c>';
const worksheet = (rows, rules = '') =>
  '<worksheet><sheetFormatPr defaultColWidth="16"/><sheetData>' + rows.join('') + '</sheetData>' + rules + '</worksheet>';

export async function createLookupFormulaWorkbook() {
  const zip = new JSZip(), sheets = ['Lookup', "Team's Stock", 'Rates'];
  const stock = "'Team''s Stock'!";
  zip.file('xl/workbook.xml', '<workbook><sheets>' + sheets.map((name, index) =>
    '<sheet name="' + name + '" sheetId="' + (index + 1) + '" r:id="s' + index + '"/>').join('')
    + '</sheets><definedNames><definedName name="StockKeys">' + stock + '$A:$A</definedName>'
    + '<definedName name="StockValues">' + stock + '$B:$B</definedName>'
    + '<definedName name="LastStockValue">_xlfn.XLOOKUP("id-1",StockKeys,StockValues,,0,-1)</definedName></definedNames></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships>' + sheets.map((_, index) =>
    '<Relationship Id="s' + index + '" Target="worksheets/s' + index + '.xml"/>').join('') + '</Relationships>');
  zip.file('xl/styles.xml', '<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="2"/></cellXfs>'
    + '<dxfs><dxf><font><b/><color rgb="FF006644"/></font></dxf></dxfs></styleSheet>');
  zip.file('xl/worksheets/s0.xml', worksheet([
    row(1, formula('A1', '_xlfn.XLOOKUP("id-1",StockKeys,StockValues,1/0)'),
      formula('B1', '_xlfn.XLOOKUP("id-1",StockKeys,StockValues,,0,-1)'),
      formula('C1', 'MATCH("~*fixed",StockKeys,0)'),
      formula('D1', 'VLOOKUP("~*fixed",' + stock + 'A:B,2,FALSE())'),
      formula('E1', '_xlfn.XLOOKUP(,StockKeys,StockValues)'),
      formula('F1', 'HLOOKUP(8,Rates!2:3,2)'),
      formula('G1', '_xlfn.XMATCH("missing",StockKeys)'),
      formula('H1', '_xlfn.XLOOKUP("missing",StockKeys,StockValues,"none")')),
    row(2, formula('A2', '_xlfn.XLOOKUP("error",StockKeys,StockValues,"none")'),
      formula('B2', '_xlfn.XMATCH("id-1",StockKeys,0,-1)'),
      formula('C2', 'INDEX((Rates!D2:F2,Rates!D3:F3),1,2,2)'),
      formula('D2', '_xlfn.XLOOKUP(8,Rates!D2:F2,Rates!D3:F3,,1,2)'),
      formula('E2', 'VLOOKUP(8,Rates!D5:E10,2)'),
      formula('F2', 'VLOOKUP(8,Rates!D5:E10,2)', '', '<v>777</v>')),
    row(3, formula('A3', '_xlfn.ISFORMULA(INDEX(StockValues,1048576))'),
      formula('B3', '_xlfn.FORMULATEXT(LastStockValue)'),
      formula('C3', 'COUNTIF(INDEX(StockValues,1):LastStockValue,"Pallet*")'),
      formula('D3', 'SUM(INDEX(StockValues,5):INDEX(StockValues,1048576))'),
      formula('E3', 'SUM(INDEX(Rates!D2:F2,0,0))'),
      formula('F3', '_xlfn.FORMULATEXT(_xlfn.XLOOKUP("id-1",StockKeys,StockValues,,0,-1))'),
      formula('G3', 'SUM(_xlfn.XLOOKUP("Tier A",Rates!D3:F3,Rates!D2:F2):_xlfn.XLOOKUP("Tier C",Rates!D3:F3,Rates!D2:F2))')),
    row(1048576, formula('XFD1048576', 'INDEX(StockValues,_xlfn.XMATCH("ID-1",StockKeys,0,-1))', ' s="1"'))
  ], '<conditionalFormatting sqref="XFD1048576"><cfRule type="expression" priority="1" dxfId="0">'
    + '<formula>_xlfn.ISFORMULA(_xlfn.XLOOKUP("id-1",StockKeys,StockValues,,0,-1))</formula></cfRule></conditionalFormatting>'));
  zip.file('xl/worksheets/s1.xml', worksheet([
    row(1, scalar('A1', 'ID-1', 'str'), scalar('B1', 'Pallet A', 'str')),
    row(2, scalar('A2', 'Id-1', 'str'), scalar('B2', 'Pallet B', 'str')),
    row(3, scalar('A3', '*fixed', 'str'), scalar('B3', 1, 'b')),
    row(4, scalar('A4', 'error', 'str'), scalar('B4', '#DIV/0!', 'e')),
    row(5, scalar('B5', 55)),
    row(6, scalar('A6', '#N/A', 'e')),
    row(1048576, scalar('A1048576', 'iD-1', 'str'), formula('B1048576', 'Rates!A1*2'))
  ]));
  zip.file('xl/worksheets/s2.xml', worksheet([
    row(1, scalar('A1', 10)),
    row(2, scalar('D2', 2), scalar('E2', 6), scalar('F2', 10)),
    row(3, scalar('D3', 'Tier A', 'str'), scalar('E3', 'Tier B', 'str'), scalar('F3', 'Tier C', 'str')),
    row(5, scalar('D5', 2), scalar('E5', 'Low', 'str')),
    row(7, scalar('D7', 6), scalar('E7', 'Middle', 'str')),
    row(10, scalar('D10', 10), scalar('E10', 'High', 'str'))
  ]));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
