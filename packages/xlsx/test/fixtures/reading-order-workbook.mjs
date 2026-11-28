import JSZip from 'jszip';

export async function createReadingOrderWorkbook() {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="Reading order" sheetId="1" r:id="s1"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="s1" Target="worksheets/s1.xml"/></Relationships>');
  const xfs = [
    '<xf/>',
    '<xf><alignment readingOrder="0"/></xf>',
    '<xf><alignment readingOrder="1" horizontal="right"/></xf>',
    '<xf><alignment readingOrder="2" horizontal="left"/></xf>',
    '<xf xfId="1" applyAlignment="0"><alignment readingOrder="1"/></xf>',
    '<xf><alignment readingOrder="7"/></xf>',
    '<xf><alignment readingOrder="2" horizontal="centerContinuous"/></xf>',
    '<xf><alignment readingOrder="2" horizontal="fill"/></xf>',
    '<xf><alignment readingOrder="2" shrinkToFit="1"/></xf>',
    '<xf><alignment readingOrder="2" textRotation="30"/></xf>',
    '<xf><alignment readingOrder="2" textRotation="180" vertical="distributed"/></xf>',
    '<xf><alignment readingOrder="2" textRotation="90" vertical="distributed"/></xf>',
    '<xf numFmtId="164"/>',
    '<xf><alignment readingOrder="2" horizontal="right"/></xf>'
  ];
  zip.file('xl/styles.xml', '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="0;0;0;&quot;Prefix &quot;@"/></numFmts>'
    + '<fonts><font><sz val="11"/><name val="Arial"/></font></fonts>'
    + '<cellStyleXfs><xf/><xf><alignment readingOrder="2"/></xf></cellStyleXfs><cellXfs>' + xfs.join('') + '</cellXfs></styleSheet>');
  const arabic = 'نص عربي / English text';
  const hebrew = 'שלום / Latin!';
  const mixed = 'Latin / שלום!';
  const text = (ref, value, style = 0) => `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${value}</t></is></c>`;
  const rich = (ref, style) => `<c r="${ref}" s="${style}" t="inlineStr"><is><r><t xml:space="preserve">שלום / </t></r>`
    + '<r><rPr><b/></rPr><t>Latin!</t></r></is></c>';
  zip.file('xl/worksheets/s1.xml', `<worksheet><sheetFormatPr defaultColWidth="28" defaultRowHeight="17"/>
    <sheetData>
      <row r="1">${text('A1', arabic)}${text('B1', arabic, 1)}${text('C1', arabic, 2)}${text('D1', mixed, 3)}</row>
      <row r="2">${text('A2', '1 ' + hebrew, 1)}${text('B2', '(' + hebrew, 5)}${text('C2', mixed, 4)}${text('D2', '&#x85;𞤀 / Latin!')}</row>
      <row r="3" ht="25" customHeight="1">${rich('A3', 0)}${rich('B3', 12)}<c r="C3"><f>"${hebrew}"</f></c>${text('D3', mixed, 13)}</row>
      <row r="4" ht="55" customHeight="1">${text('A4', mixed.repeat(5), 8)}${text('B4', mixed, 7)}${text('D4', mixed, 9)}</row>
      <row r="5">${text('A5', mixed, 6)}<c r="B5" s="6"/>${text('D5', mixed + ' ' + 'X'.repeat(27), 13)}</row>
      <row r="6" ht="90" customHeight="1">${text('A6', mixed + '&#10;TAIL', 10)}${text('B6', mixed + '&#10;TAIL', 11)}</row>
      <row r="7" ht="24" customHeight="1">${text('A7', mixed, 13)}</row>
      <row r="1048576" ht="24" customHeight="1">${text('XFD1048576', hebrew, 3)}</row>
    </sheetData><mergeCells><mergeCell ref="A7:CC7"/></mergeCells></worksheet>`);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
