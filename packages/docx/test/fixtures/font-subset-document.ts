import JSZip from 'jszip';

export async function fontSubsetDocument({ headingFont = 'Noto Sans JP', long = false } = {}) {
  const zip = new JSZip();
  const ns = 'http://schemas.openxmlformats.org';
  const word = `xmlns:w="${ns}/wordprocessingml/2006/main"`;
  const relations = `${ns}/officeDocument/2006/relationships`;
  const fonts = (family: string) => `<w:rFonts w:ascii="${family}"/>`;
  const run = (family: string, text: string, props = '') => `<w:r><w:rPr>${fonts(family)}${props}</w:rPr><w:t>${text}</w:t></w:r>`;
  const paragraph = (content: string) => `<w:p>${content}</w:p>`;
  zip.file('[Content_Types].xml', `<Types xmlns="${ns}/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>`);
  zip.file('_rels/.rels', `<Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="doc" Type="${relations}/officeDocument" Target="word/document.xml"/></Relationships>`);
  const parts = ['styles', 'header', 'footer', 'footnotes', 'endnotes', 'numbering'];
  zip.file('word/_rels/document.xml.rels', `<Relationships xmlns="${ns}/package/2006/relationships">${parts.map(part => `<Relationship Id="${part}" Type="${relations}/${part}" Target="${part}.xml"/>`).join('')}</Relationships>`);
  zip.file('word/styles.xml', `<w:styles ${word}>
    <w:style w:type="paragraph" w:styleId="base"><w:rPr>${fonts(headingFont)}</w:rPr></w:style>
    <w:style w:type="paragraph" w:styleId="derived"><w:basedOn w:val="base"/></w:style>
  </w:styles>`);
  zip.file('word/header.xml', `<w:hdr ${word}>${paragraph(run('Noto Sans JP', '見出'))}${paragraph(run('Noto Emoji', '😀'))}</w:hdr>`);
  zip.file('word/footer.xml', `<w:ftr ${word}>${paragraph(run('Noto Sans JP', '下'))}</w:ftr>`);
  for (const [tag, text] of [['footnote', '注'], ['endnote', '説明']]) {
    zip.file(`word/${tag}s.xml`, `<w:${tag}s ${word}><w:${tag} w:id="1">${paragraph(run('Noto Sans JP', text))}</w:${tag}></w:${tag}s>`);
  }
  zip.file('word/numbering.xml', `<w:numbering ${word}>
    <w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="chineseCounting"/><w:lvlText w:val="第%1項"/><w:rPr>${fonts('Noto Sans SC')}</w:rPr></w:lvl></w:abstractNum>
    <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
  </w:numbering>`);
  zip.file('word/document.xml', `<w:document ${word} xmlns:r="${relations}"><w:body>
    <w:p><w:pPr><w:pStyle w:val="derived"/></w:pPr><w:r><w:t>本文</w:t></w:r></w:p>
    ${paragraph('<w:r><w:footnoteReference w:id="1"/><w:endnoteReference w:id="1"/></w:r>')}
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>${run('Noto Sans SC', '列表')}</w:p>
    ${paragraph(run('Noto Sans KR', '한글', '<w:b/>'))}
    ${paragraph(run('Noto Sans TC', '字') + run('Noto Sans TC', '體', '<w:b/>'))}
    ${paragraph(run('Noto Serif JP', 'ab', '<w:caps/>'))}
    ${paragraph(run('Noto Serif KR', '글자', '<w:i/>'))}
    ${paragraph('<w:r><w:br w:type="page"/></w:r>')}
    ${paragraph(run('Noto Sans JP', long ? '月'.repeat(4097) : '月日') + run('Noto Emoji', '😺'))}
    <w:sectPr><w:headerReference w:type="default" r:id="header"/><w:footerReference w:type="default" r:id="footer"/><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>
  </w:body></w:document>`);
  return zip.generateAsync({ type: 'uint8array' });
}
