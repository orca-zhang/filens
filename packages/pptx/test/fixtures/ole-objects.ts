import JSZip from 'jszip';
import { buildEmfPoster, buildWmfPoster } from '../../../core/test/fixtures/metafile';

export const embeddedObjectPart = 'ppt/objects/quarterly.xlsx';
export const embeddedObjectName = 'Quarterly workbook';
export async function buildOleObjectsFixture(base: Uint8Array, workbook: Uint8Array, metafilePosters = false): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(base);
  const posterName = metafilePosters ? 'ole-preview.emf' : 'ole-preview.png';
  const linkedPreview = metafilePosters ? 'rIdWmfPreview' : 'rIdOlePreview';
  const brokenName = metafilePosters ? 'broken-ole-preview.emf' : 'broken-ole-preview.png';
  const office = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const compatibility = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
  const picture = (relationship: string, crop = '') => `<p:pic>
    <p:nvPicPr><p:cNvPr id="0" name="Preview"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
    <p:blipFill><a:blip r:embed="${relationship}"/>${crop}<a:stretch><a:fillRect/></a:stretch></p:blipFill>
    <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1000" cy="2000"/></a:xfrm>
      <a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
  </p:pic>`;
  const frame = (id: number, name: string, x: number, contents: string) => `<p:graphicFrame>
    <p:nvGraphicFramePr><p:cNvPr id="${id}" name="${name}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
    <p:xfrm><a:off x="${x}" y="381000"/><a:ext cx="1524000" cy="952500"/></p:xfrm>
    <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/presentationml/2006/ole">${contents}</a:graphicData></a:graphic>
  </p:graphicFrame>`;
  const embedded = `<mc:AlternateContent xmlns:mc="${compatibility}" xmlns:v="urn:schemas-microsoft-com:vml">
      <mc:Choice Requires="v"><p:oleObj name="Legacy branch" r:id="rIdWorkbook" progId="Excel.Sheet.12"><p:embed/></p:oleObj></mc:Choice>
      <mc:Fallback><p:oleObj name="${embeddedObjectName}" r:id="rIdWorkbook" progId="Excel.Sheet.12">
        <p:embed/>${picture('rIdOlePreview', '<a:srcRect l="12500"/>')}
      </p:oleObj></mc:Fallback>
    </mc:AlternateContent>`;
  const linked = `<p:oleObj name="Linked workbook" r:id="rIdLinked" progId="Excel.Sheet.12">
    <p:link updateAutomatic="1"/>${picture(linkedPreview)}
  </p:oleObj>`;
  const unavailable = `<p:oleObj name="Unavailable object" r:id="rIdMissingObject" progId="Word.Document.12">
    <p:embed/>${picture('rIdBadPoster')}
  </p:oleObj>`;
  const path = 'ppt/slides/slide2.xml';
  const slide = await zip.file(path)!.async('text');
  zip.file(path, slide.replace('</p:spTree>', `<p:grpSp>
    <p:nvGrpSpPr><p:cNvPr id="901" name="OLE group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr><a:xfrm><a:off x="914400" y="3429000"/><a:ext cx="6096000" cy="1524000"/>
      <a:chOff x="0" y="0"/><a:chExt cx="6096000" cy="1524000"/></a:xfrm></p:grpSpPr>
    ${frame(902, 'Embedded worksheet', 0, embedded)}
    ${frame(903, 'Linked worksheet', 1828800, linked)}
    ${frame(904, 'Missing object', 3657600, unavailable)}
  </p:grpSp></p:spTree>`));
  const relPath = 'ppt/slides/_rels/slide2.xml.rels';
  const rels = await zip.file(relPath)!.async('text');
  zip.file(relPath, rels.replace('</Relationships>', `
    <Relationship Id="rIdWorkbook" Type="${office}/package" Target="../objects/quarterly.xlsx"/>
    <Relationship Id="rIdLinked" Type="${office}/oleObject" Target="https://example.invalid/linked-worksheet.xlsx" TargetMode="External"/>
    <Relationship Id="rIdOlePreview" Type="${office}/image" Target="../media/${posterName}"/>
    <Relationship Id="rIdBadPoster" Type="${office}/image" Target="../media/${brokenName}"/>
    ${metafilePosters ? `<Relationship Id="rIdWmfPreview" Type="${office}/image" Target="../media/ole-preview.wmf"/>` : ''}
  </Relationships>`));
  const contentTypes = await zip.file('[Content_Types].xml')!.async('text');
  zip.file('[Content_Types].xml', contentTypes.replace('</Types>', `
    <Override PartName="/${embeddedObjectPart}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/>
    ${metafilePosters ? '<Default Extension="emf" ContentType="image/x-emf"/><Default Extension="wmf" ContentType="image/x-wmf"/>' : ''}
  </Types>`));
  if (metafilePosters) {
    zip.file(`ppt/media/${posterName}`, buildEmfPoster());
    zip.file('ppt/media/ole-preview.wmf', buildWmfPoster());
  } else {
    zip.file(`ppt/media/${posterName}`, 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAAFUlEQVR4nGOQDD0LRJeefQUiBmQOALaGD6EoghojAAAAAElFTkSuQmCC', { base64: true });
  }
  zip.file(`ppt/media/${brokenName}`, 'Invalid image');
  zip.file(embeddedObjectPart, workbook);
  return zip.generateAsync({ type: 'uint8array' });
}
