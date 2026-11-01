// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createWasmConverterClient } from '../src';

const module = WebAssembly.compile(await readFile(new URL('../../../wasm/converter-core/dist/converter-core.wasm', import.meta.url)));
const root = new URL('../../../examples/go-wazero-converter/fixtures/icons/', import.meta.url);
describe('shared application icon WASM conversion', () => {
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
