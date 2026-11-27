import JSZip from 'jszip';
import { prefixXmlElements } from './worksheet-batches.mjs';

export async function createRepeatedConditionalWorkbook(duplicates = 2000, { storeWorksheet = false, prefixed = false, linkedBar = false } = {}) {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="Repeated Rules" sheetId="1" r:id="s1"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="s1" Target="worksheets/s1.xml"/></Relationships>');
  const fill = rgb => `<fill><patternFill><bgColor rgb="FF${rgb}"/></patternFill></fill>`;
  const styles = [fill('FFCDD2'), fill('DCFCE7'), '<font><b/></font>', '<font><i/></font>',
    '<numFmt numFmtId="165" formatCode="0.0"/>', fill('CCDDFF')];
  zip.file('xl/styles.xml', `<styleSheet><dxfs>${styles.map(style => `<dxf>${style}</dxf>`).join('')}</dxfs></styleSheet>`);
  const whole = 'A1:XFD1048576';
  const values = 'A1:B4 XFD1048576';
  const smaller = 'D1:D2 D4:D5';
  const baseRule = (priority, style, formula, stop = false) => `<cfRule type="expression" priority="${priority}" dxfId="${style}"`
    + `${stop ? ' stopIfTrue="1"' : ''}><formula>${formula}</formula></cfRule>`;
  const group = (range, body) => `<conditionalFormatting sqref="${range}">${body}</conditionalFormatting>`;
  const red = (priority) => `<e:cfRule type="expression" priority="${priority}"><m:f>A1&gt;0</m:f>`
    + `<e:dxf>${styles[0]}</e:dxf></e:cfRule>`;
  const extensionGroup = (range, body) => `<e:conditionalFormatting>${body}<m:sqref>${range}</m:sqref></e:conditionalFormatting>`;
  const bar = linkedBar ? '<cfRule type="dataBar" priority="12"><dataBar><cfvo type="min"/><cfvo type="max"/>'
    + '<color rgb="FF0000FF"/></dataBar><extLst><ext uri="{B025F937-C7B1-47D3-B67F-A62EFF666E3E}">'
    + '<e:id>{BAR}</e:id></ext></extLst></cfRule><cfRule type="expression" priority="0"/>' : '';
  const barExtension = linkedBar ? '<e:cfRule type="dataBar" id="{bar}"><e:dataBar gradient="0" direction="rightToLeft">'
    + '<e:cfvo type="autoMin"/><e:cfvo type="autoMax"/><e:fillColor rgb="FF00FF00"/></e:dataBar>'
    + '<m:f>A1&gt;0</m:f></e:cfRule><e:cfRule type="unsupported" priority="13"/>' : '';
  const repetitions = Math.floor(duplicates / 2);
  const base = [group(whole, bar + baseRule(2, 1, 'A1&gt;0') + baseRule(3, 2, 'AND(A1&gt;0,COLUMN()=2)', true)
    + baseRule(4, 3, 'A1&gt;0') + Array.from({ length: repetitions }, (_, index) => baseRule(index + 20, 0, 'A1&gt;0')).join('')),
  group(values, '<cfRule type="top10" priority="5" rank="1" dxfId="4"/>'),
  group(smaller, baseRule(7, 5, '$C1&gt;0')), group('D4:D5 D1:D2', baseRule(8, 5, '$C1&gt;0')),
  group('F1', baseRule(9, 5, 'TRUE') + baseRule(10, 5, 'TRUE', true) + baseRule(11, 3, 'TRUE'))].join('');
  const extension = extensionGroup(whole, red(1)
    + Array.from({ length: duplicates - repetitions }, (_, index) => red(index + repetitions + 20)).join('') + barExtension)
    + extensionGroup(values, '<e:cfRule type="aboveAverage" priority="6"><e:dxf><font><strike/></font></e:dxf></e:cfRule>');
  const worksheet = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    + ' xmlns:e="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" xmlns:m="http://schemas.microsoft.com/office/excel/2006/main">'
    + '<sheetData><row r="1"><c r="A1"><v>4</v></c><c r="B1"><v>5</v></c><c r="C1"><v>1</v></c><c r="F1"><v>0</v></c></row>'
    + '<row r="2"><c r="A2"><v>-1</v></c><c r="B2"><v>1</v></c></row><row r="3"><c r="A3"><v>6</v></c></row>'
    + '<row r="1048576"><c r="XFD1048576"><v>9</v></c></row></sheetData>' + base
    + '<extLst><ext uri="{78C0D931-6437-407D-A8EE-F0AAD7539E65}"><e:conditionalFormattings>' + extension
    + '</e:conditionalFormattings></ext></extLst></worksheet>';
  zip.file('xl/worksheets/s1.xml', prefixed ? prefixXmlElements(worksheet) : worksheet,
    { compression: storeWorksheet ? 'STORE' : 'DEFLATE' });
  if (storeWorksheet) zip.file('xl/media/padding.bin', new Uint8Array(128 * 1024), { compression: 'STORE' });
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
