import JSZip from 'jszip';
import { prefixXmlElements } from './worksheet-batches.mjs';

const row = (index, ...cells) => `<row r="${index}">${cells.join('')}</row>`;
const number = (ref, value) => `<c r="${ref}"><v>${value}</v></c>`;
const text = (ref, value) => `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${value}</t></is></c>`;
const formula = source => `<m:f>${source}</m:f>`;
const rule = (type, priority, body, attrs = '') => `<e:cfRule type="${type}" priority="${priority}"${attrs}>${body}</e:cfRule>`;
const group = (range, ...rules) => `<e:conditionalFormatting>${rules.join('')}<m:sqref>${range}</m:sqref></e:conditionalFormatting>`;
const fill = color => `<s:fill><s:patternFill><s:bgColor rgb="FF${color}"/></s:patternFill></s:fill>`;
const dxf = (...parts) => `<e:dxf>${parts.join('')}</e:dxf>`;

export async function createConditionalExtensionWorkbook({ streamed = false, prefixed = false } = {}) {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="Extended Rules" sheetId="1" r:id="s1"/>'
    + '<sheet name="Settings" sheetId="2" r:id="s2"/></sheets><definedNames><definedName name="Cap">Settings!$A$1</definedName>'
    + '</definedNames></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="s1" Target="worksheets/s1.xml"/>'
    + '<Relationship Id="s2" Target="worksheets/s2.xml"/></Relationships>');
  zip.file('xl/styles.xml', '<styleSheet><dxfs><dxf><font><i/><color rgb="FF990099"/></font></dxf></dxfs></styleSheet>');
  const scale = '<e:colorScale><e:cfvo type="min"/>'
    + `<e:cfvo type="formula">${formula('Cap')}</e:cfvo><e:color rgb="FF000000"/><e:color rgb="FFFFFFFF"/></e:colorScale>`;
  const extensions = [
    group('A1:A3 XFD1048576', rule('colorScale', 1, formula('A1>=20') + scale, ' activePresent="1"')),
    group('B1:B3', rule('cellIs', 2, formula('C1') + formula('$C$2+10') + dxf(
      '<s:font><s:b/><s:color rgb="FF006644"/></s:font>', '<s:numFmt numFmtId="164" formatCode="0.00&quot; units&quot;"/>',
      fill('CCFFCC'), '<s:border><s:top style="thin"><s:color rgb="FF112233"/></s:top></s:border>'),
    ' operator="between" stopIfTrue="1"')),
    group('D1:D2', rule('expression', 3, formula('AND($B1>20,ISEVEN(ROW()))') + dxf(fill('FFEEDD')))),
    group('E1:E3', rule('containsBlanks', 4, formula('LEN(TRIM(E1))=0') + dxf(fill('DDFFEE')))),
    group('F1:F3', rule('top10', 5, dxf(fill('CCDDFF')), ' rank="1"'),
      rule('aboveAverage', 6, dxf('<s:font><s:b/></s:font>'))),
    group('G1', rule('colorScale', 7, scale, ' activePresent="1"')),
    group('G1', rule('cellIs', 8, formula('0'), ' operator="between"')),
    group('G2', rule('futureType', 10, '')),
    group('H1:H3 XFC1048576', rule('containsText', 11, formula('ISNUMBER(SEARCH("a~?*",H1))') + dxf(fill('CCFFEE')),
      ' text="a~?*"')),
    group('H1:H3', rule('notContainsText', 12, formula('ISERROR(SEARCH("a~?*",H1))') + dxf(fill('FFEECC')),
      ' text="a~?*"')),
    group('I1:I3', rule('beginsWith', 13, formula('LEFT(I1,LEN("SKU"))="SKU"') + dxf('<s:font><s:b/></s:font>'), ' text="SKU"'),
      rule('endsWith', 14, formula('RIGHT(I1,LEN("end"))="end"') + dxf(fill('DDCCFF')), ' text="end"')),
    group('J1:J3', rule('containsErrors', 15, formula('ISERROR(J1)') + dxf(fill('FFCCCC'))),
      rule('notContainsErrors', 16, formula('NOT(ISERROR(J1))') + dxf(fill('CCFFCC')))),
    group('J1:J3 XFB1048576', rule('expression', 17, formula('_xlfn.ISFORMULA(J1)') + dxf('<s:font><s:b/></s:font>')))
  ].join('');
  const extraRows = streamed ? Array.from({ length: 14_000 }, (_, i) => row(i + 8, number(`H${i + 8}`, 1))).join('') : '';
  const worksheet = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    + ' xmlns:s="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    + ' xmlns:e="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"'
    + ' xmlns:m="http://schemas.microsoft.com/office/excel/2006/main">'
    + '<sheetFormatPr defaultColWidth="16"/><sheetData>'
    + row(1, number('A1', 10), number('B1', 15), number('C1', 9), number('D1', 0), text('E1', ' '), number('F1', 4),
      text('H1', 'has A? marker'), text('I1', 'SKU-start'), '<c r="J1"><f>NA()</f></c>')
    + row(2, number('A2', 20), number('B2', 25), number('C2', 12), number('D2', 1), text('E2', 'x'), number('F2', 7),
      text('H2', 'has Ax marker'), text('I2', 'other-END'), number('J2', 7))
    + row(3, number('A3', 30), number('B3', 8), number('C3', 5), number('F3', 5), number('H3', 123),
      text('I3', 'sKu-end'), '<c r="J3" t="e"><v>#VALUE!</v></c>')
    + extraRows + row(1048576, '<c r="XFB1048576"><f>1/0</f></c>', text('XFC1048576', 'Last a? marker'), number('XFD1048576', 40))
    + '</sheetData><conditionalFormatting sqref="B1:B3">'
    + '<cfRule type="expression" priority="9" dxfId="0"><formula>TRUE</formula></cfRule></conditionalFormatting>'
    + '<conditionalFormatting sqref="J1:J3"><cfRule type="expression" priority="18" dxfId="0">'
    + '<formula>_xlfn.ISFORMULA(J1)</formula></cfRule></conditionalFormatting>'
    + `<extLst><ext uri="{78C0D931-6437-407D-A8EE-F0AAD7539E65}"><e:conditionalFormattings>${extensions}`
    + '</e:conditionalFormattings></ext></extLst></worksheet>';
  zip.file('xl/worksheets/s1.xml', prefixed ? prefixXmlElements(worksheet) : worksheet);
  zip.file('xl/worksheets/s2.xml', `<worksheet><sheetData>${row(1, number('A1', 40))}</sheetData></worksheet>`);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
