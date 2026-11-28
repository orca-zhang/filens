import { randomBytes } from 'node:crypto';
import JSZip from 'jszip';
import { createWorkbookFixture } from './workbook.mjs';
import { prefixXmlElements } from './worksheet-batches.mjs';

export const workbookAttachmentText = 'Remote workbook attachment.';
export const secondWorksheetMarker = 'Second 1';
export const thirdWorksheetMarker = 'Third sheet for deferred calculation';

function largeWorksheetRows(finalColumn = false) {
  const contents = randomBytes(2500 * 1024).toString('base64');
  const rows = Array.from({ length: Math.ceil(contents.length / 1024) }, (_, index) => {
    const row = index + 241, value = contents.slice(index * 1024, (index + 1) * 1024);
    const escaped = row === 900 ? '<c r="B900" t="inlineStr"><is><t>North &amp; &lt;South&gt; &#20013;&#x1F603;</t></is></c>' : '';
    return `<row r="${row}"><c r="A${row}" t="inlineStr"><is><t>${value}</t></is></c>${escaped}</row>`;
  });
  return rows.join('') + '<row r="1048576"><c r="B1048576"><v>21</v></c>'
    + (finalColumn ? '<c r="XFD1048576"><v>42</v></c>' : '') + '</row>';
}

export async function createLargeFirstWorksheetFixture({ rotatedTitle = false, prefixed = false, wideFirstRow = false, rightToLeft = false,
  frozenOrigin = '', viewOrigin = '' } = {}) {
  const zip = await JSZip.loadAsync(await createWorkbookFixture());
  const date = new Date('2020-01-01T00:00:00Z');
  const worksheet = 'xl/worksheets/sheet1.xml';
  zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="First" sheetId="1" r:id="rId1"/></sheets></workbook>', { date });
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>', { date });
  zip.file('xl/styles.xml', '<styleSheet><dxfs><dxf><fill><patternFill patternType="solid"><fgColor rgb="FF00FF00"/></patternFill></fill></dxf></dxfs>'
    + (rotatedTitle ? `<cellXfs><xf/><xf><alignment textRotation="1"${rightToLeft ? ' horizontal="right"' : ''}/></xf></cellXfs>` : '') + '</styleSheet>', { date });
  zip.remove('xl/worksheets/sheet2.xml');
  let xml = (await zip.file(worksheet).async('text'))
    .replace('<sheetData>', '<sheetFormatPr defaultRowHeight="20"/><sheetData>')
    .replace('<is><t>First 1</t></is>', '<is><r><rPr><color rgb="FF336699"/></rPr><t>First 1</t></r></is>')
    .replace('<row r="45">', '<row r="45" hidden="1">')
    .replace('<row r="46">', '<row r="46" ht="39" customHeight="1">')
    .replace('SUM(B1:B2)</f></c>', 'SUM(B1,B1048576)</f></c><c r="D1"><f>B1048576</f><v>41</v></c>')
    .replace('</sheetData>', largeWorksheetRows(Boolean(viewOrigin)) + '</sheetData><mergeCells><mergeCell ref="A3:D3"/></mergeCells>')
    .replace('</worksheet>', '<conditionalFormatting sqref="C1"><cfRule type="expression" priority="1" dxfId="0"><formula>B1048576=21</formula></cfRule></conditionalFormatting></worksheet>');
  if (rotatedTitle) xml = xml.replace('<row r="110">', '<row r="110"><c r="E110" s="1" t="str"><v>'
    + 'A rotated title opened from the first range. '.repeat(18).trimEnd() + '</v></c>');
  if (rightToLeft || frozenOrigin || viewOrigin) {
    const topLeft = viewOrigin ? ` topLeftCell="${viewOrigin}"` : '';
    xml = xml.replace('<sheetFormatPr', `<sheetViews><sheetView workbookViewId="0" rightToLeft="${Number(rightToLeft)}"${topLeft}>`
      + (frozenOrigin ? `<pane state="frozen" ySplit="2" xSplit="1" topLeftCell="${frozenOrigin}"/>` : '')
      + '</sheetView></sheetViews><sheetFormatPr');
  }
  if (wideFirstRow) {
    const value = 'Wide-row text &amp; notes. '.repeat(700);
    const cells = Array.from({ length: 40 }, (_, i) => `<c${i ? '' : ' r="CA1"'} t="inlineStr"><is><t>${value}</t></is></c>`).join('');
    xml = xml.replace('</row>', cells + '</row>');
  }
  zip.file(worksheet, prefixed ? prefixXmlElements(xml) : xml, { date });
  zip.file('xl/media/unused.bin', new Uint8Array(1024 * 1024), { date, compression: 'STORE' });
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

export async function createRangeWorkbookFixture({ streamed = false, progressive = false, activeTab } = {}) {
  const zip = await JSZip.loadAsync(await createWorkbookFixture());
  const first = zip.file('xl/worksheets/sheet1.xml'), second = zip.file('xl/worksheets/sheet2.xml');
  const date = new Date('2020-01-01T00:00:00Z');
  const dependency = streamed && !progressive ? 'B1048576' : 'B3';
  let firstXml = (await first.async('text')).replace('SUM(B1:B2)', `SUM(B1,'${progressive ? 'Third' : 'Second'}'!${dependency})`);
  if (progressive) {
    firstXml = firstXml.replace('</row>', '<c r="D1"><f>Third!B3*2</f><v>101</v></c></row>')
      .replace('</worksheet>', '<conditionalFormatting sqref="C1"><cfRule type="expression" priority="1" dxfId="0"><formula>Third!B3=21</formula></cfRule></conditionalFormatting></worksheet>');
    for (const [path, closing, extra] of [
      ['xl/workbook.xml', '</sheets>', '<sheet name="Third" sheetId="3" r:id="rId3"/>'],
      ['xl/_rels/workbook.xml.rels', '</Relationships>', '<Relationship Id="rId3" Target="worksheets/sheet3.xml"/>']
    ]) zip.file(path, (await zip.file(path).async('text')).replace(closing, extra + closing), { date });
    zip.file('xl/worksheets/sheet3.xml',
      `<worksheet><sheetData><row r="3"><c r="A3" t="inlineStr"><is><t>${thirdWorksheetMarker}</t></is></c><c r="B3"><v>21</v></c></row></sheetData></worksheet>`,
      { date, compression: 'STORE' });
    zip.file('xl/styles.xml', '<styleSheet><dxfs><dxf><fill><patternFill patternType="solid"><fgColor rgb="FF00FF00"/></patternFill></fill></dxf></dxfs></styleSheet>', { date });
  }
  if (activeTab !== undefined) {
    const workbook = zip.file('xl/workbook.xml');
    zip.file(workbook.name, (await workbook.async('text')).replace('<sheets>',
      `<bookViews><workbookView activeTab="${activeTab}"/></bookViews><sheets>`), { date });
  }
  zip.file(first.name, firstXml, { date, compression: activeTab === undefined ? 'DEFLATE' : 'STORE' });
  let secondXml = await second.async('text');
  if (activeTab === 1) secondXml = secondXml.replace('<sheetData>',
    '<sheetViews><sheetView workbookViewId="0" topLeftCell="A54"/></sheetViews><sheetData>');
  if (streamed) secondXml = secondXml.replace('</sheetData>', largeWorksheetRows() + '</sheetData>');
  zip.file(second.name, secondXml, { date, compression: streamed ? 'DEFLATE' : 'STORE' });
  zip.file('xl/embeddings/notes.txt', workbookAttachmentText, { date, compression: 'STORE' });
  // Keep the attachment and the worksheets outside the range containing the ZIP directory.
  zip.file('xl/media/unused.bin', new Uint8Array(1024 * 1024), { date, compression: 'STORE' });
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
