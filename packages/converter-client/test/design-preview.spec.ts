// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { createWasmConverterClient } from '../src';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';

const root = new URL('../../../', import.meta.url);
const context = { descriptor: { source: new Uint8Array() } };
let client: ReturnType<typeof createWasmConverterClient>;

beforeAll(async () => {
  const wasm = await WebAssembly.compile(await readFile(new URL('wasm/converter-core/dist/converter-core.wasm', root)));
  const postscriptWasm = await WebAssembly.compile(await readFile(new URL('wasm/converter-core/dist/converter-postscript.wasm', root)));
  client = createWasmConverterClient({ wasm, postscriptWasm });
});

describe('native design previews in the shared WASM core', () => {
  it.each(['psd', 'psb'])('decodes real %s channel data to PNG', async format => {
    const source = await readFile(new URL(`examples/go-wazero-converter/fixtures/design/sample.${format}`, root));
    const result = await client.convert({ source, sourceFormat: format, targetFormat: 'png' }, context);
    const png = Buffer.from(result.source as Uint8Array);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([2, 1]);
    expect(result.contentType).toBe('image/png');
    expect(result.warnings?.join(' ')).toContain('saved merged image');
  });

  it('retains the PDF-compatible AI vector document byte for byte', async () => {
    const source = await readFile(new URL('apps/demo/public/samples/design/forma-identity.ai', root));
    const result = await client.convert({ source, sourceFormat: 'ai', targetFormat: 'pdf' }, context);
    expect(Buffer.from(result.source as Uint8Array)).toEqual(source);
    expect(result.contentType).toBe('application/pdf');
    expect(source.includes(Buffer.from('/Subtype /Image'))).toBe(false);
  });

  it.each(['psd', 'psb'])('rejects renamed SVG or thumbnail bytes presented as %s', async format => {
    await expect(client.convert({ source: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'), sourceFormat: format, targetFormat: 'png' }, context))
      .rejects.toMatchObject({ result: { errorCode: 'parse_error' } });
  });

  it.each([
    ['eps', 'orbit-marks.eps', 1, 'ORBIT'],
    ['ps', 'studio-editions.ps', 2, 'FORM IN'],
    ['ai', 'orbit-marks.eps', 1, 'ORBIT']
  ])('interprets native %s with vector paths, text and correct page geometry', async (format, file, pages, text) => {
    const source = await readFile(new URL(`apps/demo/public/samples/design/${file}`, root));
    const result = await client.convert({ source, sourceFormat: format, targetFormat: 'pdf' }, context);
    const task = getDocument({ data: new Uint8Array(result.source as Uint8Array), useSystemFonts: true });
    const pdf = await task.promise;
    try {
      expect(pdf.numPages).toBe(pages);
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        expect(page.view).toEqual([0, 0, 1440, 960]);
        const ops = await page.getOperatorList();
        expect(ops.fnArray).toContain(OPS.constructPath);
        expect(ops.fnArray).not.toContain(OPS.paintImageXObject);
        expect(ops.fnArray).not.toContain(OPS.paintInlineImageXObject);
      }
      const content = await (await pdf.getPage(1)).getTextContent();
      expect(content.items.map(item => 'str' in item ? item.str : '').join(' ')).toContain(text);
    } finally { await task.destroy(); }
  });

  it.each([
    ['undefined operators', 'unknown_filens_operator showpage', 'undefined'],
    ['missing resident outlines', '/Helvetica findfont 20 scalefont setfont 20 20 moveto (Test) true charpath fill showpage', 'invalidfont'],
    ['unavailable fonts', '/FilensMissingFont findfont 20 scalefont setfont showpage', 'invalidfont'],
    ['infinite execution', '{} loop', 'execution budget']
  ])('rejects %s explicitly', async (_name, program, message) => {
    await expect(client.convert({ source: new TextEncoder().encode(`%!PS\n${program}`), sourceFormat: 'ps', targetFormat: 'pdf' }, context))
      .rejects.toMatchObject({ result: { errorCode: 'parse_error', errorMessage: expect.stringContaining(message) } });
  });

  it('loads only the PostScript module for EPS previews', async () => {
    let coreLoaded = false;
    const postscriptWasm = await WebAssembly.compile(await readFile(new URL('wasm/converter-core/dist/converter-postscript.wasm', root)));
    const standalone = createWasmConverterClient({ wasm: () => { coreLoaded = true; throw new Error('Unexpected core download'); }, postscriptWasm });
    const source = await readFile(new URL('apps/demo/public/samples/design/orbit-marks.eps', root));
    await standalone.convert({ source, sourceFormat: 'eps', targetFormat: 'pdf' }, context);
    expect(coreLoaded).toBe(false);
  });

  it('reports the required module when the compact interpreter is not configured', async () => {
    const wasm = await WebAssembly.compile(await readFile(new URL('wasm/converter-core/dist/converter-core.wasm', root)));
    const source = await readFile(new URL('apps/demo/public/samples/design/orbit-marks.eps', root));
    await expect(createWasmConverterClient({ wasm }).convert({ source, sourceFormat: 'eps', targetFormat: 'pdf' }, context))
      .rejects.toMatchObject({ result: { errorCode: 'engine_unavailable', requiredModule: 'postscript' } });
  });
});
