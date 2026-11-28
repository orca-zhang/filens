import JSZip from 'jszip';

export async function createVerticalJustificationWorkbook() {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="Vertical alignment" sheetId="1" r:id="sheet"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="sheet" Target="worksheets/sheet.xml"/></Relationships>');
  zip.file('xl/styles.xml', '<styleSheet><cellStyleXfs><xf/><xf><alignment vertical="distributed"/></xf></cellStyleXfs>'
    + '<cellXfs><xf/><xf><alignment vertical="justify" wrapText="0"/></xf><xf xfId="1" applyAlignment="0"/>'
    + '<xf><alignment vertical="distributed" horizontal="distributed"/></xf><xf><alignment wrapText="1"/></xf>'
    + '<xf><alignment horizontal="centerContinuous" vertical="distributed"/></xf>'
    + '<xf><alignment vertical="justify" horizontal="center"/></xf></cellXfs></styleSheet>');
  const value = (ref, style, text) => `<c r="${ref}" s="${style}" t="str"><v>${text}</v></c>`;
  const row = (r, cells, height) => `<row r="${r}"${height ? ` ht="${height}" customHeight="1"` : ''}>${cells}</row>`;
  const lines = 'First&#10;Second&#10;Third';
  const long = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon';
  const rich = '<c r="D1" s="3" t="inlineStr"><is><r><t>Word pair&#10;</t></r>'
    + '<r><rPr><sz val="18"/><color rgb="FFB91C1C"/></rPr><t>Color run</t></r></is></c>';
  const across = 'BCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').concat(Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ', col => `A${col}`))
    .map(col => `<c r="${col}5" s="5"/>`).join('');
  zip.file('xl/worksheets/sheet.xml', '<worksheet><sheetFormatPr defaultColWidth="22" defaultRowHeight="15"/>'
    + '<cols><col min="5" max="5" hidden="1"/></cols><sheetData>'
    + row(1, value('A1', 1, lines) + value('B1', 2, 'Solo') + value('C1', 1, 'Start') + rich, 90)
    + row(2, value('A2', 1, long))
    + row(3, value('A3', 4, long) + value('B3', 2, 'Upper&#10;Lower'))
    + row(4, value('A4', 1, lines), 12)
    + row(5, value('A5', 5, lines) + across, 90)
    + row(6, value('A6', 2, lines))
    + row(20, value('A20', 6, 'Top mark&#10;Middle mark&#10;Bottom mark')) + '<row r="21" hidden="1"/>'
    + row(1048576, '<c r="XFD1048576" s="1"><f>&quot;TOP&quot;&amp;CHAR(10)&amp;&quot;TAIL&quot;</f></c>', 75)
    + '</sheetData><mergeCells><mergeCell ref="A6:C6"/><mergeCell ref="A20:AZ219"/></mergeCells></worksheet>');
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
