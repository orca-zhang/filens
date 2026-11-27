import JSZip from 'jszip';

const row = (index, ...cells) => `<row r="${index}">${cells.join('')}</row>`;
const cell = (ref, value, type = 'n') => `<c r="${ref}" t="${type}"><v>${value}</v></c>`;
const formula = (ref, expression, cached) =>
  `<c r="${ref}"><f>${expression.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</f>${cached === undefined ? '' : `<v>${cached}</v>`}</c>`;
const sheet = (...rows) => `<worksheet><sheetData>${rows.join('')}</sheetData></worksheet>`;

export async function createAggregateWorkbook() {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', `<workbook><sheets><sheet name="Summary" sheetId="1" r:id="s1"/>
    <sheet name="Ledger" sheetId="2" r:id="s2"/></sheets><definedNames>
    <definedName name="Revenue">Ledger!$A:$A</definedName></definedNames></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<Relationships><Relationship Id="s1" Target="worksheets/summary.xml"/>
    <Relationship Id="s2" Target="worksheets/ledger.xml"/></Relationships>`);
  zip.file('xl/worksheets/summary.xml', sheet(
    row(1, formula('A1', '_xlfn.AGGREGATE(9,3,Revenue)'), formula('B1', '_xlfn.AGGREGATE(12,3,Revenue)'),
      formula('C1', '_xlfn.AGGREGATE(14,7,Revenue,2)'), formula('D1', '_xlfn.AGGREGATE(4,6,Revenue)'),
      formula('E1', '_xlfn.AGGREGATE(9,4,Revenue)'), formula('F1', '_xlfn.AGGREGATE(9,4,Missing!A1)', 997)),
    row(2, formula('B2', '_xlfn.AGGREGATE(2,6,Ledger!E:XFD+0)')),
    row(1048576, formula('XFD1048576', '_xlfn.AGGREGATE(14,6,Ledger!XFD:XFD+0,1)'))));
  zip.file('xl/worksheets/ledger.xml', sheet(
    row(1, cell('A1', 10)),
    '<row r="2" hidden="1">' + cell('A2', 40) + '</row>',
    row(3, cell('A3', '#DIV/0!', 'e')),
    row(4, formula('A4', '_xlfn.AGGREGATE(9,6,A1)')),
    row(5, formula('A5', 'SUBTOTAL(9,A1)')),
    row(1048576, formula('A1048576', '3+4'), cell('XFD1048576', 20))));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
