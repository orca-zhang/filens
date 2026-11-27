import JSZip from 'jszip';

export const firstSpeakerNotes = '先确认原始数据 & 来源。\n2026：保留段落。\n\n<em>这行是备注文本</em>';
export const secondSpeakerNotes = ['Inherited body.', ...Array.from({ length: 30 }, (_, index) => `Review point ${index + 1}`)].join('\n');

export async function buildSpeakerNotesFixture(base: Uint8Array): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(base);
  const relType = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
  const presentation = 'http://schemas.openxmlformats.org/presentationml/2006/main';
  const drawing = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const relations = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const shape = (id: number, placeholder: string, paragraphs: string) => `<p:sp>
    <p:nvSpPr><p:cNvPr id="${id}" name="Notes shape ${id}"/><p:cNvSpPr/><p:nvPr>${placeholder}</p:nvPr></p:nvSpPr>
    <p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`;
  const paragraph = (text: string) => `<a:p><a:r><a:t>${text}</a:t></a:r></a:p>`;
  const part = (root: 'notes' | 'notesMaster', shapes: string) => `<p:${root} xmlns:p="${presentation}" xmlns:a="${drawing}">
    <p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
    ${shapes}</p:spTree></p:cSld></p:${root}>`;
  const masterName = 'ppt/notesMasters/notesMaster1.xml';
  const primaryName = 'ppt/notesSlides/custom-notes.xml';
  const inheritedName = 'ppt/notesSlides/notesSlide19.xml';
  zip.file(masterName, part('notesMaster', shape(2, '<p:ph type="body" idx="42"/>', paragraph('Master prompt text'))));
  zip.file(primaryName, part('notes', [
    shape(2, '<p:ph type="sldNum" idx="10"/>', paragraph('Do not include the slide number')),
    shape(3, '<p:ph type="body" idx="42"/>', `<a:p><a:r><a:t>先确认原始数据 &amp; 来源。</a:t></a:r><a:br/>
      <a:fld id="{ABCDEF00-1111-2222-3333-444444444444}" type="datetime"><a:t>2026</a:t></a:fld>
      <a:r><a:t>：保留段落。</a:t></a:r></a:p><a:p/>${paragraph('&lt;em&gt;这行是备注文本&lt;/em&gt;')}`),
    shape(4, '', paragraph('Do not include the handout text box'))
  ].join('')));
  zip.file(inheritedName, part('notes', [
    shape(2, '<p:ph idx="8"/>', paragraph('Do not include an unrelated placeholder')),
    shape(3, '<p:ph idx="42"/>', secondSpeakerNotes.split('\n').map(paragraph).join(''))
  ].join('')));
  zip.file('ppt/notesSlides/_rels/notesSlide19.xml.rels', `<Relationships xmlns="${relations}">
    <Relationship Id="rId1" Type="${relType}notesMaster" Target="../notesMasters/notesMaster1.xml"/>
    </Relationships>`);
  for (const [index, path] of [[1, primaryName], [2, inheritedName]] as const) {
    const link = `ppt/slides/_rels/slide${index}.xml.rels`;
    const xml = await zip.file(link)!.async('text');
    zip.file(link, xml.replace('</Relationships>',
      `<Relationship Id="rIdNotes" Type="${relType}notesSlide" Target="../${path.slice('ppt/'.length)}"/></Relationships>`));
  }
  const contentTypes = await zip.file('[Content_Types].xml')!.async('text');
  zip.file('[Content_Types].xml', contentTypes.replace('</Types>', [primaryName, inheritedName, masterName].map(path =>
    `<Override PartName="/${path}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.${path === masterName ? 'notesMaster' : 'notesSlide'}+xml"/>`
  ).join('') + '</Types>'));
  return zip.generateAsync({ type: 'uint8array' });
}
