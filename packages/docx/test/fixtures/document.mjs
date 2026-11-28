import { strFromU8, strToU8, unzipSync, zipSync, zlibSync } from 'fflate';

const crcTable = Uint32Array.from({ length: 256 }, (_, i) => {
  for (let bit = 0; bit < 8; bit++) i = i & 1 ? 0xedb88320 ^ (i >>> 1) : i >>> 1;
  return i >>> 0;
});
const pngChunk = (name, bytes) => {
  const chunk = new Uint8Array(bytes.length + 12), view = new DataView(chunk.buffer);
  view.setUint32(0, bytes.length); chunk.set(strToU8(name), 4); chunk.set(bytes, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, -4)) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  view.setUint32(chunk.length - 4, (crc ^ 0xffffffff) >>> 0); return chunk;
};
const png = (seed = 12345) => {
  const size = 256, pixels = new Uint8Array((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const offset = y * (size * 4 + 1) + x * 4 + 1;
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    pixels.set([seed & 255, (seed >>> 8) & 255, (seed >>> 16) & 255, 255], offset);
  }
  const header = new Uint8Array(13), view = new DataView(header.buffer);
  view.setUint32(0, size); view.setUint32(4, size); header.set([8, 6], 8);
  const chunks = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header), pngChunk('IDAT', zlibSync(pixels)), pngChunk('IEND', new Uint8Array())];
  const result = new Uint8Array(chunks.reduce((sum, bytes) => sum + bytes.length, 0));
  let offset = 0; for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; } return result;
};

export function createDocxFixture(images = 400) {
  const ns = 'http://schemas.openxmlformats.org', rel = `${ns}/officeDocument/2006/relationships`;
  const image = i => `<w:p><w:r><w:t>Image ${i + 1}</w:t></w:r><w:r><w:drawing><wp:inline><wp:extent cx="609600" cy="609600"/><wp:docPr id="${i + 1}" name="Image ${i + 1}"/><a:graphic xmlns:a="${ns}/drawingml/2006/main"><a:graphicData uri="${ns}/drawingml/2006/picture"><pic:pic xmlns:pic="${ns}/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${i + 1}" name="noise.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImage"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="609600" cy="609600"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>${(i + 1) % 20 === 0 && i + 1 < images ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : ''}`;
  const files = {
    '[Content_Types].xml': `<Types xmlns="${ns}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    '_rels/.rels': `<Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/_rels/document.xml.rels': `<Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="rIdImage" Type="${rel}/image" Target="media/noise.png"/></Relationships>`,
    'word/document.xml': `<w:document xmlns:w="${ns}/wordprocessingml/2006/main" xmlns:r="${rel}" xmlns:wp="${ns}/drawingml/2006/wordprocessingDrawing"><w:body>${Array.from({ length: images }, (_, i) => image(i)).join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr></w:body></w:document>`
  };
  return zipSync(Object.fromEntries([...Object.entries(files).map(([name, text]) => [name, [strToU8(text), { mtime: new Date(2020, 0, 1) }]]),
    ['word/media/noise.png', [png(), { mtime: new Date(2020, 0, 1) }]]]), { level: 6 });
}

export function createDistinctDocxImagesFixture(count = 8) {
  const files = unzipSync(createDocxFixture(count + 1));
  const bodyPath = 'word/document.xml', relsPath = 'word/_rels/document.xml.rels';
  const template = strFromU8(files[relsPath]);
  const targets = Array.from({ length: count }, (_, i) => i);
  let image = 0;
  files[bodyPath] = strToU8(strFromU8(files[bodyPath]).replace(/r:embed="rIdImage"/g, () => `r:embed="rIdImage${image++ % count}"`));
  files[relsPath] = strToU8(template.replace(/<Relationship Id="rIdImage"[^>]+\/>/, tag =>
    targets.map(i => tag.replace('rIdImage', `rIdImage${i}`).replace('noise.png', `image-${i}.png`)).join('')));
  delete files['word/media/noise.png'];
  for (const i of targets) files[`word/media/image-${i}.png`] = png(12345 + i);
  files['word/media/tail.bin'] = new Uint8Array(128 * 1024);
  return zipSync(files, { level: 0 });
}

export function createDocxPaginationFixture() {
  const ns = 'http://schemas.openxmlformats.org', rel = `${ns}/officeDocument/2006/relationships`;
  const word = `xmlns:w="${ns}/wordprocessingml/2006/main"`;
  const p = (text, properties = '') => `<w:p>${properties && `<w:pPr>${properties}</w:pPr>`}<w:r><w:t>${text}</w:t></w:r></w:p>`;
  const newPage = '<w:pStyle w:val="NewPage"/>';
  const parts = {
    '[Content_Types].xml': `<Types xmlns="${ns}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
    '_rels/.rels': `<Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="body" Type="${rel}/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/_rels/document.xml.rels': `<Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="styles" Type="${rel}/styles" Target="styles.xml"/></Relationships>`,
    'word/styles.xml': `<w:styles ${word}><w:style w:type="paragraph" w:styleId="BreakBase"><w:pPr><w:pageBreakBefore/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="BreakMiddle"><w:basedOn w:val="BreakBase"/></w:style><w:style w:type="paragraph" w:styleId="NewPage"><w:basedOn w:val="BreakMiddle"/></w:style><w:style w:type="paragraph" w:styleId="NoBreak"><w:basedOn w:val="BreakBase"/><w:pPr><w:pageBreakBefore w:val="0"/></w:pPr></w:style></w:styles>`,
    'word/document.xml': `<w:document ${word}><w:body>${p('First paragraph', newPage)}${p('Before jump')}`
      + p('Inherited', newPage) + p('Direct override', newPage + '<w:pageBreakBefore w:val="0"/>') + p('Style override', '<w:pStyle w:val="NoBreak"/>')
      + '<w:p><w:pPr><w:pageBreakBefore/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Direct start</w:t><w:br w:type="page"/><w:t>After explicit</w:t><w:lastRenderedPageBreak/><w:t>After saved</w:t></w:r></w:p>'
      + '<w:p><w:hyperlink w:anchor="tail"><w:r><w:t>Link before</w:t><w:lastRenderedPageBreak/><w:t>Link after</w:t></w:r></w:hyperlink></w:p>'
      + '<w:p><w:bookmarkStart w:id="0" w:name="tail"/><w:r><w:t>Tail</w:t></w:r><w:bookmarkEnd w:id="0"/></w:p>'
      + '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr></w:body></w:document>'
  };
  return zipSync(Object.fromEntries(Object.entries(parts).map(([name, xml]) => [name, strToU8(xml)])));
}

