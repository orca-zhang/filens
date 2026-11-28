import JSZip from 'jszip';

const rule = (type, priority, style, attributes = '') => `<cfRule type="${type}" priority="${priority}" dxfId="${style}" ${attributes}/>`;
const area = (sqref, ...rules) => `<conditionalFormatting sqref="${sqref}">${rules.join('')}</conditionalFormatting>`;
const row = (index, ...cells) => `<row r="${index}">${cells.join('')}</row>`;
const value = (ref, text, type = 'n') => `<c r="${ref}" t="${type}"><v>${text}</v></c>`;
const formula = (ref, text) => `<c r="${ref}"><f>${text}</f></c>`;

export async function createConditionalStatisticsWorkbook({ aboveDeviation = '-1', belowDeviation = '-1' } = {}) {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="Statistics" sheetId="1" r:id="s1"/>'
    + '<sheet name="Input" sheetId="2" r:id="s2"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="s1" Target="worksheets/s1.xml"/>'
    + '<Relationship Id="s2" Target="worksheets/s2.xml"/></Relationships>');
  const fill = (color, font = '') => `<dxf>${font}<fill><patternFill><bgColor rgb="FF${color}"/></patternFill></fill></dxf>`;
  zip.file('xl/styles.xml', '<styleSheet><dxfs>' + fill('FFCDD2') + '<dxf><font><i/></font></dxf>'
    + '<dxf><font><b/></font></dxf>' + fill('DCFCE7') + fill('FED7AA') + fill('DCFCE7', '<font><b/></font>') + '</dxfs></styleSheet>');
  const rows = [
    row(1, value('A1', 10), value('B1', 1), value('C1', 0), value('D1', 'Apple', 'str'),
      value('E1', 0), value('F1', '1e308'), value('G1', '1000000000000000'), value('H1', -1), value('I1', 27)),
    row(2, value('A2', 20), value('B2', 2), value('C2', 1), formula('D2', '"aPPLE"'),
      value('E2', 50), value('F2', '-1e308'), value('G2', '1000000000000000.125'), value('H2', 1)),
    row(3, value('A3', 20), value('B3', 3), value('C3', 2), value('D3', 'pear', 'str'),
      value('E3', 100), value('F3', 0), value('G3', '1000000000000000.25'), value('H3', -2)),
    row(4, value('A4', 30), value('B4', 4), formula('C4', '""'), value('D4', 'p*', 'str'), value('H4', -6)),
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
  const signedRange = 'E1:E3 XFD1048576';
  const formats = [
    area('A1:A1048576 A2:A4 XFD1048576', rule('top10', 1, 0, 'rank="3"'), rule('top10', 2, 2, 'rank="25" percent="true" bottom="1"'),
      rule('top10', 3, 4, 'rank="2" bottom="true"')),
    area('B1:B7', rule('top10', 4, 0, 'rank="39" percent="1"'), rule('top10', 5, 2, 'rank="1" percent="1"')),
    area('C1:C6 C2:C3', rule('aboveAverage', 6, 2, 'equalAverage="true"'), rule('aboveAverage', 7, 1, 'aboveAverage="0" equalAverage="1"'),
      rule('aboveAverage', 8, 0, 'stdDev="1"'), rule('aboveAverage', 9, 4, 'aboveAverage="false" stdDev="1"')),
    area('D1:D1048576 D5:D6', rule('duplicateValues', 10, 0, 'stopIfTrue="1"'), rule('uniqueValues', 11, 3)),
    area('F1:F3', rule('aboveAverage', 12, 0, 'stdDev="1"')),
    area('G1:G3', rule('aboveAverage', 13, 2, 'equalAverage="1"'), rule('aboveAverage', 14, 0)),
    area('I1', rule('top10', 15, 0, 'rank="0" percent="1"')),
    area('H1:H4', rule('aboveAverage', 16, 2, 'equalAverage="1"'), rule('aboveAverage', 17, 0)),
    area(signedRange, rule('aboveAverage', 18, 5, `stdDev="${aboveDeviation}"`))
  ];
  zip.file('xl/worksheets/s1.xml', '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    + ' xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main">'
    + `<sheetData>${rows.join('')}</sheetData>${formats.join('')}`
    + '<extLst><ext uri="{78C0D931-6437-407D-A8EE-F0AAD7539E65}"><x14:conditionalFormattings><x14:conditionalFormatting>'
    + `<x14:cfRule type="aboveAverage" priority="19" aboveAverage="0" stdDev="${belowDeviation}"><x14:dxf><font><i/></font></x14:dxf>`
    + `</x14:cfRule><xm:sqref>${signedRange}</xm:sqref></x14:conditionalFormatting></x14:conditionalFormattings></ext></extLst></worksheet>`);
  zip.file('xl/worksheets/s2.xml', '<worksheet><sheetData>' + row(1, value('A1', 20)) + '</sheetData></worksheet>');
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createSpillConditionalStatisticsWorkbook() {
  const zip = await JSZip.loadAsync(await createConditionalStatisticsWorkbook());
  const spill = (ref, range, expression) => `<c r="${ref}"><f t="array" ref="${range}">${expression}</f></c>`;
  zip.file('xl/styles.xml', '<styleSheet><dxfs><dxf><font><b/></font></dxf><dxf><font><i/></font></dxf>'
    + '<dxf><font><color rgb="FF663399"/></font></dxf><dxf><font><color rgb="FF005577"/></font></dxf></dxfs></styleSheet>');
  const formats = area('A1:XFD1048576 B2:E100',
    '<cfRule type="colorScale" priority="1"><colorScale><cfvo type="percentile" val="0.01"/>'
      + '<cfvo type="percentile" val="0.02"/><cfvo type="max"/>'
      + '<color rgb="FF0000FF"/><color rgb="FF00FF00"/><color rgb="FFFF0000"/></colorScale></cfRule>',
    rule('top10', 2, 0, 'rank="3"'), rule('aboveAverage', 3, 1, 'stdDev="1"'),
    rule('duplicateValues', 4, 2), rule('uniqueValues', 5, 3));
  zip.file('xl/worksheets/s1.xml', '<worksheet><sheetData>'
    + row(1, value('A1', 5), spill('B1', 'B1:C1048576', 'Input!A:B+10'), spill('D1', 'D1:XFD1048576', 'Input!D:XFD+20'))
    + row(2, value('B2', 30), value('D2', 'saved', 'str'))
    + row(3, '<c r="E3" s="0"/>')
    + row(4, value('F4', '#N/A', 'e'))
    + '</sheetData>' + formats + '</worksheet>');
  zip.file('xl/worksheets/s2.xml', '<worksheet><sheetData>'
    + row(1, value('A1', -20))
    + row(2, value('A2', -9), value('B2', 30))
    + row(1048576, value('XFD1048576', 60))
    + '</sheetData></worksheet>');
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createDeviationCutoffWorkbook({ volatileCutoff = false } = {}) {
  const zip = await JSZip.loadAsync(await createConditionalStatisticsWorkbook());
  const boundary = [0, -2, 1, 0, 0, 1];
  const rows = boundary.map((number, i) => {
    const index = i + 1;
    return row(index, i === 5 ? '' : value(`A${index}`, number), value(`B${index}`, -number),
      value(`C${index}`, i === 5 ? 1 + Number.EPSILON : number), value(`D${index}`, i === 5 ? 1 - Number.EPSILON / 2 : number));
  });
  const formats = [
    area('A1:A6 XFD1048576', rule('aboveAverage', 1, 0, 'stdDev="1"'), rule('aboveAverage', 2, 1, 'aboveAverage="0" stdDev="-1"')),
    area('B1:B6', rule('aboveAverage', 3, 0, 'aboveAverage="0" stdDev="1"'), rule('aboveAverage', 4, 2, 'stdDev="-1"')),
    area('C1:C6', rule('aboveAverage', 5, 0, 'stdDev="1"')),
    area('D1:D6', rule('aboveAverage', 6, 0, 'stdDev="1"'))
  ];
  // Keep six observations in the first rule, with the last value stored at the far corner.
  rows.push(row(1048576, formula('XFD1048576', volatileCutoff ? '1+(TODAY()-45292)*2^-52' : 'Input!A1/20')));
  zip.file('xl/worksheets/s1.xml', `<worksheet><sheetData>${rows.join('')}</sheetData>${formats.join('')}</worksheet>`);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createWeightedDeviationCutoffWorkbook() {
  const zip = await JSZip.loadAsync(await createConditionalStatisticsWorkbook());
  const spill = (ref, range, expression) => `<c r="${ref}"><f t="array" ref="${range}">${expression}</f></c>`;
  const formats = area('A1:XFD1048576 B2:E100', rule('aboveAverage', 1, 0, 'stdDev="1"'),
    rule('aboveAverage', 2, 3, 'aboveAverage="0" stdDev="-1"'));
  zip.file('xl/worksheets/s1.xml', '<worksheet><sheetData>'
    + row(1, spill('A1', 'A1:LCB1048576', 'Input!A:LCB*0'), spill('LCC1', 'LCC1:XFD1048576', 'Input!LCC:XFD+2'))
    + '</sheetData>' + formats + '</worksheet>');
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
