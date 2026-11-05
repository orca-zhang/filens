// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { loadDxfDrawing } from '@filens/cad';
import { createWasmConverterClient } from '../src';
import { createWasmCoreRunner } from '../src/wasi-runner';
import { pngPixels } from './helpers/png-rgba';

const root = new URL('../../../', import.meta.url);
const context = { descriptor: { source: new Uint8Array() } };
const sample = (name: string) => readFile(new URL(`apps/demo/public/samples/graphics/${name}`, root));
let wasm: WebAssembly.Module;
let graphicsWasm: WebAssembly.Module;
let client: ReturnType<typeof createWasmConverterClient>;

beforeAll(async () => {
  [wasm, graphicsWasm] = await Promise.all(['converter-core', 'converter-graphics'].map(async name =>
    WebAssembly.compile(await readFile(new URL(`wasm/converter-core/dist/${name}.wasm`, root)))));
  client = createWasmConverterClient({ wasm, graphicsWasm });
});

describe('graphics previews through the shared WASM conversion core', () => {
  it.each([
    ['tiff', 'field-notes.tiff', 1200, 800],
    ['tif', 'tonal-ramp-16bit.tif', 768, 512],
    ['tga', 'texture-study.tga', 1200, 800],
    ['pgm', 'portable-gray.pgm', 900, 600],
    ['pbm', 'portable-ink.pbm', 900, 600],
    ['pnm', 'portable-color.pnm', 900, 600],
    ['dds', 'surface-atlas.dds', 1024, 512],
    ['hdr', 'studio-light.hdr', 256, 128],
    ['dib', 'color-archive.dib', 900, 600],
    ['cur', 'studio-pointer.cur', 64, 64],
    ['cur', 'studio-pointer-bmp.cur', 64, 64],
    ['pcx', 'color-archive.pcx', 900, 600],
    ['pcx', 'indexed-archive.pcx', 900, 600],
    ['exr', 'linear-light.exr', 900, 600],
    ['jxl', 'color-archive.jxl', 900, 600],
    ['qoi', 'color-archive.qoi', 900, 600],
    ['ff', 'color-archive.ff', 900, 600]
  ])('decodes original %s data into an 8-bit RGBA PNG', async (format, name, width, height) => {
    const result = await client.convert({ source: await sample(name), sourceFormat: format, targetFormat: 'png' }, context);
    const png = Buffer.from(result.source as Uint8Array);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect([png.readUInt32BE(16), png.readUInt32BE(20), png[24], png[25]]).toEqual([width, height, 8, 6]);
    expect(result).toMatchObject({ format: 'png', contentType: 'image/png' });
    if (format === 'tiff') expect(result.warnings?.join(' ')).toContain('first image');
    if (['dib', 'pcx', 'exr', 'jxl', 'qoi', 'ff', 'cur'].includes(format)) {
      const { pixels } = pngPixels(png);
      expect([...pixels.subarray(0, 4)]).toEqual(format === 'cur' ? [0, 0, 0, 0] : [220, 107, 69, 255]);
      if (format === 'cur') {
        const inside = (30 * Number(width) + 20) * 4;
        expect([...pixels.subarray(inside, inside + 4)]).toEqual([233, 186, 100, 255]);
      }
    }
  });

  it.each(['2000', '2018'])('preserves cafe geometry, layers and text from DWG R%s', async version => {
    const result = await client.convert({ source: await sample(`filens-cafe-${version}.dwg`), sourceFormat: 'dwg', targetFormat: 'dxf' }, context);
    expect(result).toMatchObject({ format: 'dxf', contentType: 'image/vnd.dxf' });
    const dxf = new TextDecoder().decode(result.source as Uint8Array);
    const drawing = loadDxfDrawing(dxf);
    expect(dxf).toContain('AC1032');
    expect(drawing.entities.length).toBeGreaterThan(40);
    expect(drawing.layers.length).toBeGreaterThan(3);
    expect(drawing.entities.some(entity => entity.type === 'text' && entity.value.includes('FIELD NOTES / CAFE'))).toBe(true);
    expect(drawing.bounds.maxX).toBeGreaterThan(drawing.bounds.minX);
    expect(result.warnings?.join(' ')).toContain('2D preview');
  });

  it('downloads only the optional graphics module and reuses it', async () => {
    const core = vi.fn(() => { throw new Error('Unexpected document core download'); });
    const graphics = vi.fn(() => graphicsWasm);
    const local = createWasmConverterClient({ wasm: core, graphicsWasm: graphics });
    for (const [format, name, target] of [['tiff', 'field-notes.tiff', 'png'], ['dwg', 'filens-cafe-2018.dwg', 'dxf']]) {
      await local.convert({ source: await sample(name), sourceFormat: format, targetFormat: target }, context);
    }
    expect(core).not.toHaveBeenCalled();
    expect(graphics).toHaveBeenCalledTimes(1);
  });

  it.each([['txt', 'docx'], ['tga', 'dxf']])('rejects %s to %s sent directly to the graphics module', async (source, target) => {
    const run = createWasmCoreRunner({ wasm: graphicsWasm });
    const invocation = await run({
      args: ['converter-graphics', '--input', '/work/input', '--output', '/work/output',
        '--source', source, '--target', target, '--result', '/work/result.json'],
      files: { '/work/input': new TextEncoder().encode('Unrelated document') },
      readFiles: ['/work/result.json', '/work/output']
    });
    expect(invocation.exitCode).toBe(1);
    expect(JSON.parse(new TextDecoder().decode(invocation.files['/work/result.json'])))
      .toMatchObject({ ok: false, errorCode: 'unsupported_format' });
    expect(invocation.files['/work/output']).toBeUndefined();
  });

  it('retains the 64 MiB graphics input limit', async () => {
    await expect(client.convert({ source: new Uint8Array((64 << 20) + 1), sourceFormat: 'tga', targetFormat: 'png' }, context))
      .rejects.toMatchObject({ result: { errorCode: 'parse_error', errorMessage: 'Graphics input exceeds the 64 MiB limit' } });
  });

  it('identifies the required module when only the compact document core is configured', async () => {
    await expect(createWasmConverterClient({ wasm }).convert({ source: await sample('field-notes.tiff'), sourceFormat: 'tiff', targetFormat: 'png' }, context))
      .rejects.toMatchObject({ result: { errorCode: 'engine_unavailable', requiredModule: 'graphics' } });
  });

  it('supports the combined core without a separate graphics module', async () => {
    const full = await WebAssembly.compile(await readFile(new URL('wasm/converter-core/dist/converter-core-full.wasm', root)));
    const combined = createWasmConverterClient({ wasm: full });
    const result = await combined.convert({ source: await sample('field-notes.tiff'), sourceFormat: 'tiff', targetFormat: 'png' }, context);
    expect(result).toMatchObject({ format: 'png', contentType: 'image/png' });
    const cad = await combined.convert({ source: await sample('filens-cafe-2018.dwg'), sourceFormat: 'dwg', targetFormat: 'dxf' }, context);
    expect(new TextDecoder().decode(cad.source as Uint8Array)).toContain('FIELD NOTES / CAFE');
  });

  it.each(['dwg', 'tiff', 'tga', 'dds', 'hdr', 'pnm', 'dib', 'cur', 'pcx', 'exr', 'jxl', 'qoi', 'ff'])('rejects unrelated bytes presented as %s', async sourceFormat => {
    await expect(client.convert({ source: new TextEncoder().encode('<svg/>'), sourceFormat, targetFormat: sourceFormat === 'dwg' ? 'dxf' : 'png' }, context))
      .rejects.toMatchObject({ result: { errorCode: 'parse_error' } });
  });

  it('bounds decoded dimensions before allocating the raster', async () => {
    await expect(client.convert({ source: new TextEncoder().encode('P5\n40000 40000\n255\n'), sourceFormat: 'pgm', targetFormat: 'png' }, context))
      .rejects.toMatchObject({ result: { errorCode: 'parse_error' } });
  });

  it('rejects a truncated indexed PCX scanline even with an intact palette', async () => {
    const original = await sample('indexed-archive.pcx');
    const truncated = Buffer.concat([original.subarray(0, 132), original.subarray(-769)]);
    await expect(client.convert({ source: truncated, sourceFormat: 'pcx', targetFormat: 'png' }, context))
      .rejects.toMatchObject({ result: { errorCode: 'parse_error' } });
  });

  it('rejects a CUR image directory that points outside the file', async () => {
    const damaged = Buffer.from(await sample('studio-pointer.cur'));
    damaged.writeUInt32LE(0xffffff00, 18);
    await expect(client.convert({ source: damaged, sourceFormat: 'cur', targetFormat: 'png' }, context))
      .rejects.toMatchObject({ result: { errorCode: 'parse_error' } });
  });
});
