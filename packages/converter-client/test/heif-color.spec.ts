// @vitest-environment node
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { withDecodedHeif, type HeifModule } from '../src/heif-decoder';
import { createHeifNormalizer } from '../src/heif-color';

const cases = JSON.parse(readFileSync(new URL('./fixtures/heif/cases.json', import.meta.url), 'utf8')) as Array<{
  name: string; width: number; height: number; reference: string; sha256: string;
}>;

const require = createRequire(import.meta.url);
const fixture = (name: string) => readFileSync(new URL(`./fixtures/heif/${name}`, import.meta.url));
let heif: HeifModule;
let normalize: Awaited<ReturnType<typeof createHeifNormalizer>>;
beforeAll(async () => {
  heif = await require('libheif-js/libheif-wasm/libheif.js')({
    wasmBinary: readFileSync(require.resolve('libheif-js/libheif-wasm/libheif.wasm'))
  });
  const wasm = readFileSync(new URL('../../../wasm/converter-image/dist/converter-image.wasm', import.meta.url));
  normalize = await createHeifNormalizer(`data:application/wasm;base64,${wasm.toString('base64')}`);
});

/** Decode the core's lossless RGBA PNG independently, including all PNG row filters. */
function pngPixels(png: Uint8Array) {
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

describe('HEIF color conversion in the frontend WASM core', () => {
  for (const test of cases) it(`${test.name}: matches independent source-depth SDR reference`, () => {
    const expected = fixture(test.reference);
    expect(createHash('sha256').update(expected).digest('hex')).toBe(test.sha256);
    const actual = pngPixels(withDecodedHeif(heif, fixture(`${test.name}.heic`), normalize, normalize.readColorProfile));
    expect([actual.width, actual.height]).toEqual([test.width, test.height]);
    expect(actual.pixels.length).toBe(expected.length);
    let maximum = 0;
    for (let i = 0; i < expected.length; i++) maximum = Math.max(maximum, Math.abs(actual.pixels[i]! - expected[i]!));
    expect(maximum).toBeLessThanOrEqual(3);
  });

  it('rejects malformed input and releases its context before decoding a valid image again', () => {
    expect(() => withDecodedHeif(heif, new Uint8Array([0, 1, 2, 3]), normalize, normalize.readColorProfile)).toThrow('parsing');
    expect(() => withDecodedHeif(heif, fixture('pq10.heic'), () => { throw new Error('consumer cancelled'); })).toThrow('cancelled');
    expect(pngPixels(withDecodedHeif(heif, fixture('pq10.heic'), normalize, normalize.readColorProfile)).width).toBe(64);
  });

  it.each(['pq10', 'hlg10'])('%s: preserves HEVC VUI HDR when container color metadata is absent', name => {
    const input = fixture(`${name}.heic`);
    const at = input.indexOf('colr');
    expect(at).toBeGreaterThan(0);
    input.write('free', at); // Keep every codec byte, box size and offset unchanged.
    const actual = pngPixels(withDecodedHeif(heif, input, normalize, normalize.readColorProfile));
    const expected = fixture(`${name}.rgba`);
    let maximum = 0;
    for (let i = 0; i < expected.length; i++) maximum = Math.max(maximum, Math.abs(actual.pixels[i]! - expected[i]!));
    expect(maximum).toBeLessThanOrEqual(3);
  });

  it.each(['thumbnail-valid', 'thumbnail-oversize', 'collection-mixed', 'collection-ICC'])('%s: selects only the primary image', name => {
    const actual = pngPixels(withDecodedHeif(heif, fixture(`${name}.heic`), normalize, normalize.readColorProfile));
    const wide = name.startsWith('thumbnail');
    expect([actual.width, actual.height]).toEqual([wide ? 128 : 64, 64]);
    // The primary stretches PQ patches horizontally. Its associated HLG thumbnail
    // must not replace it, even when that thumbnail declares oversized metadata.
    const expected = fixture(name === 'collection-ICC' ? 'pq12-icc.rgba' : 'pq10.rgba');
    let maximum = 0;
    for (let y = 0; y < 64; y++) for (let x = 0; x < actual.width; x++) for (let c = 0; c < 4; c++) {
      maximum = Math.max(maximum, Math.abs(actual.pixels[(y * actual.width + x) * 4 + c]! - expected[(y * 64 + Math.floor(x / (wide ? 2 : 1))) * 4 + c]!));
    }
    expect(maximum).toBeLessThanOrEqual(3);
  });

  it.each(['alpha-source-max', 'alpha-source-over'])('%s: rejects oversized auxiliary image metadata', name => {
    expect(() => withDecodedHeif(heif, fixture(`${name}.heic`), normalize, normalize.readColorProfile)).toThrow();
  });

  it('rejects oversized primary image metadata before decoding pixels', () => {
    const input = fixture('pq10.heic');
    const at = input.indexOf('ispe');
    expect(at).toBeGreaterThan(0);
    input.writeUInt32BE(16384, at + 8); input.writeUInt32BE(16384, at + 12);
    expect(() => withDecodedHeif(heif, input, normalize, normalize.readColorProfile)).toThrow();
  });
});
