import JSZip from 'jszip';

const escapeXml = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const rates = "'Rates O''Brien'!";

export async function createDefinedNameWorkbook() {
  const zip = new JSZip();
  const definitions = [
    ['Inputs', rates + '$A$1:$A$2'], ['inputs', 'Summary!$A$1:$A$2', 0],
    ['Rate', '2.5'], ['RATE', '3', 2], ['Tax', rates + '$B$1', 2],
    ['Across', `(${rates}$A$1,Summary!$A$2)`], ['AcrossAlias', '(aCrOsS)'],
    ['TextNumber', '"7"'], ['Ready', 'TRUE'], ['DoubleRate', '[0]!Rate*2'], ['OneCell', rates + '$A$1:$A$1'],
    ['LastRow', rates + '$1048576:$1048576'], ['FirstColumn', rates + '$A:$A'],
    ['LeftCell', '!XFD1'], ['LeftAlias', 'LeftCell'], ['NextTwo', '!$E1:$E2'],
    ['PriorRow', rates + '1048576:1048576'], ['LeftColumn', rates + 'XFD:XFD'],
    ['LocalPosition', '$B1', 2], ['XFE1', '12'], ['税率', '0.2'], ['\\Offset', '5'], ['__proto__', '6'],
    ['Broken', '#REF!'], ['LoopOne', 'LoopTwo'], ['LoopTwo', 'LoopOne'], ['Recent', 'Summary!$K$3'],
    ['Dup', '41'], ['Dup', '42', 0], ['dUP', '43', 0],
    ['MissingLocal', '99', 1], ['WrongScope', '100', 7], ['Not a name', '1'],
    ['External', "'[remote.xlsx]Totals'!$A$1"]
  ];
  zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="Summary" sheetId="5" r:id="summary"/>'
    + '<sheet name="Gap" sheetId="11"/><sheet name="Rates O&apos;Brien" sheetId="99" r:id="rates"/></sheets><definedNames>'
    + definitions.map(([name, formula, scope]) => `<definedName name="${name}"${scope === undefined ? '' : ` localSheetId="${scope}"`}>${escapeXml(formula)}</definedName>`).join('')
    + '</definedNames></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="summary" Target="worksheets/summary.xml"/>'
    + '<Relationship Id="rates" Target="worksheets/rates.xml"/></Relationships>');
  zip.file('xl/styles.xml', '<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="4"/></cellXfs></styleSheet>');
  const f = (ref, formula, cache = '', attributes = '') => `<c r="${ref}"${attributes}><f>${escapeXml(formula)}</f>${cache}</c>`;
  const n = (ref, value) => `<c r="${ref}"><v>${value}</v></c>`;
  const row = (index, cells) => `<row r="${index}">${cells.join('')}</row>`;
  const worksheet = rows => '<worksheet><sheetFormatPr defaultColWidth="13"/><sheetData>' + rows.join('') + '</sheetData></worksheet>';
  zip.file('xl/worksheets/summary.xml', worksheet([
    row(1, [n('A1', 2), f('B1', 'SUM(InPuTs)'), f('C1', 'SUM([0]!Inputs)'), f('D1', `SUM(AcrossAlias,${rates}Tax,TextNumber)`),
      f('E1', `rate+${rates}rate`), f('F1', 'IF(Ready,DoubleRate,LoopOne)'), f('G1', 'rate', '<v>99</v>'),
      f('H1', 'IFERROR(Broken,77)'), f('I1', 'LoopOne'), f('J1', 'Dup'), f('K1', 'External')]),
    row(2, [n('A2', 3), f('B2', `SUM(${rates}inputs)`), f('C2', `${rates}Tax & "!"`), f('D2', `${rates}LocalPosition`),
      n('E2', 12), f('F2', 'LeftAlias'), f('G2', 'SUM(NextTwo)'), f('H2', 'XFE1+税率+\\Offset+__proto__'),
      f('I2', 'IFERROR(Gap!MissingLocal,42)'), f('J2', 'WrongScope'), f('K2', '[1]!Rate')]),
    row(3, [f('A3', 'SUM(PriorRow)'), f('C3', 'OneCell+1'), n('E3', 21), f('F3', 'LeftAlias'), f('K3', 'Recent')]),
    row(4, [f('A4', 'LeftCell'), f('D4', 'SUM(LeftColumn)'), n('XFD4', 50)]),
    row(1048576, [f('XFD1048576', 'SUM(LastRow,FirstColumn)+[0]!Rate', '', ' s="1"')])
  ]));
  zip.file('xl/worksheets/rates.xml', worksheet([
    row(1, [n('A1', 11), '<c r="B1" t="inlineStr"><is><t>7</t></is></c>', n('C1', 6), f('D1', 'Rate'), f('E1', '[0]!Rate')]),
    row(2, [n('A2', 13), n('B2', 31), n('C2', 7)]),
    row(1048576, [n('XFD1048576', 41)])
  ]));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
