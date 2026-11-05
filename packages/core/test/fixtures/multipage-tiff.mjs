import { deflateSync } from 'node:zlib';
import UTIF from 'utif';

export function createMultipageTiff(pageCount = 16, width = 512, height = 512) {
  const pages = Array.from({ length: pageCount }, (_, page) => Uint8Array.from({ length: width * height * 4 }, (_, index) =>
    index % 4 === 3 ? 255 : (index * 37 + (index >>> 9) + page * 17) % 256));
  const payloads = pages.map(page => deflateSync(page));
  const ifds = payloads.map(payload => ({ t256: [width], t257: [height], t258: [8, 8, 8, 8], t259: [8], t262: [2],
    t273: [0], t277: [4], t278: [height], t279: [payload.length], t284: [1], t338: [1] }));
  let offset = UTIF.encode(ifds).byteLength;
  for (let index = 0; index < ifds.length; index++) { ifds[index].t273[0] = offset; offset += payloads[index].length; }
  const bytes = new Uint8Array(offset);
  bytes.set(new Uint8Array(UTIF.encode(ifds)));
  for (let index = 0; index < ifds.length; index++) bytes.set(payloads[index], ifds[index].t273[0]);
  return { bytes, firstPage: pages[0], width, height, pageCount };
}
