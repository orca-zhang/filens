import JSZip from 'jszip';

export async function createWorkbookFixture() {
  const zip = new JSZip(), date = new Date('2020-01-01T00:00:00Z');
  zip.file('xl/workbook.xml', '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="First" sheetId="1" r:id="rId1"/><sheet name="Second" sheetId="2" r:id="rId2"/></sheets></workbook>', { date });
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>', { date });
  for (const [index, name] of ['First', 'Second'].entries()) {
    const rows = Array.from({ length: 240 }, (_, index) => {
      const row = index + 1;
      return `<row r="${row}"><c r="A${row}" t="inlineStr"><is><t>${name} ${row}</t></is></c><c r="B${row}"><v>${row * 7}</v></c>${row === 1 ? '<c r="C1"><f>SUM(B1:B2)</f></c>' : ''}</row>`;
    });
    zip.file(`xl/worksheets/sheet${index + 1}.xml`, `<worksheet><sheetData>${rows.join('')}</sheetData></worksheet>`, { date });
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createColumnStyledWorkbookFixture(rowCount = 240, columnCount = 8, { columnStyles = true, general = false, sheetDataAttributes = '' } = {}) {
  const zip = new JSZip(), date = new Date('2020-01-01T00:00:00Z');
  const names = Array.from({ length: columnCount }, (_, index) => {
    let column = index + 1, name = '';
    while (column) { name = String.fromCharCode(65 + (column - 1) % 26) + name; column = Math.floor((column - 1) / 26); }
    return name;
  });
  const columns = columnStyles ? '<cols>' + names.map((_, index) => `<col min="${index + 1}" max="${index + 1}" style="${index % 3}" width="12" customWidth="1"/>`).join('') + '</cols>' : '';
  const rows = Array.from({ length: rowCount }, (_, index) => {
    const row = index + 1;
    return `<row r="${row}"${row % 11 === 0 ? ' customFormat="1" s="2"' : ''}>` + names.map((name, column) =>
      `<c r="${name}${row}"${column % 7 === 0 ? ' s="0"' : ''}${column % 5 === 1 ? ' t="s"' : ''}><v>${column % 5 === 1 ? column % 2 : row * columnCount + column}</v></c>`).join('') + '</row>';
  });
  for (const [file, contents] of Object.entries({
    'xl/workbook.xml': '<workbook><sheets><sheet name="Column styles" sheetId="1" r:id="sheet"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="sheet" Target="worksheets/sheet.xml"/></Relationships>',
    'xl/styles.xml': '<styleSheet><fonts><font><name val="Arial"/></font><font><name val="Courier New"/></font><font><name val="Times New Roman"/></font></fonts><cellXfs><xf fontId="0"/><xf fontId="1"/><xf fontId="2"/></cellXfs></styleSheet>',
    'xl/sharedStrings.xml': '<sst><si><t>Shared 中文</t></si><si><t>Names &amp; notes</t></si></sst>',
    'xl/worksheets/sheet.xml': `<worksheet>${columns}<sheetData${general ? ' custom="1"' : ''}${sheetDataAttributes}>${general ? '<!-- general XML parser -->' : ''}${rows.join('')}</sheetData></worksheet>`
  })) zip.file(file, contents, { date });
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createMergedWorkbookFixture({ general = false, formulas = false } = {}) {
  const zip = new JSZip(), date = new Date('2020-01-01T00:00:00Z');
  const rows = '<row r="1"><c r="A1" t="s" s="1"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>'
    + '<row r="10"><c r="J10"><v>7</v></c></row><row r="11"><c r="J11"><v>8</v></c></row>'
    + `<row r="90"><c r="B90" s="1">${formulas ? '<f>SUM(J10:J11)</f>' : '<v>15</v>'}</c></row>`
    + '<row r="180"><c r="AF180" t="s"><v>2</v></c></row>'
    + '<row r="500"><c r="A500" t="s"><v>3</v></c></row>'
    + `<row r="2000"><c r="BL2000">${formulas ? '<f>SUM(J10:J11)</f>' : '<v>15</v>'}</c></row>`;
  for (const [name, contents] of Object.entries({
    'xl/workbook.xml': '<workbook><sheets><sheet name="Merged" sheetId="1" r:id="sheet"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="sheet" Target="worksheets/sheet.xml"/></Relationships>',
    'xl/styles.xml': '<styleSheet><fonts><font><name val="Arial"/></font><font><name val="Courier New"/><b/></font></fonts><cellXfs><xf fontId="0"/><xf fontId="1"/></cellXfs></styleSheet>',
    'xl/sharedStrings.xml': '<sst><si><t>Merged heading</t></si><si><t>Covered value</t></si><si><t>Cross-axis</t></si><si><t>Tall merge</t></si></sst>',
    'xl/worksheets/sheet.xml': `<worksheet><sheetData>${general ? '<!-- general parser -->' : ''}${rows}</sheetData><mergeCells count="5">`
      + ['A1:D3', 'B90:H130', 'AF180:BL260', 'A500:BL1700', 'M1900:P1950'].map(ref => `<mergeCell ref="${ref}"/>`).join('')
      + '</mergeCells></worksheet>'
  })) zip.file(name, contents, { date });
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createColumnWidthWorkbookFixture({ general = false, extreme = false } = {}) {
  const zip = await JSZip.loadAsync(await createMergedWorkbookFixture({ general }));
  const widths = '<sheetFormatPr baseColWidth="8" defaultColWidth="10"/><cols>'
    + [[1, 4], [2, 28], [3, 8.7109375], [4, 12], [31, 255], [64, 20]]
      .map(([column, width]) => `<col min="${column}" max="${column}" width="${width}" customWidth="1"/>`).join('') + '</cols>';
  zip.file('xl/worksheets/sheet.xml', extreme
    ? `<worksheet>${widths.replace('</cols>', '<col min="16384" max="16384" width="30"/></cols>')}<sheetData>`
      + '<row r="1"><c r="A1"><v>7</v></c><c r="B1"><v>8</v></c></row>'
      + '<row r="1048576"><c r="XFD1048576"><f>SUM(A1:B1)</f></c></row></sheetData></worksheet>'
    : (await zip.file('xl/worksheets/sheet.xml').async('string')).replace('<sheetData>', `${widths}<sheetData>`));
  zip.file('xl/styles.xml', '<styleSheet><fonts><font><name val="Arial"/><sz val="11"/></font><font><name val="Courier New"/><sz val="12"/></font></fonts>'
    + '<cellStyleXfs><xf fontId="0"/><xf fontId="1"/></cellStyleXfs><cellXfs><xf fontId="0"/><xf fontId="1"/></cellXfs>'
    + '<cellStyles><cellStyle name="常规" builtinId="0" xfId="1"/></cellStyles></styleSheet>');
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
