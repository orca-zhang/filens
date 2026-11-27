import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from '@zip.js/zip.js/lib/zip-core-native.js';
import JSZip from 'jszip';
import { createBookFixture } from './books.mjs';

export async function createRangeBookFixture(format, { zip64 = false } = {}) {
  const zip = format === 'epub' ? await JSZip.loadAsync(await createBookFixture(3, 2)) : new JSZip();
  const date = new Date('2020-01-01T00:00:00Z');
  let manifest = '';
  for (let i = 1; i <= 3; i++) {
    const name = `pages/page-${i}.svg`;
    const padding = i === 2 ? '<!--' + 'x'.repeat(768 * 1024) + '-->' : '';
    const body = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"><text x="15" y="20">Artwork ${i}</text>${padding}</svg>`;
    zip.file(format === 'epub' ? 'OPS/' + name : name, body, { date, compression: 'STORE' });
    if (format === 'epub') {
      const chapter = zip.file(`OPS/chapter-${i}.xhtml`);
      zip.file(chapter.name, (await chapter.async('string')).replace('</body>', `<img src="${name}"/></body>`), { date });
      manifest += `<item id="art-${i}" href="${name}" media-type="image/svg+xml"/>`;
    }
  }
  if (format === 'epub') {
    const file = zip.file('OPS/package.opf');
    zip.file(file.name, (await file.async('string')).replace('</manifest>', manifest + '</manifest>'), { date });
  }
  // Keep the large unread image out of the metadata tail.
  zip.file('other/padding.bin', new Uint8Array(128 * 1024), { date, compression: 'STORE' });
  if (zip64) {
    const writer = new ZipWriter(new Uint8ArrayWriter(), { zip64: true, useWebWorkers: false });
    for (const file of Object.values(zip.files)) {
      if (file.dir) continue;
      await writer.add(file.name, new Uint8ArrayReader(await file.async('uint8array')), { level: 0, lastModDate: date });
    }
    return Buffer.from(await writer.close());
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
