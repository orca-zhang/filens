import JSZip from 'jszip';
import { prefixXmlElements } from './worksheet-batches.mjs';

export async function createLogicalBordersWorkbook() {
  const zip = new JSZip();
  const namespace = 'http://purl.oclc.org/ooxml/spreadsheetml/main';
  const relationships = 'http://purl.oclc.org/ooxml/officeDocument/relationships';
  const part = (path, xml) => zip.file('xl/' + path, prefixXmlElements(xml, namespace));
  part('workbook.xml', `<workbook xmlns:r="${relationships}"><sheets><sheet name="Borders" sheetId="1" r:id="s1"/></sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + `<Relationship Id="s1" Type="${relationships}/worksheet" Target="worksheets/s1.xml"/></Relationships>`);
  const stroke = (side, rgb) => `<${side} style="thick"><color rgb="FF${rgb}"/></${side}>`;
  const start = stroke('start', 'CC2222'), end = stroke('end', '2244CC');
  const green = stroke('start', '228844');
  const xf = (border, order) => `<xf borderId="${border}" applyBorder="1"><alignment readingOrder="${order}"/></xf>`;
  // Include legacy physical edges to exercise their interaction with Strict start/end.
  part('styles.xml', `<styleSheet><borders>
    <border>${start}${end}</border>
    <border>${stroke('left', 'CC2222')}${stroke('right', '2244CC')}</border>
    <border>${start}</border><border>${green}</border><border>${end}</border>
    </borders><cellXfs>${xf(0, 0)}${xf(0, 1)}${xf(0, 2)}${xf(1, 2)}${xf(2, 0)}${xf(3, 1)}${xf(4, 1)}</cellXfs>
    <dxfs>
      <dxf><border>${green}</border></dxf>
      <dxf><border><end style="none"/></border></dxf>
      <dxf><border>${stroke('left', 'CC6622')}${stroke('right', '9922AA')}</border></dxf>
      <dxf><numFmt numFmtId="164" formatCode="0;0;0;&quot;Prefix &quot;@"/></dxf>
      <dxf><border>${green}<right style="none"/></border></dxf>
      <dxf><border><start style="none"/></border></dxf>
    </dxfs></styleSheet>`);
  const hebrew = 'שלום / Latin';
  const cell = (ref, style = 0, text = hebrew) =>
    `<c r="${ref}" s="${style}" t="inlineStr"><is><t>${text}</t></is></c>`;
  const rule = (range, dxf, priority) => `<conditionalFormatting sqref="${range}"><cfRule type="expression"
    dxfId="${dxf}" priority="${priority}"><formula>1</formula></cfRule></conditionalFormatting>`;
  part('worksheets/s1.xml', `<worksheet>
    <sheetViews><sheetView rightToLeft="1" workbookViewId="0"/></sheetViews>
    <sheetFormatPr defaultColWidth="14" defaultRowHeight="24"/>
    <sheetData>
      <row r="1">${cell('A1')}${cell('B1', 1)}${cell('C1', 2, 'Latin / שלום')}${cell('D1', 3)}</row>
      <row r="2">${cell('A2')}${cell('B2', 1)}${cell('C2')}${cell('D2')}</row>
      <row r="4">${cell('A4', 4)}</row>
      <row r="5"><c r="A5" s="5"/><c r="CC5" s="6"/></row>
      <row r="7">${cell('A7', 4)}</row>
      <row r="8"><c r="A8" s="5"/></row>
    </sheetData>
    <mergeCells><mergeCell ref="A4:CC5"/><mergeCell ref="A7:B8"/></mergeCells>
    ${rule('A2:B2', 0, 1)}${rule('A2', 1, 2)}${rule('A2:B2', 2, 3)}
    ${rule('C2', 3, 4)}${rule('D2', 4, 5)}${rule('A7', 5, 6)}
  </worksheet>`);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
