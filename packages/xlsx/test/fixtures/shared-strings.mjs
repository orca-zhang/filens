import JSZip from 'jszip';
import { prefixXmlElements } from './worksheet-batches.mjs';

export const sharedStringsLastValue = '  Batch & 星表 ²';

export async function createSharedStringsWorkbook(count = 12_000, { forceGeneral = false, styled = false, prefixed = false, strict = false } = {}) {
  const zip = new JSZip(), date = new Date('2020-01-01T00:00:00Z');
  const items = Array.from({ length: count }, (_, index) =>
    `<si><t>Catalog entry ${index}: observations collected by the observatory across several seasons and viewing conditions.</t></si>`);
  items[0] = '<si><t xml:space="preserve">  Northern sky &#x2605;  </t></si>';
  items[1] = '<si/>';
  items[count - 1] = '<si><r><t xml:space="preserve">  Batch &amp; </t></r>'
    + '<r><rPr><rFont val="Courier New"/><b/><color rgb="FF336699"/></rPr><t>星表 </t></r>'
    + '<r><rPr><vertAlign val="superscript"/></rPr><t>²</t></r><rPh sb="0" eb="5"><t>phonetic</t></rPh></si>';
  const rows = Array.from({ length: count - 1 }, (_, index) => {
    const row = index + 1;
    return `<row r="${row}"><c r="A${row}" t="s"><v>${index}</v></c></row>`;
  }).join('');
  const relationshipNamespace = strict ? 'http://purl.oclc.org/ooxml/officeDocument/relationships'
    : 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const files = {
    'xl/workbook.xml': '<workbook>' + (styled ? '<workbookPr date1904="1"/>' : '')
      + '<sheets><sheet name="Catalog" sheetId="1" r:id="rId1"/><sheet name="Summary" sheetId="2" r:id="rId2"/></sheets>'
      + (styled ? '<definedNames><definedName name="CatalogTail">Catalog!$XFD$1048576</definedName></definedNames>' : '')
      + '</workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/catalog.xml"/>'
      + '<Relationship Id="rId2" Target="worksheets/summary.xml"/>'
      + `<Relationship Id="rId3" Type="${relationshipNamespace}/sharedStrings" Target="catalog-strings.xml"/></Relationships>`,
    'xl/catalog-strings.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'
      + `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${count + 1}" uniqueCount="${count}">`
      + (forceGeneral ? '<!-- shared string table using the general parser -->' : '') + items.join('\r\n') + '</sst>\n',
    'xl/worksheets/catalog.xml': '<worksheet><sheetData>' + rows + '<row r="1048576">'
      + `<c r="XFD1048576" t="s"><v>${count - 1}</v></c></row></sheetData></worksheet>`,
    'xl/worksheets/summary.xml': '<worksheet><sheetData><row r="1">'
      + `<c r="A1" t="s"><v>${count - 1}</v></c>`
      + (styled ? '<c r="B1" s="1"><f>LEN(CatalogTail)</f></c>'
        : '<c r="B1"><f>LEN(Catalog!XFD1048576)</f></c>')
      + '</row></sheetData></worksheet>',
  };
  if (styled) {
    files['xl/styles.xml'] = '<styleSheet><fonts><font><name val="Arial"/></font>'
      + '<font><name val="Georgia"/><color rgb="FF123456"/></font></fonts>'
      + '<cellXfs><xf/><xf fontId="1" numFmtId="2"/></cellXfs></styleSheet>';
  }
  if (prefixed) {
    const namespace = strict ? 'http://purl.oclc.org/ooxml/spreadsheetml/main' : undefined;
    files['xl/workbook.xml'] = files['xl/workbook.xml']
      .replace('<workbook>', `<workbook xmlns:r="urn:foreign" xmlns:links="${relationshipNamespace}">`)
      .replace(/r:id="(rId[12])"/g, 'r:id="ignored" links:id="$1"');
    files['xl/_rels/workbook.xml.rels'] = prefixXmlElements(files['xl/_rels/workbook.xml.rels'],
      'http://schemas.openxmlformats.org/package/2006/relationships');
    for (const name of Object.keys(files)) {
      if (!name.endsWith('.rels')) files[name] = prefixXmlElements(files[name], namespace);
    }
  }
  for (const [name, contents] of Object.entries(files)) zip.file(name, contents, { date, createFolders: false });
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
