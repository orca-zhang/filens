import JSZip from 'jszip';

interface FontPart {
  family: string;
  bytes?: Uint8Array;
  variant?: 'regular' | 'bold' | 'italic' | 'boldItalic';
  external?: boolean;
}

export async function embeddedFontDeck(fonts: FontPart[]) {
  const zip = new JSZip();
  const ns = 'http://schemas.openxmlformats.org';
  const relationType = `${ns}/officeDocument/2006/relationships`;
  const presentation = `xmlns:p="${ns}/presentationml/2006/main" xmlns:a="${ns}/drawingml/2006/main" xmlns:r="${relationType}"`;
  const ids = new Map<string, string>();
  const rel = (id: string, type: string, target: string, external = false) =>
    `<Relationship Id="${id}" Type="${relationType}/${type}" Target="${target}"${external ? ' TargetMode="External"' : ''}/>`;
  const relations = (content: string) => `<Relationships xmlns="${ns}/package/2006/relationships">${content}</Relationships>`;
  const fontRels = fonts.map(({ family, bytes, variant = 'regular', external }, index) => {
    const id = `font${index}`;
    const target = `fonts/${id}.fntdata`;
    ids.set(family, (ids.get(family) ?? '') + `<p:${variant} r:id="${id}"/>`);
    if (bytes) zip.file(`ppt/${target}`, bytes);
    return rel(id, 'font', external ? 'https://example.invalid/font.fntdata' : target, external);
  }).join('');
  const shapes = fonts.map(({ family, variant }, index) => `<p:sp>
    <p:nvSpPr><p:cNvPr id="${index + 2}" name="Face ${index}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
    <p:spPr><a:xfrm><a:off x="360000" y="${360000 + index * 440000}"/><a:ext cx="7200000" cy="430000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
    <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="2600"${variant?.toLowerCase().includes('bold') ? ' b="1"' : ''}${variant?.toLowerCase().includes('italic') ? ' i="1"' : ''}><a:latin typeface="${family}"/></a:rPr><a:t>WiMW filens 2026</a:t></a:r></a:p></p:txBody>
  </p:sp>`).join('');
  zip.file('[Content_Types].xml', `<Types xmlns="${ns}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="fntdata" ContentType="application/x-fontdata"/></Types>`);
  zip.file('_rels/.rels', relations(rel('main', 'officeDocument', 'ppt/presentation.xml')));
  zip.file('ppt/presentation.xml', `<p:presentation ${presentation} embedTrueTypeFonts="1"><p:sldIdLst><p:sldId id="256" r:id="slide1"/><p:sldId id="257" r:id="slide2"/></p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/><p:embeddedFontLst>${[...ids].map(([family, entries]) => `<p:embeddedFont><p:font typeface="${family}"/>${entries}</p:embeddedFont>`).join('')}</p:embeddedFontLst></p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels', relations(rel('slide1', 'slide', 'slides/slide1.xml') + rel('slide2', 'slide', 'slides/slide2.xml') + fontRels));
  for (const index of [1, 2]) zip.file(`ppt/slides/slide${index}.xml`, `<p:sld ${presentation}><p:cSld><p:spTree>${shapes}</p:spTree></p:cSld></p:sld>`);
  return zip.generateAsync({ type: 'uint8array' });
}

export function eotFont(font: Uint8Array, { flags = 0, permissions = 0 } = {}) {
  const bytes = new Uint8Array(100 + font.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, bytes.length, true);
  view.setUint32(4, font.length, true);
  view.setUint32(8, 0x20001, true);
  view.setUint32(12, flags, true);
  view.setUint16(32, permissions, true);
  view.setUint16(34, 0x504c, true);
  bytes.set(flags & 0x10000000 ? font.map(byte => byte ^ 0x50) : font, 100);
  return bytes;
}