export function createDocxTablePaginationFixture() {
  const ns = 'http://schemas.openxmlformats.org';
  const saved = '<w:lastRenderedPageBreak/>';
  const bookmark = '<w:bookmarkStart w:id="1" w:name="table-start"/><w:bookmarkEnd w:id="1"/>';
  const paragraph = run => '<w:p><w:r>' + run + '</w:r></w:p>';
  const text = value => '<w:t>' + value + '</w:t>';
  const cell = (body, props = '') => '<w:tc><w:tcPr>' + props + '</w:tcPr>' + body + '</w:tc>';
  const row = (cells, header = '') => '<w:tr><w:trPr>' + header + '</w:trPr>' + cells + '</w:tr>';
  const table = rows => '<w:tbl><w:tblPr><w:tblW w:w="7200" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>'
    + '<w:tblGrid><w:gridCol w:w="4320"/><w:gridCol w:w="2880"/></w:tblGrid>' + rows + '</w:tbl>';
  const first = table(
    row(cell('<w:p>' + bookmark + '<w:r>' + text('Factor') + '</w:r></w:p>') + cell(paragraph(text('Value'))), '<w:tblHeader/>')
    + row(cell(paragraph(text('Before row break'))) + cell(paragraph(text('One'))))
    + row(cell(paragraph(saved + text('After row break'))) + cell(paragraph(text('Two'))))
  );
  const second = table(
    row(cell('<w:p><w:r>' + saved + '</w:r><w:hyperlink w:anchor="table-start"><w:r><w:rPr><w:b/></w:rPr>'
      + text('Before cell break') + saved + text('After cell break') + '</w:r></w:hyperlink></w:p>') + cell('<w:p/>'))
    + row(cell(paragraph(text('Following row'))) + cell(paragraph(text('Three'))))
  );
  const merged = table(
    row(cell(paragraph(text('Merged across rows')), '<w:vMerge w:val="restart"/>') + cell(paragraph(text('Top right'))))
    + row(cell(paragraph(saved), '<w:vMerge/>') + cell(paragraph(text('Bottom right'))))
  );
  const parts = {
    '[Content_Types].xml': `<Types xmlns="${ns}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    '_rels/.rels': `<Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="body" Type="${ns}/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/document.xml': `<w:document xmlns:w="${ns}/wordprocessingml/2006/main"><w:body>`
      + paragraph(text('Opening')) + first + second + paragraph(text('Closing')) + merged
      + '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr></w:body></w:document>'
  };
  return zipSync(Object.fromEntries(Object.entries(parts).map(([name, xml]) => [name, strToU8(xml)])));
}

export function createDocxColumnBreakFixture(rightToLeft, compatibilityMode) {
  const ns = 'http://schemas.openxmlformats.org', rel = `${ns}/officeDocument/2006/relationships`;
  const word = `xmlns:w="${ns}/wordprocessingml/2006/main"`;
  const columnBreak = '<w:br w:type="column"/>';
  const section = type => '<w:sectPr>' + (type ? `<w:type w:val="${type}"/>` : '')
    + '<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/>'
    + '<w:cols w:num="3" w:equalWidth="0" w:sep="1"><w:col w:w="3600" w:space="300"/>'
    + '<w:col w:w="3000" w:space="300"/><w:col w:w="3600"/></w:cols>'
    + (rightToLeft ? '<w:bidi/>' : '') + '</w:sectPr>';
  const parts = {
    '_rels/.rels': `<Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="body" Type="${rel}/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/_rels/document.xml.rels': `<Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="settings" Type="${rel}/settings" Target="settings.xml"/></Relationships>`,
    '[Content_Types].xml': `<Types xmlns="${ns}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>`,
    'word/settings.xml': `<w:settings ${word}><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="${compatibilityMode}"/></w:compat></w:settings>`,
    'word/document.xml': `<w:document ${word}><w:body><w:p><w:hyperlink w:anchor="tail"><w:r><w:rPr><w:b/></w:rPr>`
      + '<w:t>Initial column</w:t>' + columnBreak + '<w:lastRenderedPageBreak/><w:t>Manual column</w:t>'
      + '</w:r></w:hyperlink></w:p><w:p><w:pPr>' + section() + '</w:pPr></w:p>'
      + '<w:p><w:r><w:t>New section</w:t>' + columnBreak + '<w:t>After the third column</w:t></w:r></w:p>'
      + '<w:p><w:bookmarkStart w:id="0" w:name="tail"/><w:r><w:t>Tail</w:t></w:r><w:bookmarkEnd w:id="0"/></w:p>'
      + section('nextColumn') + '</w:body></w:document>'
  };
  return zipSync(Object.fromEntries(Object.entries(parts).map(([name, xml]) => [name, strToU8(xml)])));
}

