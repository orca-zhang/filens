import JSZip from 'jszip';

const powerPoint2010 = 'http://schemas.microsoft.com/office/powerpoint/2010/main';
const compatibility = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

export async function buildSlideTransitionsFixture(base: Uint8Array): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(base);
  const transitions = [
    '<p:transition advClick="false"><p:fade thruBlk="1"/></p:transition>',
    `<mc:AlternateContent xmlns:mc="${compatibility}" xmlns:motion="${powerPoint2010}" xmlns:foreign="urn:test">
      <mc:Choice Requires="foreign"><p:transition><p:cut/></p:transition></mc:Choice>
      <mc:Choice Requires="motion"><p:transition spd="fast" advTm="0" motion:dur="1.6s"><p:push dir="u"/></p:transition></mc:Choice>
      <mc:Fallback><p:transition spd="slow"><p:push dir="u"/></p:transition></mc:Fallback>
    </mc:AlternateContent>`,
    `<mc:AlternateContent xmlns:mc="${compatibility}" xmlns:p14="${powerPoint2010}">
      <mc:Choice Requires="p14"><p:transition spd="med" p14:dur="1200"><p14:ripple dir="ld"/></p:transition></mc:Choice>
      <mc:Fallback><p:transition spd="slow"><p:wipe dir="r"/></p:transition></mc:Fallback>
    </mc:AlternateContent>`
  ];
  for (const [index, transition] of transitions.entries()) {
    const path = `ppt/slides/slide${index + 1}.xml`;
    const slide = await zip.file(path)!.async('text');
    zip.file(path, slide.replace('</p:sld>', transition + '</p:sld>'));
  }
  return zip.generateAsync({ type: 'uint8array' });
}
