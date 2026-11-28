import JSZip from 'jszip';

export async function createPathGradientWorkbook() {
  const zip = new JSZip();
  const spreadsheet = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const relationships = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const packageRelationships = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const extension = 'http://schemas.microsoft.com/office/spreadsheetml/2009/9/main';
  const contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml';
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + `<Override PartName="/xl/workbook.xml" ContentType="${contentType}.sheet.main+xml"/>`
    + `<Override PartName="/xl/worksheets/sheet.xml" ContentType="${contentType}.worksheet+xml"/>`
    + `<Override PartName="/xl/styles.xml" ContentType="${contentType}.styles+xml"/></Types>`);
  zip.file('_rels/.rels', `<Relationships xmlns="${packageRelationships}">`
    + `<Relationship Id="office" Type="${relationships}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file('xl/workbook.xml', `<workbook xmlns="${spreadsheet}" xmlns:r="${relationships}">`
    + '<sheets><sheet name="Gradient" sheetId="1" r:id="sheet"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', `<Relationships xmlns="${packageRelationships}">`
    + `<Relationship Id="sheet" Type="${relationships}/worksheet" Target="worksheets/sheet.xml"/>`
    + `<Relationship Id="styles" Type="${relationships}/styles" Target="styles.xml"/></Relationships>`);
  const fill = (edges, stops, ns = '') => `<${ns}fill><${ns}gradientFill type="path"${edges}>`
    + stops.map(([position, color]) => `<${ns}stop position="${position}"><${ns}color ${color}/></${ns}stop>`).join('')
    + `</${ns}gradientFill></${ns}fill>`;
  const frame = fill(' left="0.2" right="0.7" top="0.25" bottom="0.75"', [
    [0, 'rgb="FFFFFFFF"'], [.4, 'rgb="FFD21831"'], [.6, 'rgb="FFD21831"'], [1, 'rgb="FF1847C7"']
  ]);
  const corner = fill('', [[0, 'rgb="FF078151"'], [1, 'rgb="FF222222"']]);
  const extended = fill(' left="0.3" right="0.65" top="0.28" bottom="0.68"', [
    [0, 'rgb="FFFDE467"'], [.4, 'rgb="FF02AF89"'], [.6, 'rgb="FF02AF89"'], [1, 'theme="4"']
  ], 's:');
  zip.file('xl/styles.xml', `<styleSheet xmlns="${spreadsheet}">`
    + `<fills><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${frame}${corner}</fills>`
    + '<cellXfs><xf/><xf fillId="2" applyFill="1"/><xf fillId="3" applyFill="1"/></cellXfs>'
    + `<dxfs><dxf>${frame}</dxf></dxfs></styleSheet>`);
  zip.file('xl/worksheets/sheet.xml', `<worksheet xmlns="${spreadsheet}" xmlns:s="${spreadsheet}" xmlns:x14="${extension}"`
    + ' xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main">'
    + '<sheetFormatPr defaultColWidth="19" defaultRowHeight="24" customHeight="1"/><sheetData>'
    + '<row r="1" ht="75" customHeight="1"><c r="A1" s="1"/><c r="B1" s="2"/><c r="C1"><v>42</v></c></row>'
    + '<row r="5"><c r="A5" s="1"><v>42</v></c></row>'
    + '<row r="1048576" ht="75" customHeight="1"><c r="XFD1048576" s="1"><v>42</v></c></row></sheetData>'
    + '<mergeCells><mergeCell ref="A5:AZ204"/></mergeCells>'
    + '<conditionalFormatting sqref="C1"><cfRule type="cellIs" operator="equal" priority="2" dxfId="0">'
    + '<formula>42</formula></cfRule></conditionalFormatting>'
    + '<extLst><ext uri="{78C0D931-6437-407D-A8EE-F0AAD7539E65}"><x14:conditionalFormattings>'
    + `<x14:conditionalFormatting><x14:cfRule type="expression" priority="1"><xm:f>A5=42</xm:f><x14:dxf>${extended}</x14:dxf>`
    + '</x14:cfRule><xm:sqref>A5</xm:sqref></x14:conditionalFormatting></x14:conditionalFormattings></ext></extLst></worksheet>');
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
