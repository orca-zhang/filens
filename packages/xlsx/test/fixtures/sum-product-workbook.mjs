import JSZip from 'jszip';

const row = (number, ...cells) => `<row r="${number}">${cells.join('')}</row>`;
const cell = (ref, value, type = 'n') => `<c r="${ref}" t="${type}"><v>${value}</v></c>`;
const formula = (ref, expression, cached) => `<c r="${ref}"><f>${expression}</f>${cached ? `<v>${cached}</v>` : ''}</c>`;
const worksheet = (...rows) => `<worksheet><sheetData>${rows.join('')}</sheetData></worksheet>`;

export async function createSumProductWorkbook() {
  const zip = new JSZip(), orders = "'Orders'!";
  zip.file('xl/workbook.xml', `<workbook><sheets><sheet name="Totals" sheetId="1" r:id="s1"/>
    <sheet name="Orders" sheetId="2" r:id="s2"/></sheets><definedNames>
    <definedName name="Units">${orders}$A:$A</definedName>
    <definedName name="Regions">${orders}$C:$C</definedName></definedNames></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<Relationships>
    <Relationship Id="s1" Target="worksheets/s1.xml"/>
    <Relationship Id="s2" Target="worksheets/s2.xml"/></Relationships>`);
  zip.file('xl/worksheets/s1.xml', worksheet(
    row(1, formula('A1', `SUMPRODUCT(Units,${orders}B:B)`),
      formula('B1', `SUMPRODUCT(--(Regions=A2),${orders}B:B)`),
      formula('C1', `SUMPRODUCT((Regions=A2)*(${orders}B:B+1))`),
      formula('D1', `SUMPRODUCT(${orders}A1:B1,{10;20})`),
      formula('E1', `SUMPRODUCT(${orders}D:D,${orders}E:E)`),
      formula('F1', `SUMPRODUCT(Units,${orders}B:B)`, '777'),
      formula('G1', 'SUMPRODUCT(Missing!B:B)')),
    row(2, cell('A2', 'east', 'str')),
    row(1048576, formula('XFD1048576', `SUMPRODUCT(--(${orders}E1:XFD1048576=0))`))));
  zip.file('xl/worksheets/s2.xml', worksheet(
    row(1, cell('A1', 2), cell('B1', 3), cell('C1', 'East', 'str')),
    row(3, cell('A3', 4), cell('B3', 10), cell('C3', 'West', 'str')),
    row(4, cell('A4', 8, 'str'), cell('B4', 5), cell('C4', 'East', 'str')),
    row(9, cell('D9', '#N/A', 'e')),
    row(1048576, cell('A1048576', 7), formula('B1048576', '1+1'),
      cell('C1048576', 'East', 'str'), cell('XFD1048576', 11))));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
