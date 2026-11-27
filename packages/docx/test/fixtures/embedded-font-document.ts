import JSZip from 'jszip';

interface FixtureFace {
  family: string;
  variant?: 'Regular' | 'Bold' | 'Italic' | 'BoldItalic';
  bytes?: Uint8Array;
  plain?: boolean;
  external?: boolean;
}

export async function embeddedFontDocument(faces: FixtureFace[]) {
  const zip = new JSZip();
  const ns = 'http://schemas.openxmlformats.org';
  const word = `${ns}/wordprocessingml/2006/main`;
  const rel = `${ns}/officeDocument/2006/relationships`;
  const rels = (content: string) => `<Relationships xmlns="${ns}/package/2006/relationships">${content}</Relationships>`;
  const relEntry = (id: string, type: string, target: string, extra = '') => `<Relationship Id="${id}" Type="${rel}/${type}" Target="${target}" ${extra}/>`;
  const glyphs = 'FILENS Wmiw2018';
  const key = '{10203040-5060-7080-90A0-B0C0D0E0F001}';
  const keyBytes = [1, 240, 224, 208, 192, 176, 160, 144, 128, 112, 96, 80, 64, 48, 32, 16];
  const fonts = new Map<string, string>();
  const fontRels = faces.map(({ family, variant = 'Regular', bytes, plain, external }, index) => {
    const id = `font${index}`;
    fonts.set(family, (fonts.get(family) ?? '') + `<w:embed${variant} r:id="${id}"${plain ? '' : ` w:fontKey="${key}"`}/>`);
    const target = `fonts/${id}.${plain ? 'ttf' : 'odttf'}`;
    if (bytes) {
      const packed = Uint8Array.from(bytes);
      for (let i = 0; !plain && i < Math.min(32, packed.length); i++) packed[i] ^= keyBytes[i % 16];
      zip.file(`word/${target}`, packed);
    }
    return relEntry(id, 'font', external ? 'https://example.invalid/font.ttf' : target, external ? 'TargetMode="External"' : '');
  }).join('');
  zip.file('[Content_Types].xml', `<Types xmlns="${ns}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="odttf" ContentType="application/vnd.openxmlformats-officedocument.obfuscatedFont"/><Default Extension="ttf" ContentType="application/x-fontdata"/></Types>`);
  zip.file('_rels/.rels', rels(relEntry('document', 'officeDocument', 'word/document.xml')));
  zip.file('word/_rels/document.xml.rels', rels(relEntry('fontTable', 'fontTable', 'fontTable.xml') + relEntry('theme', 'theme', 'theme/theme1.xml')));
  zip.file('word/_rels/fontTable.xml.rels', rels(fontRels));
  zip.file('word/fontTable.xml', `<w:fonts xmlns:w="${word}" xmlns:r="${rel}">${[...fonts].map(([family, entries]) => `<w:font w:name="${family}">${entries}</w:font>`).join('')}</w:fonts>`);
  const themeFamily = faces[0].family;
  zip.file('word/theme/theme1.xml', `<a:theme xmlns:a="${ns}/drawingml/2006/main"><a:themeElements><a:fontScheme name="Fonts"><a:minorFont><a:latin typeface="${themeFamily}"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`);
  const runs = faces.map(({ family, variant }) => `<w:p><w:r><w:rPr><w:rFonts w:ascii="${family}"/>${variant?.includes('Bold') ? '<w:b/>' : ''}${variant?.includes('Italic') ? '<w:i/>' : ''}</w:rPr><w:t>${glyphs}</w:t></w:r></w:p>`).join('');
  zip.file('word/document.xml', `<w:document xmlns:w="${word}"><w:body>${runs}
    <w:p><w:r><w:rPr><w:rFonts w:asciiTheme="minorHAnsi"/></w:rPr><w:t>Theme text</w:t></w:r></w:p>
    <w:p><w:r><w:sym w:font="${themeFamily}" w:char="002B"/></w:r></w:p>
    <w:p><w:r><w:br w:type="page"/></w:r></w:p><w:p><w:r><w:t>Second page</w:t></w:r></w:p>
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>
  </w:body></w:document>`);
  return zip.generateAsync({ type: 'uint8array' });
}

export function withEmbeddingFlags(source: Uint8Array, flags: number) {
  const bytes = Uint8Array.from(source);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < view.getUint16(4); i++) {
    const entry = 12 + i * 16;
    if (view.getUint32(entry) === 0x4f532f32) {
      view.setUint16(view.getUint32(entry + 8) + 8, flags);
      return bytes;
    }
  }
  throw new Error('Fixture font has no OS/2 table');
}
