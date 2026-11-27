import JSZip from 'jszip';

const row = (index, ...cells) => `<row r="${index}">${cells.join('')}</row>`;
const cell = (ref, value) => `<c r="${ref}"><v>${value}</v></c>`;
const calc = (ref, formula, cached) =>
  `<c r="${ref}"><f>${formula}</f>${cached === undefined ? '' : `<v>${cached}</v>`}</c>`;
const sheet = (...rows) => `<worksheet><sheetData>${rows.join('')}</sheetData></worksheet>`;

export async function createLetWorkbook() {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', `<workbook><sheets><sheet name="Summary" sheetId="1" r:id="s1"/>
    <sheet name="Ledger" sheetId="2" r:id="s2"/></sheets><definedNames>
    <definedName name="Revenue">Ledger!$A:$A</definedName></definedNames></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<Relationships><Relationship Id="s1" Target="worksheets/summary.xml"/>
    <Relationship Id="s2" Target="worksheets/ledger.xml"/></Relationships>`);
  zip.file('xl/worksheets/summary.xml', sheet(
    row(1, calc('A1', '_xlfn.LET(_xlpm.Revenue,5,_xlpm.revenue+SUM([0]!Revenue))'),
      calc('B1', 'LET(src,Revenue,total,SUM(src),total*2+INDEX(src,1048576))'),
      calc('C1', 'LET(rate,5,LET(rate,rate+3,rate)+rate)'),
      calc('D1', 'LET(weights,Ledger!A1:A2+2,SUMPRODUCT(weights*weights))'),
      calc('E1', 'LET(fail,NA(),IFERROR(fail,"saved fallback"))'),
      calc('F1', 'LET(weights,Ledger!A1:A2+2,TEXTJOIN("/",TRUE,weights))'),
      calc('G1', 'LET(saved,MISSING(),saved)', 991)),
    row(1048576, calc('XFD1048576', 'LET(large,Ledger!E:XFD+1,SUMPRODUCT(large*large))'))));
  zip.file('xl/worksheets/ledger.xml', sheet(
    row(1, cell('A1', 2)), row(2, cell('A2', 3)),
    row(1048576, calc('A1048576', '16'), cell('XFD1048576', 4))));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
