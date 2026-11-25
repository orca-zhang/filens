import JSZip from 'jszip';

const rule = (type, priority, style, attributes = '') => `<cfRule type="${type}" priority="${priority}" dxfId="${style}" ${attributes}/>`;
const area = (sqref, ...rules) => `<conditionalFormatting sqref="${sqref}">${rules.join('')}</conditionalFormatting>`;
const row = (index, ...cells) => `<row r="${index}">${cells.join('')}</row>`;
const value = (ref, text, type = 'n') => `<c r="${ref}" t="${type}"><v>${text}</v></c>`;
const formula = (ref, text) => `<c r="${ref}"><f>${text}</f></c>`;

export async function createConditionalStatisticsWorkbook() {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="Statistics" sheetId="1" r:id="s1"/>'
    + '<sheet name="Input" sheetId="2" r:id="s2"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="s1" Target="worksheets/s1.xml"/>'
    + '<Relationship Id="s2" Target="worksheets/s2.xml"/></Relationships>');
  const fill = (color) => `<dxf><fill><patternFill><bgColor rgb="FF${color}"/></patternFill></fill></dxf>`;
  zip.file('xl/styles.xml', '<styleSheet><dxfs>' + fill('FFCDD2') + '<dxf><font><i/></font></dxf>'
    + '<dxf><font><b/></font></dxf>' + fill('DCFCE7') + fill('FED7AA') + '</dxfs></styleSheet>');
  const rows = [
    row(1, value('A1', 10), value('B1', 1), value('C1', 0), value('D1', 'Apple', 'str'),
      value('F1', '1e308'), value('G1', '1000000000000000'), value('I1', 27)),
    row(2, value('A2', 20), value('B2', 2), value('C2', 1), formula('D2', '"aPPLE"'),
      value('F2', '-1e308'), value('G2', '1000000000000000.125')),
    row(3, value('A3', 20), value('B3', 3), value('C3', 2), value('D3', 'pear', 'str'),
      value('F3', 0), value('G3', '1000000000000000.25')),
    row(4, value('A4', 30), value('B4', 4), formula('C4', '""'), value('D4', 'p*', 'str')),
    row(5, value('A5', '20', 'str'), value('B5', 5), value('C5', '#N/A', 'e'), value('D5', 'x?', 'str')),
    row(6, value('A6', 1, 'b'), value('D6', 'AXY', 'str')),
    row(7, value('D7', 'apple!', 'str')),
    row(8, value('D8', '~?', 'str')),
    row(9, value('D9', '?', 'str')),
    row(10, value('D10', '30', 'str')),
    row(11, value('D11', 30)),
    row(12, value('D12', 1, 'b')),
    row(13, formula('D13', '""')),
    row(14, value('D14', '#N/A', 'e')),
    row(15, value('D15', 1, 'b')),
    row(1048576, value('D1048576', 'pear', 'str'), formula('XFD1048576', 'Input!A1+30'))
  ];
  const formats = [
    area('A1:A1048576 A2:A4 XFD1048576', rule('top10', 1, 0, 'rank="3"'), rule('top10', 2, 2, 'rank="25" percent="true" bottom="1"'),
      rule('top10', 3, 4, 'rank="2" bottom="true"')),
    area('B1:B7', rule('top10', 4, 0, 'rank="39" percent="1"'), rule('top10', 5, 2, 'rank="1" percent="1"')),
    area('C1:C6 C2:C3', rule('aboveAverage', 6, 2, 'equalAverage="true"'), rule('aboveAverage', 7, 1, 'aboveAverage="0" equalAverage="1"'),
      rule('aboveAverage', 8, 0, 'stdDev="1"'), rule('aboveAverage', 9, 4, 'aboveAverage="false" stdDev="1"')),
    area('D1:D1048576 D5:D6', rule('duplicateValues', 10, 0, 'stopIfTrue="1"'), rule('uniqueValues', 11, 3)),
    area('F1:F3', rule('aboveAverage', 12, 0, 'stdDev="1"')),
    area('G1:G3', rule('aboveAverage', 13, 2, 'equalAverage="1"'), rule('aboveAverage', 14, 0)),
    area('I1', rule('top10', 15, 0, 'rank="0" percent="1"'))
  ];
  zip.file('xl/worksheets/s1.xml', `<worksheet><sheetData>${rows.join('')}</sheetData>${formats.join('')}</worksheet>`);
  zip.file('xl/worksheets/s2.xml', '<worksheet><sheetData>' + row(1, value('A1', 20)) + '</sheetData></worksheet>');
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