export function createDocxSectionsFixture(evenAndOddHeaders) {
  const ns = 'http://schemas.openxmlformats.org', rel = `${ns}/officeDocument/2006/relationships`;
  const word = `xmlns:w="${ns}/wordprocessingml/2006/main"`;
  const portrait = '<w:pgSz w:w="12240" w:h="15840"/>';
  const landscape = '<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/>';
  const margins = '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>';
  const ref = (kind, type, id) => `<w:${kind}Reference w:type="${type}" r:id="${id}"/>`;
  const type = value => `<w:type w:val="${value}"/>`;
  const sect = contents => `<w:sectPr>${contents}</w:sectPr>`;
  const p = (text, properties = '', before = '') =>
    `<w:p>${properties && `<w:pPr>${properties}</w:pPr>`}<w:r>${before}<w:t>${text}</w:t></w:r></w:p>`;
  const parts = {
    '_rels/.rels': `<Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="body" Type="${rel}/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/settings.xml': `<w:settings ${word}><w:evenAndOddHeaders w:val="${evenAndOddHeaders ? 1 : 0}"/></w:settings>`,
    'word/document.xml': `<w:document ${word} xmlns:r="${rel}"><w:body>`
      + p('Portrait opening', sect(ref('header', 'default', 'main') + ref('header', 'first', 'first')
        + ref('header', 'even', 'even') + ref('footer', 'default', 'base') + ref('footer', 'even', 'alternate') + portrait + margins))
      + p('Next section', sect(ref('footer', 'default', 'replacement') + portrait + margins + '<w:titlePg/>'))
      + p('Continuous on the same page')
      + p('Continuous after a hard break', sect(ref('header', 'default', 'continuous') + type('continuous') + portrait + margins + '<w:cols w:num="2" w:space="360"/>'), '<w:br w:type="page"/>')
      + p('Landscape section', sect(type('continuous')))
      + p('Even section', '<w:pageBreakBefore/>', '<w:lastRenderedPageBreak/>')
      + p('End of even section', sect(type('evenPage') + landscape + margins))
      + p('Continuous after a saved break', sect(type('continuous') + landscape + margins), '<w:lastRenderedPageBreak/>')
      + p('Odd section', sect(type('oddPage') + landscape + margins + '<w:titlePg/>'))
      + '<w:p><w:bookmarkStart w:id="7" w:name="numbering-restart"/><w:bookmarkEnd w:id="7"/>'
      + '<w:r><w:lastRenderedPageBreak/><w:t>Restart at page 21</w:t></w:r></w:p>'
      + p('Page 22', '<w:pageBreakBefore/>')
      + sect(type('nextPage') + landscape + margins + '<w:pgNumType w:start="21"/><w:titlePg w:val="0"/>')
      + '</w:body></w:document>'
  };
  const relationships = [['settings', 'settings']];
  for (const [id, kind, name] of [
    ['main', 'header', 'Default header'], ['first', 'header', 'First-page header'],
    ['even', 'header', 'Even header'], ['continuous', 'header', 'Continuous header'],
    ['base', 'footer', 'Default footer'], ['replacement', 'footer', 'Replacement footer'], ['alternate', 'footer', 'Even footer']
  ]) {
    relationships.push([id, kind]);
    parts[`word/${id}.xml`] = `<w:${kind === 'header' ? 'hdr' : 'ftr'} ${word}>${p(name)}</w:${kind === 'header' ? 'hdr' : 'ftr'}>`;
  }
  parts['word/_rels/document.xml.rels'] = `<Relationships xmlns="${ns}/package/2006/relationships">`
    + relationships.map(([id, kind]) => `<Relationship Id="${id}" Type="${rel}/${kind}" Target="${id}.xml"/>`).join('') + '</Relationships>';
  const types = [['document', 'document.main'], ...relationships];
  parts['[Content_Types].xml'] = `<Types xmlns="${ns}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
    + types.map(([id, kind]) => `<Override PartName="/word/${id}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml"/>`).join('') + '</Types>';
  return zipSync(Object.fromEntries(Object.entries(parts).map(([name, xml]) => [name, strToU8(xml)])));
}

export function createDocxPageScrollFixture(count = 220) {
  const ns = 'http://schemas.openxmlformats.org';
  const section = (index) => '<w:sectPr>' + (index % 2
    ? '<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/>'
    : '<w:pgSz w:w="12240" w:h="15840"/>')
    + '<w:pgMar w:top="1440" w:right="720" w:bottom="1440" w:left="720"/></w:sectPr>';
  const pages = Array.from({ length: count }, (_, index) => '<w:p>'
    + (index + 1 < count ? '<w:pPr>' + section(index) + '</w:pPr>' : '')
    + `<w:r>${index === 174 ? '<w:lastRenderedPageBreak/>' : ''}<w:t>Page ${index + 1}</w:t>`
    + (index === 0 || index === 174 ? '<w:br/><w:t>Page body text</w:t>'.repeat(170) : '')
    + '</w:r></w:p>').join('');
  const parts = {
    '[Content_Types].xml': `<Types xmlns="${ns}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    '_rels/.rels': `<Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="body" Type="${ns}/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/document.xml': `<w:document xmlns:w="${ns}/wordprocessingml/2006/main"><w:body>${pages}${section(count - 1)}</w:body></w:document>`
  };
  return zipSync(Object.fromEntries(Object.entries(parts).map(([name, xml]) => [name, strToU8(xml)])));
}

export function createDocxAutomaticPaginationFixture(columns = 1, unequal = false, balance = false) {
  const ns = 'http://schemas.openxmlformats.org', rel = `${ns}/officeDocument/2006/relationships`;
  const word = `xmlns:w="${ns}/wordprocessingml/2006/main"`;
  const paragraph = (text, style = '') => `<w:p><w:pPr>${style && `<w:pStyle w:val="${style}"/>`}<w:spacing w:line="450" w:lineRule="exact"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
  const cell = (text, merge = '') => `<w:tc><w:tcPr>${merge}</w:tcPr>${paragraph(text)}</w:tc>`;
  const row = (text, right, props = '', merge = '') =>
    `<w:tr><w:trPr>${props}<w:trHeight w:val="450"/></w:trPr>${cell(text)}${cell(right, merge)}</w:tr>`;
  const table = '<w:tbl><w:tblPr>'
    + (unequal ? '<w:tblW w:w="5000" w:type="pct"/></w:tblPr><w:tblGrid><w:gridCol/><w:gridCol/></w:tblGrid>'
      : '<w:tblW w:w="3600" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="1200"/></w:tblGrid>')
    + row('Column heading', 'Info', '<w:tblHeader/>')
    + Array.from({ length: 19 }, (_, i) => row(`Row ${i + 1}`, i === 7 ? '' : `Info ${i + 1}`
      + (unequal && i !== 6 ? ' has an explanation that wraps in a narrow column' : ''), '',
      i === 6 ? '<w:vMerge w:val="restart"/>' : i === 7 ? '<w:vMerge/>' : '')).join('')
    + '</w:tbl>';
  const types = [['document', 'document.main'], ['styles', 'styles'], ['settings', 'settings'], ['header1', 'header'], ['header2', 'header']];
  if (unequal) types.push(['footnotes', 'footnotes']);
  const parts = {
    '[Content_Types].xml': `<Types xmlns="${ns}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
      + types.map(([name, type]) => `<Override PartName="/word/${name}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${type}+xml"/>`).join('') + '</Types>',
    '_rels/.rels': `<Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="body" Type="${rel}/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/_rels/document.xml.rels': `<Relationships xmlns="${ns}/package/2006/relationships">`
      + types.slice(1).map(([name, type]) => `<Relationship Id="${name}" Type="${rel}/${type}" Target="${name}.xml"/>`).join('') + '</Relationships>',
    'word/styles.xml': `<w:styles ${word}><w:style w:type="paragraph" w:styleId="Opening"><w:name w:val="Opening"/></w:style>`
      + '<w:style w:type="paragraph" w:styleId="BaseHeading"><w:pPr><w:keepNext/></w:pPr></w:style>'
      + '<w:style w:type="paragraph" w:styleId="Heading"><w:basedOn w:val="BaseHeading"/></w:style></w:styles>',
    'word/settings.xml': `<w:settings ${word}><w:evenAndOddHeaders/><w:compat><w:noColumnBalance w:val="${Number(!balance)}"/></w:compat></w:settings>`,
    'word/header1.xml': `<w:hdr ${word}>${paragraph('Odd header')}</w:hdr>`,
    'word/header2.xml': `<w:hdr ${word}>${paragraph('Even header')}</w:hdr>`,
    'word/document.xml': `<w:document ${word} xmlns:r="${rel}"><w:body>`
      + Array.from({ length: 9 }, (_, i) => paragraph(`Opening ${i + 1}`, 'Opening')).join('')
      + paragraph('Heading with next paragraph', 'Heading') + paragraph('First paragraph of the section')
      + table + paragraph('Closing paragraph')
      + '<w:sectPr><w:headerReference w:type="default" r:id="header1"/><w:headerReference w:type="even" r:id="header2"/>'
      + `<w:pgSz w:w="${columns > 1 ? 12000 : 6000}" w:h="6000"/><w:pgMar w:top="600" w:right="600" w:bottom="600" w:left="600" w:header="150" w:footer="150"/>`
      + (unequal ? '<w:cols w:num="2" w:equalWidth="0"><w:col w:w="7200" w:space="300"/><w:col w:w="3300"/></w:cols>'
        : `<w:cols w:num="${columns}" w:space="300"/>`)
      + '</w:sectPr>'
      + '</w:body></w:document>'
  };
  if (unequal) parts['word/footnotes.xml'] = `<w:footnotes ${word}><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote></w:footnotes>`;
  return zipSync(Object.fromEntries(Object.entries(parts).map(([name, xml]) => [name, strToU8(xml)])));
}

export function createDocxLinePaginationFixture({
  wrap = false, keepLines = false, count = keepLines ? 10 : 30, openingCount = 3, docDefault, namedDefault, base, direct,
  columns = 1, rtl = false, saved = [], unequal = false, keepNext = false, noColumnBalance = true
} = {}) {
  const ns = 'http://schemas.openxmlformats.org';
  const punctuation = '🙂👩🏽‍💻界'.repeat(100);
  const lines = Array.from({ length: count }, (_, index) => `Line ${String(index + 1).padStart(2, '0')} 👩🏽‍💻`);
  const widow = value => value === undefined ? '' : `<w:widowControl w:val="${Number(value)}"/>`;
  const paragraph = (contents, properties = '') => '<w:p><w:pPr>' + properties
    + '<w:spacing w:line="450" w:lineRule="exact"/></w:pPr>' + contents + '</w:p>';
  const run = value => `<w:r><w:t>${value}</w:t></w:r>`;
  const opening = paragraph('<w:bookmarkStart w:id="1" w:name="opening"/><w:bookmarkEnd w:id="1"/>'
    + '<w:r>' + Array.from({ length: openingCount }, (_, i) => `<w:t>Opening ${i + 1}</w:t>`).join('<w:br/>') + '</w:r>');
  const linked = paragraph('<w:hyperlink w:anchor="opening"><w:r><w:rPr><w:b/></w:rPr>'
    + (wrap ? `<w:t>${punctuation}</w:t>` : lines.map((line, index) => {
      const split = !index ? '' : saved.includes(index) ? '<w:lastRenderedPageBreak/>' : '<w:br/>';
      return split + `<w:t>${line}</w:t>`;
    }).join(''))
    + '</w:r></w:hyperlink>', (keepLines ? '<w:keepLines/>' : '') + widow(direct)
      + (base === undefined ? '' : '<w:pStyle w:val="Child"/>'));
  const parts = {
    '[Content_Types].xml': `<Types xmlns="${ns}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>`,
    '_rels/.rels': `<Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="body" Type="${ns}/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/_rels/document.xml.rels': `<Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="styles" Type="${ns}/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="settings" Type="${ns}/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>`,
    'word/settings.xml': `<w:settings xmlns:w="${ns}/wordprocessingml/2006/main"><w:compat>`
      + (noColumnBalance === null ? '' : `<w:noColumnBalance w:val="${Number(noColumnBalance)}"/>`) + '</w:compat></w:settings>',
    'word/styles.xml': `<w:styles xmlns:w="${ns}/wordprocessingml/2006/main">`
      + `<w:docDefaults><w:pPrDefault><w:pPr>${widow(docDefault)}</w:pPr></w:pPrDefault></w:docDefaults>`
      + `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:pPr>${widow(namedDefault)}</w:pPr></w:style>`
      + `<w:style w:type="paragraph" w:styleId="Base"><w:pPr>${widow(base)}</w:pPr></w:style>`
      + '<w:style w:type="paragraph" w:styleId="Child"><w:basedOn w:val="Base"/></w:style></w:styles>',
    'word/document.xml': `<w:document xmlns:w="${ns}/wordprocessingml/2006/main"><w:body>`
      + (wrap ? linked + opening : opening + linked)
      + (keepNext ? paragraph(run('Keep heading'), '<w:keepNext/>') : '')
      + paragraph(run('Closing paragraph'))
      + `<w:sectPr><w:pgSz w:w="${columns > 2 ? columns * 2850 + 900 : 6000}" w:h="6000"/><w:pgMar w:top="600" w:right="600" w:bottom="600" w:left="600"/>`
      + (unequal ? '<w:cols w:num="2" w:equalWidth="0" w:sep="1"><w:col w:w="2700" w:space="300"/><w:col w:w="1800"/></w:cols>'
        : `<w:cols w:num="${columns}" w:space="300" w:sep="1"/>`)
      + (rtl ? '<w:bidi/>' : '') + '</w:sectPr>'
      + '</w:body></w:document>'
  };
  return { bytes: zipSync(Object.fromEntries(Object.entries(parts).map(([name, xml]) => [name, strToU8(xml)]))),
    text: wrap ? punctuation : lines.join('') };
}

export function createDocxSharedPageFixture(table) {
  const { bytes } = createDocxLinePaginationFixture({ noColumnBalance: null });
  const parts = unzipSync(bytes);
  const run = text => `<w:r><w:t>${text}</w:t></w:r>`;
  const paragraph = (body, properties = '') => `<w:p><w:pPr><w:widowControl w:val="0"/><w:spacing w:line="450" w:lineRule="exact"/>${properties}</w:pPr>${body}</w:p>`;
  const lines = (prefix, count) => Array.from({ length: count }, (_, i) => run(`${prefix} ${i + 1} 👩🏽‍💻`)).join('<w:r><w:br/></w:r>');
  const section = (continuous, columns = false) => `<w:sectPr>${continuous ? '<w:type w:val="continuous"/>' : ''}
    <w:pgSz w:w="6000" w:h="6000"/><w:pgMar w:top="600" w:right="600" w:bottom="600" w:left="600"/>
    ${columns ? '<w:cols w:num="2" w:equalWidth="0" w:sep="1"><w:col w:w="2700" w:space="300"/><w:col w:w="1800"/></w:cols>' : ''}
    </w:sectPr>`;
  const start = '<w:bookmarkStart w:id="1" w:name="opening"/><w:bookmarkEnd w:id="1"/>';
  const opening = paragraph(start + lines('Opening', table ? 5 : 8), section(false));
  const middle = paragraph(`<w:hyperlink w:anchor="opening">${lines('Line', 18)}</w:hyperlink>`, section(true, table));
  const row = (text, header = false) => `<w:tr>${header ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}<w:tc>${paragraph(run(text))}</w:tc></w:tr>`;
  const tail = table
    ? '<w:tbl><w:tblGrid><w:gridCol w:w="3600"/></w:tblGrid>' + row('Heading', true)
      + Array.from({ length: 13 }, (_, i) => row(`Row ${i + 1}`)).join('') + '</w:tbl>'
      + paragraph(run('Table section end'), section(true))
    : paragraph(lines('Tail', 4), section(true));
  const closing = paragraph(run('Closing heading'), '<w:keepNext/>') + paragraph(run('Closing paragraph')) + section(true);
  const path = 'word/document.xml';
  parts[path] = strToU8(strFromU8(parts[path]).replace(/<w:body>[\s\S]*<\/w:body>/, `<w:body>${opening}${middle}${tail}${closing}</w:body>`));
  return zipSync(parts);
}

export function createDocxSharedGeometryFixture(mode) {
  const parts = unzipSync(createDocxSectionsFixture(true));
  const ns = 'http://schemas.openxmlformats.org', rel = `${ns}/officeDocument/2006/relationships`;
  const word = `xmlns:w="${ns}/wordprocessingml/2006/main"`;
  const run = text => `<w:r><w:t>${text}</w:t></w:r>`;
  const paragraph = (text, properties = '', spacing = 450, widow = false) => `<w:p><w:pPr><w:widowControl w:val="${widow ? 1 : 0}"/>
    <w:spacing w:line="${spacing}" w:lineRule="exact"/>${properties}</w:pPr>${text}</w:p>`;
  const lines = (label, count, extra = '') => Array.from({ length: count }, (_, index) => {
    const content = run(`${label} ${index + 1}${extra}`);
    return mode === 'header' && label === 'Next' && index === 12
      ? `<w:smartTag w:element="country-region"><w:smartTag w:element="place">${content}</w:smartTag></w:smartTag>` : content;
  }).join('<w:r><w:br/></w:r>');
  const ref = (kind, type, id) => `<w:${kind}Reference w:type="${type}" r:id="${id}"/>`;
  const sized = '<w:pgSz w:w="6000" w:h="6000"/>';
  const originalMargins = '<w:pgMar w:top="600" w:right="600" w:bottom="600" w:left="600" w:header="300" w:footer="300"/>';
  const changedMargins = '<w:pgMar w:top="1050" w:right="1200" w:bottom="900" w:left="1200" w:header="300" w:footer="300"/>';
  const firstRefs = mode === 'margins' ? '' : ref('header', 'default', 'main') + ref('footer', 'default', 'base');
  const nextRefs = mode === 'margins' ? '' : ref('header', 'default', 'continuous') + ref('header', 'even', 'even')
    + ref('header', 'first', 'first') + ref('footer', 'default', 'replacement') + ref('footer', 'even', 'alternate') + '<w:titlePg/>';
  const first = `<w:sectPr>${firstRefs}${sized}${originalMargins}</w:sectPr>`;
  const next = '<w:sectPr><w:type w:val="continuous"/>' + nextRefs + sized
    + (['header', 'fresh', 'prior'].includes(mode) ? originalMargins : changedMargins)
    + (mode === 'columns' ? '<w:cols w:num="2" w:space="300"/>' : '')
    + (mode === 'fresh' ? '<w:pgNumType w:start="10"/>' : '') + '</w:sectPr>';
  const note = id => `<w:r><w:footnoteReference w:id="${id}"/></w:r>`;
  const hasNotes = mode === 'notes' || mode === 'long';
  const row = (text, heading = false) => `<w:tr>${heading ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}<w:tc>${paragraph(text)}</w:tc></w:tr>`;
  const body = mode === 'notes'
    ? '<w:tbl><w:tblPr><w:tblW w:type="pct" w:w="5000"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid>'
      + row(run('Column heading'), true) + Array.from({ length: 20 }, (_, index) => row(run(`Data ${index + 1}`)
        + (index === 7 ? note(2) : ''))).join('') + '</w:tbl>'
    : paragraph(lines('Next', mode === 'columns' ? 40 : mode === 'long' ? 8 : 24,
      mode === 'margins' ? ' abcdefghijklmnopqrstuvwxyzabc' : ''), '', 450, mode === 'fresh');
  const prior = mode === 'prior' ? paragraph(lines('Prior', 13)) : '';
  const opening = paragraph(lines('Opening', mode === 'fresh' ? 9 : 3) + (hasNotes ? note(1) : ''),
    (prior ? '<w:pageBreakBefore/>' : '') + first);
  parts['word/document.xml'] = strToU8(`<w:document ${word} xmlns:r="${rel}"><w:body>${prior}${opening}${body}${next}</w:body></w:document>`);
  for (const [id, kind, count] of [['continuous', 'hdr', 2], ['even', 'hdr', mode === 'long' ? 2 : 3], ['alternate', 'ftr', 2]]) {
    parts[`word/${id}.xml`] = strToU8(`<w:${kind} ${word}>${paragraph(lines(id, count), '', 540)}</w:${kind}>`);
  }
  if (prior) parts['word/main.xml'] = strToU8(`<w:hdr ${word}>${paragraph(lines('Default header', 3), '', 540)}</w:hdr>`);
  if (hasNotes) {
    const firstNote = mode === 'long' ? lines('Long note', 28) : run('Opening footnote');
    const tableNote = '<w:footnote w:id="2">' + paragraph(run('Table footnote wraps at the narrower width of the following section.')) + '</w:footnote>';
    parts['word/footnotes.xml'] = strToU8(`<w:footnotes ${word}><w:footnote w:id="1">${paragraph(firstNote)}</w:footnote>
      ${mode === 'notes' ? tableNote : ''}</w:footnotes>`);
    const types = '[Content_Types].xml', rels = 'word/_rels/document.xml.rels';
    parts[types] = strToU8(strFromU8(parts[types]).replace('</Types>',
      '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/></Types>'));
    parts[rels] = strToU8(strFromU8(parts[rels]).replace('</Relationships>',
      `<Relationship Id="footnotes" Type="${rel}/footnotes" Target="footnotes.xml"/></Relationships>`));
  }
  return zipSync(parts);
}

export function createDocxFootnotePaginationFixture(table = false, long = false, columns = '', noteColumns = 1, noteLines = 26) {
  const ns = 'http://schemas.openxmlformats.org', rel = `${ns}/officeDocument/2006/relationships`;
  const word = `xmlns:w="${ns}/wordprocessingml/2006/main"`;
  const paragraph = contents => '<w:p><w:pPr><w:spacing w:line="450" w:lineRule="exact"/></w:pPr>' + contents + '</w:p>';
  const run = text => `<w:r><w:t>${text}</w:t></w:r>`;
  const lines = Array.from({ length: columns ? 27 : long ? 10 : 17 }, (_, i) => {
    const num = i === (long || columns && !table ? 3 : table ? 5 : 7) ? 1 : !long && i === (table ? 8 : columns ? 7 : 11) ? 2 : 0;
    return run(`Body line ${i + 1}`) + (num ? `<w:r><w:footnoteReference w:id="${num}"/></w:r>` : '');
  });
  const row = (contents, header = false) => `<w:tr>${header ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}<w:tc>${paragraph(contents)}</w:tc></w:tr>`;
  const width = columns ? 1800 : 4200;
  const body = table
    ? `<w:tbl><w:tblPr><w:tblW w:w="${width}" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="${width}"/></w:tblGrid>`
      + row(run('Table heading'), true) + lines.map(line => row(line)).join('') + '</w:tbl>'
    : paragraph(lines.join('<w:r><w:br/></w:r>'));
  const parts = {
    '[Content_Types].xml': `<Types xmlns="${ns}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/></Types>`,
    '_rels/.rels': `<Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="body" Type="${rel}/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/_rels/document.xml.rels': `<Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="footnotes" Type="${rel}/footnotes" Target="footnotes.xml"/></Relationships>`,
    'word/document.xml': `<w:document ${word}><w:body>${body}<w:sectPr><w:pgSz w:w="6000" w:h="${table ? 6300 : 6000}"/><w:pgMar w:top="600" w:right="600" w:bottom="600" w:left="600"/></w:sectPr></w:body></w:document>`,
    'word/footnotes.xml': `<w:footnotes ${word}>`
      + (long ? [noteLines] : [2, 3]).map((count, index) => `<w:footnote w:id="${index + 1}">`
        + (long ? paragraph(Array.from({ length: count }, (_, line) => run(`Footnote line ${line + 1} 👩🏽‍💻`)).join('<w:r><w:br/></w:r>'))
          : Array.from({ length: count }, (_, line) => paragraph(run(`Footnote ${index + 1}, line ${line + 1}`))).join(''))
        + '</w:footnote>').join('') + '</w:footnotes>'
  };
  if (long) {
    parts['[Content_Types].xml'] = parts['[Content_Types].xml'].replace('</Types>',
      [['settings', 'settings'], ['odd', 'header'], ['even', 'header']].map(([name, type]) =>
        `<Override PartName="/word/${name}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${type}+xml"/>`).join('') + '</Types>');
    parts['word/_rels/document.xml.rels'] = parts['word/_rels/document.xml.rels'].replace('</Relationships>',
      [['settings', 'settings'], ['odd', 'header'], ['even', 'header']].map(([name, type]) =>
        `<Relationship Id="${name}" Type="${rel}/${type}" Target="${name}.xml"/>`).join('') + '</Relationships>');
    parts['word/document.xml'] = parts['word/document.xml'].replace(`<w:document ${word}>`, `<w:document ${word} xmlns:r="${rel}">`)
      .replace('<w:sectPr>', '<w:sectPr><w:headerReference w:type="default" r:id="odd"/><w:headerReference w:type="even" r:id="even"/>')
      .replace('w:top="600"', 'w:top="600" w:header="150"');
    parts['word/settings.xml'] = `<w:settings ${word}><w:evenAndOddHeaders/></w:settings>`;
    for (const name of ['odd', 'even']) parts[`word/${name}.xml`] = `<w:hdr ${word}>${paragraph(run(`${name} footnote page`))}</w:hdr>`;
  }
  if (columns || (noteColumns ?? 1) > 1) {
    const layout = columns === 'unequal'
      ? '<w:cols w:num="2" w:equalWidth="0" w:sep="1"><w:col w:w="2700" w:space="300"/><w:col w:w="1800"/></w:cols><w:bidi/>'
      : columns ? '<w:cols w:num="2" w:space="300" w:sep="1"/>' : '';
    const notes = noteColumns === null ? '' : `<w15:footnoteColumns w:val="${noteColumns}"/>`;
    parts['word/document.xml'] = parts['word/document.xml']
      .replace('<w:sectPr>', `<w:sectPr xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" xmlns:mc="${ns}/markup-compatibility/2006" mc:Ignorable="w15">`)
      .replace('</w:sectPr>', layout + notes + '</w:sectPr>');
  }
  return zipSync(Object.fromEntries(Object.entries(parts).map(([name, xml]) => [name, strToU8(xml)])));
}

