import { inflateSync } from 'node:zlib';
import { expect } from 'vitest';

/** Decode the core's lossless RGBA PNG independently, including all PNG row filters. */
export function pngPixels(png: Uint8Array) {
  const bytes = Buffer.from(png), idat: Buffer[] = [];
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20), stride = width * 4;
  expect([...bytes.subarray(24, 26)]).toEqual([8, 6]);
  for (let at = 8; at < bytes.length;) {
    const length = bytes.readUInt32BE(at), type = bytes.toString('ascii', at + 4, at + 8);
    if (type === 'IDAT') idat.push(bytes.subarray(at + 8, at + 8 + length));
    at += length + 12;
  }
  const raw = inflateSync(Buffer.concat(idat)), result = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    for (let x = 0; x < stride; x++) {
      const at = y * stride + x, left = x >= 4 ? result[at - 4]! : 0;
      const up = y ? result[at - stride]! : 0, corner = y && x >= 4 ? result[at - stride - 4]! : 0;
      const p = left + up - corner, a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - corner);
      const prediction = [0, left, up, Math.floor((left + up) / 2), a <= b && a <= c ? left : b <= c ? up : corner][filter];
      if (prediction === undefined) throw new Error('Invalid PNG filter');
      result[at] = raw[y * (stride + 1) + 1 + x]! + prediction;
    }
  }
  return { width, height, pixels: result };
}

