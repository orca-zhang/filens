import JSZip from 'jszip';

const row = (index, cells, attrs = '') => `<row r="${index}"${attrs}>${cells}</row>`;
const n = (ref, value) => `<c r="${ref}"><v>${value}</v></c>`;
const f = (ref, formula) => `<c r="${ref}"><f>${formula}</f></c>`;

export async function createHiddenTracksWorkbook({ formulas = true, forceGeneral = false } = {}) {
  const zip = new JSZip(), names = ['Sparse', 'Wide', 'Empty'];
  zip.file('xl/workbook.xml', '<workbook><sheets>' + names.map((name, i) => `<sheet name="${name}" sheetId="${i + 1}" r:id="s${i + 1}"/>`).join('')
    + '</sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships>' + names.map((_, i) => `<Relationship Id="s${i + 1}" Target="worksheets/s${i + 1}.xml"/>`).join('')
    + '</Relationships>');
  zip.file('xl/styles.xml', '<styleSheet><dxfs><dxf><fill><patternFill><bgColor rgb="FFDCFCE7"/></patternFill></fill></dxf></dxfs></styleSheet>');
  const data = rows => '<sheetData>' + (forceGeneral ? '<!-- general path -->' : '') + rows.join('') + '</sheetData>';
  zip.file('xl/worksheets/s1.xml', '<worksheet><sheetFormatPr defaultRowHeight="15" zeroHeight="true"/>'
    + '<cols><col min="2" max="2" width="0" hidden="1"/><col min="4" max="4" width="50" hidden="true"/>'
    + '<col min="6" max="16382" width="32" hidden="1"/><col min="16383" max="16384" width="10"/></cols>'
    + data([row(1, n('A1', 4) + (formulas ? f('B1', 'A1*2') : n('B1', 8)), ' hidden="true"'),
      row(3, n('A3', 2)), row(4, n('A4', 6), ' hidden="0"'), row(999, n('A999', 5), ' hidden="1"'),
      row(1048576, formulas ? f('XFD1048576', 'SUM(A1:A999)+B1') : n('XFD1048576', 25))])
    + '<mergeCells><mergeCell ref="B1:E4"/><mergeCell ref="D10:D14"/></mergeCells>'
    + '<conditionalFormatting sqref="B1"><cfRule type="expression" priority="1" dxfId="0"><formula>B1=8</formula></cfRule>'
    + '</conditionalFormatting></worksheet>');
  zip.file('xl/worksheets/s2.xml', '<worksheet><cols><col min="501" max="16100" width="15" hidden="1"/>'
    + '<col min="16384" max="16384" hidden="1"/></cols>'
    + data([row(1, n('A1', 7)), row(2, n('A2', 3), ' hidden="1"'),
      row(1048575, formulas ? f('XFC1048575', 'SUM(A1:A2)+XFD1048576') : n('XFC1048575', 110)),
      row(1048576, n('XFD1048576', 100), ' hidden="1"')])
    + '</worksheet>');
  zip.file('xl/worksheets/s3.xml', '<worksheet><sheetFormatPr defaultRowHeight="15" zeroHeight="1"/>'
    + '<cols><col min="1" max="16384" hidden="1"/></cols><sheetData/></worksheet>');
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
