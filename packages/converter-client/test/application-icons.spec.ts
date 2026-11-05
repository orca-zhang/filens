// @vitest-environment node
import { readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createWasmConverterClient } from '../src';
import { pngPixels } from './helpers/png-rgba';

const module = WebAssembly.compile(await readFile(new URL('../../../wasm/converter-core/dist/converter-core.wasm', import.meta.url)));
const root = new URL('../../../examples/go-wazero-converter/fixtures/icons/', import.meta.url);
describe('shared application icon WASM conversion', () => {
  it.skipIf(!process.env.FILENS_ALPHA_ICO || !process.env.FILENS_ALPHA_ICO_RGBA)('user ICO retains every alpha and visible RGB sample', async () => {
    const source = new Uint8Array(await readFile(process.env.FILENS_ALPHA_ICO!));
    const client = createWasmConverterClient({ wasm: await module });
    const result = await client.convert({ source, sourceFormat: 'ico', targetFormat: 'png' }, { descriptor: { source } });
    const output = result.source as Uint8Array;
    const actual = pngPixels(output);
    const expected = await readFile(process.env.FILENS_ALPHA_ICO_RGBA!);
    expect([actual.width, actual.height]).toEqual([256, 192]);
    expect(actual.pixels.length).toBe(expected.length);
    let transparent = 0, partial = 0;
    for (let i = 0; i < expected.length; i += 4) {
      const alpha = actual.pixels[i + 3]!;
      expect(alpha).toBe(expected[i + 3]);
      if (!alpha) { transparent++; continue; }
      if (alpha < 255) partial++;
      for (let c = 0; c < 3; c++) expect(actual.pixels[i + c]).toBe(expected[i + c]);
    }
    expect(transparent).toBeGreaterThan(0);
    expect(partial).toBeGreaterThan(0);
    if (process.env.FILENS_ALPHA_ICO_OUTPUT) await writeFile(process.env.FILENS_ALPHA_ICO_OUTPUT, output);
  });

  it.each(['apk', 'ipa', 'exe', 'dll', 'mui', 'mun', 'ico'])('extracts %s icons without loading the RAW image core', async sourceFormat => {
    const input = new Uint8Array(await readFile(new URL(`sample.${sourceFormat}`, root)));
    const client = createWasmConverterClient({ wasm: await module, imageWasm: () => { throw Error('icon conversion loaded the RAW decoder'); } });
    const result = await client.convert({ source: input, sourceFormat, targetFormat: 'png' }, { descriptor: { source: input } });
    expect(result).toMatchObject({ format: 'png', contentType: 'image/png', warnings: [] });
    const bytes = result.source as Uint8Array;
    expect(Array.from(bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect([header.getUint32(16), header.getUint32(20)]).toEqual([1, 1]);
  });
  it('reports iconless or damaged packages as parse errors', async () => {
    const client = createWasmConverterClient({ wasm: await module });
    const source = new Uint8Array([1, 2, 3]);
    await expect(client.convert({ source, sourceFormat: 'apk', targetFormat: 'png' }, { descriptor: { source } }))
      .rejects.toMatchObject({ result: { errorCode: 'parse_error' } });
  });
});
