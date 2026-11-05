import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { createMultipageTiff } from './multipage-tiff.mjs';

export async function createTiffPresentation(corruptUnusedPage = false) {
  const tiff = createMultipageTiff(3, 64, 64);
  if (corruptUnusedPage) tiff.bytes[tiff.bytes.length - 1] ^= 1;
  const zip = await JSZip.loadAsync(await readFile(new URL('../../../../apps/demo/public/samples/sample-deck.pptx', import.meta.url)));
  zip.file('ppt/slides/slide1.xml', await zip.file('ppt/slides/slide2.xml').async('string'));
  zip.file('ppt/slides/_rels/slide1.xml.rels', await zip.file('ppt/slides/_rels/slide2.xml.rels').async('string'));
  for (const file of Object.values(zip.files)) {
    if (file.name.endsWith('.rels')) zip.file(file.name, (await file.async('string')).replaceAll('image1.png', 'image1.tif'));
  }
  zip.file('[Content_Types].xml', (await zip.file('[Content_Types].xml').async('string'))
    .replace('Extension="png" ContentType="image/png"', 'Extension="tif" ContentType="image/tiff"'));
  zip.remove('ppt/media/image1.png'); zip.file('ppt/media/image1.tif', tiff.bytes);
  return { bytes: await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }), firstPage: tiff.firstPage,
    width: tiff.width, height: tiff.height };
}
