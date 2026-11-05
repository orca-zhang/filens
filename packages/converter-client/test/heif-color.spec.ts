// @vitest-environment node
import createHeif from '../vendor/libheif/libheif.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { pngPixels } from './helpers/png-rgba';
import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { withDecodedHeif, type HeifModule } from '../src/heif-decoder';
import { createHeifNormalizer } from '../src/heif-color';

const cases = JSON.parse(readFileSync(new URL('./fixtures/heif/cases.json', import.meta.url), 'utf8')) as Array<{
  name: string; width: number; height: number; reference: string; sha256: string;
}>;

const fixture = (name: string) => readFileSync(new URL(`./fixtures/heif/${name}`, import.meta.url));
let heif: HeifModule;
let normalize: Awaited<ReturnType<typeof createHeifNormalizer>>;
beforeAll(async () => {
  heif = await createHeif({
    wasmBinary: readFileSync(new URL('../vendor/libheif/libheif.wasm', import.meta.url))
  });
  const wasm = readFileSync(new URL('../../../wasm/converter-image/dist/converter-image.wasm', import.meta.url));
  normalize = await createHeifNormalizer(`data:application/wasm;base64,${wasm.toString('base64')}`);
});

describe('HEIF color conversion in the frontend WASM core', () => {
  it('uses the corrected HEVC decoder for 10-bit 4:4:4 chroma', () => {
    const decoder = heif as HeifModule & { _de265_get_version(): number };
    const pointer = decoder._de265_get_version();
    let end = pointer;
    while (heif.HEAPU8[end]) end++;
    expect(new TextDecoder().decode(heif.HEAPU8.subarray(pointer, end))).toBe('1.0.18');
    const actual = pngPixels(withDecodedHeif(heif, fixture('chroma10-444.heic'), normalize, normalize.readColorProfile));
    const expected = fixture('chroma10-444.rgba');
    expect([actual.width, actual.height]).toEqual([128, 96]);
    expect(actual.pixels.length).toBe(expected.length);
    let error = 0;
    for (let i = 0; i < expected.length; i++) error += Math.abs(actual.pixels[i]! - expected[i]!);
    expect(error / expected.length).toBeLessThan(2);
  });

  it.skipIf(!process.env.FILENS_EDITED_APPLE_HEIF || !process.env.FILENS_EDITED_APPLE_RGBA)('edited Apple HEIC: matches the independent sRGB reference', () => {
    const input = readFileSync(process.env.FILENS_EDITED_APPLE_HEIF!);
    const output = withDecodedHeif(heif, input, normalize, normalize.readColorProfile);
    const actual = pngPixels(output);
    expect([actual.width, actual.height]).toEqual([1576, 2100]);
    if (process.env.FILENS_EDITED_APPLE_OUTPUT) writeFileSync(process.env.FILENS_EDITED_APPLE_OUTPUT, output);
    const expected = readFileSync(process.env.FILENS_EDITED_APPLE_RGBA!);
    expect(actual.pixels.length).toBe(expected.length);
    let error = 0;
    for (let i = 0; i < expected.length; i++) error += Math.abs(actual.pixels[i]! - expected[i]!);
    console.info(`Edited Apple HEIC RGBA mean absolute error: ${error / expected.length}`);
    expect(error / expected.length).toBeLessThan(2);
  }, 60_000);

  it.each(['p3-10-alpha', 'linear10-icc-alpha'])('grid %s: inherits consistent tile color without mixing alpha profiles', name => {
    for (const suffix of ['', '-nested-vui']) {
      const actual = pngPixels(withDecodedHeif(heif, fixture(`grid-${name}${suffix}.heic`), normalize, normalize.readColorProfile));
      const expected = fixture(`grid-${name}.rgba`);
      expect([actual.width, actual.height]).toEqual([128, 128]);
      let maximum = 0;
      for (let i = 0; i < expected.length; i++) maximum = Math.max(maximum, Math.abs(actual.pixels[i]! - expected[i]!));
      expect(maximum).toBeLessThanOrEqual(3);
    }
  });

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