export function createDocxSharedFootnoteFixture(mode) {
  const long = mode === 'long';
  const columns = mode === 'columns' || mode === 'rows';
  const parts = unzipSync(createDocxFootnotePaginationFixture(false, long, '', 1, 28));
  const run = text => `<w:r><w:t>${text}</w:t></w:r>`;
  const reference = id => `<w:r><w:footnoteReference w:id="${id}"/></w:r>`;
  const paragraph = (body, section = '') => `<w:p><w:pPr><w:widowControl w:val="0"/>
    <w:spacing w:line="450" w:lineRule="exact"/>${section}</w:pPr>${body}</w:p>`;
  const lines = (label, count, ref, at) => Array.from({ length: count }, (_, index) =>
    run(`${label} ${index + 1} 👩🏽‍💻`) + (index + 1 === at ? reference(ref) : ''));
  const lineBreak = '<w:r><w:br/></w:r>';
  const row = (body, header = false) => `<w:tr>${header ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}<w:tc>${paragraph(body)}</w:tc></w:tr>`;
  const path = 'word/document.xml';
  const xml = strFromU8(parts[path]);
  const page = xml.match(/<w:sectPr>([\s\S]*?)<\/w:sectPr>/)[1];
  const firstCount = mode === 'moves' ? 6 : mode === 'rows' ? 3 : columns ? 5 : mode === 'endnotes' ? 1 : 2;
  const endnote = mode === 'endnotes' ? '<w:r><w:endnoteReference w:id="1"/></w:r>' : '';
  const first = paragraph(lines('First', firstCount, 1, endnote ? 1 : 2).join(lineBreak) + endnote, `<w:sectPr>${page}</w:sectPr>`);
  const secondLines = lines('Second', columns ? 25 : long ? 10 : 12, 2,
    long ? 0 : mode === 'rows' ? 9 : columns ? 13 : mode === 'moves' ? 2 : 1);
  const section = layout => `<w:sectPr><w:type w:val="continuous"/>${page}${layout}</w:sectPr>`;
  const second = mode === 'rows'
    ? '<w:tbl><w:tblGrid><w:gridCol w:w="1800"/></w:tblGrid>' + row(run('Repeated heading'), true)
      + secondLines.map(line => row(line)).join('') + '</w:tbl>'
    : paragraph(secondLines.join(lineBreak), long ? section('') : '');
  const third = long ? paragraph(run('Third section')) : '';
  const layout = columns ? '<w:cols w:num="2" w:equalWidth="0"><w:col w:w="2700" w:space="300"/><w:col w:w="1800"/></w:cols>' : '';
  parts[path] = strToU8(xml.replace(/<w:body>[\s\S]*<\/w:body>/,
    `<w:body>${first}${second}${third}${section(layout)}</w:body>`));
  if (endnote) {
    const existing = unzipSync(createDocxEndnotePaginationFixture(3, 'continuous', false));
    parts['word/endnotes.xml'] = existing['word/endnotes.xml'];
    parts['word/settings.xml'] = existing['word/settings.xml'];
    for (const [path, close] of [['[Content_Types].xml', '</Types>'], ['word/_rels/document.xml.rels', '</Relationships>']]) {
      const entries = strFromU8(existing[path]).match(/<(?:Override|Relationship) [^>]*?(?:settings|endnotes)\.xml"[^>]*\/>/g);
      parts[path] = strToU8(strFromU8(parts[path]).replace(close, entries.join('') + close));
    }
  }
  return zipSync(parts);
}

export function createDocxEndnotePaginationFixture(bodyLines = 3, sectionType = '', long = true, followingLines = 1) {
  const ns = 'http://schemas.openxmlformats.org', rel = `${ns}/officeDocument/2006/relationships`;
  const word = `xmlns:w="${ns}/wordprocessingml/2006/main"`;
  const paragraph = contents => `<w:p><w:pPr><w:spacing w:line="${long ? 450 : 300}" w:lineRule="exact"/></w:pPr>${contents}</w:p>`;
  const run = text => `<w:r><w:t>${text}</w:t></w:r>`;
  const lines = (count, render) => Array.from({ length: count }, (_, i) => render(i + 1)).join('<w:r><w:br/></w:r>');
  const reference = i => `<w:r><w:endnoteReference w:id="${i}"/></w:r>`;
  const body = paragraph(lines(bodyLines, i => run(`Body line ${i}`)
    + (i <= (sectionType ? 2 : 3) ? reference(i) : '')));
  const page = `<w:headerReference w:type="default" r:id="odd"/><w:headerReference w:type="even" r:id="even"/><w:headerReference w:type="first" r:id="first"/><w:footerReference w:type="default" r:id="footer"/><w:footerReference w:type="even" r:id="footer"/><w:footerReference w:type="first" r:id="footer"/><w:titlePg/><w:pgNumType w:start="4"/><w:pgSz w:w="6000" w:h="6000"/><w:pgMar w:top="600" w:right="600" w:bottom="600" w:left="600" w:header="150" w:footer="150"/>`;
  const sectionEnd = `<w:p><w:pPr><w:sectPr>${page}</w:sectPr></w:pPr>${run('First section end')}</w:p>`;
  const nextPage = sectionType === 'nextPage' ? page.replace('w:h="6000"', 'w:h="5400"') : page;
  const following = paragraph(lines(followingLines, i => run(followingLines === 1 ? 'Second section' : `Second section line ${i}`)
    + (i === 1 ? reference(3) : '')));
  const section = sectionType
    ? sectionEnd + following + `<w:sectPr><w:type w:val="${sectionType}"/>${nextPage}</w:sectPr>`
    : `<w:sectPr>${page}</w:sectPr>`;
  const parts = {
    '[Content_Types].xml': `<Types xmlns="${ns}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/endnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/odd.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/even.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/first.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>`,
    '_rels/.rels': `<Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="body" Type="${rel}/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/_rels/document.xml.rels': `<Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="notes" Type="${rel}/endnotes" Target="endnotes.xml"/><Relationship Id="settings" Type="${rel}/settings" Target="settings.xml"/><Relationship Id="footer" Type="${rel}/footer" Target="footer.xml"/>`
      + ['odd', 'even', 'first'].map(name => `<Relationship Id="${name}" Type="${rel}/header" Target="${name}.xml"/>`).join('')
      + '</Relationships>',
    'word/document.xml': `<w:document ${word} xmlns:r="${rel}"><w:body>${body}${section}</w:body></w:document>`,
    'word/settings.xml': `<w:settings ${word}><w:evenAndOddHeaders/>${sectionType ? '<w:endnotePr><w:pos w:val="sectEnd"/></w:endnotePr>' : ''}</w:settings>`,
    'word/footer.xml': `<w:ftr ${word}>${paragraph(run('endnote footer'))}</w:ftr>`,
    'word/endnotes.xml': `<w:endnotes ${word}>`
      + [long ? 14 : 1, 2, 1].map((count, i) => `<w:endnote w:id="${i + 1}">`
        + paragraph(lines(count, line => run(`Endnote ${i + 1} line ${line} 👩🏽‍💻`))) + '</w:endnote>').join('') + '</w:endnotes>'
  };
  for (const name of ['odd', 'even', 'first']) parts[`word/${name}.xml`] = `<w:hdr ${word}>${paragraph(run(`${name} header`))}</w:hdr>`;
  return zipSync(Object.fromEntries(Object.entries(parts).map(([name, xml]) => [name, strToU8(xml)])));
}
