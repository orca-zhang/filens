import { strToU8, zipSync, zlibSync } from 'fflate';

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
const png = () => {
  const size = 256, pixels = new Uint8Array((size * 4 + 1) * size);
  let seed = 12345;
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
      + p('Restart at page 21') + p('Page 22', '<w:pageBreakBefore/>')
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
