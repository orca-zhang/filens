import JSZip from 'jszip';

export async function createHorizontalJustificationWorkbook() {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="Alignment" sheetId="1" r:id="sheet"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="sheet" Target="worksheets/sheet.xml"/></Relationships>');
  zip.file('xl/styles.xml', '<styleSheet><fonts><font><name val="Arial"/><sz val="11"/></font>'
    + '<font><name val="Arial"/><sz val="18"/></font></fonts><cellStyles><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
    + '<cellStyleXfs><xf fontId="0"/><xf fontId="0"><alignment horizontal="distributed"/></xf></cellStyleXfs>'
    + '<cellXfs><xf/><xf applyAlignment="1"><alignment horizontal="distributed"/></xf>'
    + '<xf applyAlignment="1"><alignment horizontal="justify" wrapText="0"/></xf>'
    + '<xf fontId="1" applyAlignment="1"><alignment horizontal="distributed" indent="2"/></xf>'
    + '<xf applyAlignment="1"><alignment horizontal="justify" justifyLastLine="1"/></xf><xf xfId="1" applyAlignment="0"/>'
    + '<xf applyAlignment="1"><alignment horizontal="distributed" indent="2"/></xf>'
    + '</cellXfs></styleSheet>');
  const text = (ref, style, value) => `<c r="${ref}" s="${style}" t="str"><v>${value}</v></c>`;
  const rich = (ref, style) => `<c r="${ref}" s="${style}" t="inlineStr"><is><r><t xml:space="preserve">AB </t></r>`
    + '<r><rPr><b/><color rgb="FFB91C1C"/></rPr><t>CD</t></r></is></c>';
  const pair = 'Alpha beta';
  zip.file('xl/worksheets/sheet.xml', '<worksheet><sheetFormatPr defaultColWidth="20" defaultRowHeight="15"/>'
    + '<cols><col min="5" max="5" hidden="1"/></cols><sheetData>'
    + `<row r="1">${text('A1', 1, pair)}${text('B1', 2, pair)}${rich('C1', 3)}${text('D1', 4, pair)}</row>`
    + `<row r="2">${text('A2', 2, 'Alpha beta gamma delta epsilon zeta theta kappa lambda mu nu xi omicron pi rho sigma tau upsilon')}`
    + `${text('B2', 1, 'One two&#10;&#10;Three four')}</row>`
    + '<row r="3" ht="19" customHeight="1"><c r="A3" s="1"><v>42</v></c>'
    + `${text('C3', 6, pair)}</row>`
    + `<row r="4">${text('A4', 5, 'Solo&#10;Term')}</row>`
    + `<row r="10">${text('A10', 6, pair)}</row>`
    + '<row r="1048576"><c r="XFD1048576" s="1"><f>&quot;Omega end&quot;</f></c></row>'
    + '</sheetData><mergeCells><mergeCell ref="A10:AZ11"/></mergeCells></worksheet>');
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
