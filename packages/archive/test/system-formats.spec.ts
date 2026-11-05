// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { createArchivePreviewDriver, createArchivePreviewRoutes, createArchiveResourceIndex } from '../src';
import { runSevenZip } from '../src/sevenzip/runtime';
import engine from '../vendor/7zip/7zz.js';

vi.mock('../src/sevenzip/client', async () => {
  const { runSevenZip } = await import('../src/sevenzip/runtime');
  const { default: engine } = await import('../vendor/7zip/7zz.js');
  return { runArchiveWorker: async (request: any, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    const result = await runSevenZip({ ...request, maxEntries: 20_000, maxEntryBytes: 128 << 20 }, engine);
    signal?.throwIfAborted();
    return result;
  } };
});

const sample = (name: string) => readFile(new URL(`../../../apps/demo/public/samples/archives/${name}`, import.meta.url));
const context = (name: string, signal?: AbortSignal) => ({ descriptor: { source: new Uint8Array(), name, extension: name.split('.').pop() }, signal });
const formats = ['z', 'taz', 'bzip2', 'tzst', 'lzma86', 'lha', 'lzh', 'rpm', 'xar', 'wim', 'esd', 'udf'];
const streams = [['Z', 'z'], ['bzip2', 'bzip2'], ['lzma86', 'lzma86']] as const;
const originalText = '# Filens field notes\n\nOriginal seasonal color study · 季节色谱.\nFour palettes, one year, packaged for local read-only preview.\n';

describe('system and package archive formats', () => {
  it.each(formats)('registers a working %s route', format => {
    expect(createArchivePreviewRoutes().some(route => route.extensions.includes(format))).toBe(true);
    expect(createArchivePreviewDriver().supports(format)).toBe(true);
  });

  it.each(streams)('decodes a real %s stream', async extension => {
    const name = `field-notes.md.${extension}`;
    const index = await createArchiveResourceIndex(await sample(name), context(name));
    expect(index.files.map(file => file.name)).toEqual(['field-notes.md']);
    expect(await index.read('field-notes.md')!.readAsText()).toBe(originalText);
  });

  it.each(['field-notes.taz', 'field-notes.tzst', 'field-notes.lha', 'field-notes.lzh',
    'field-notes.xar', 'field-notes-bzip2.xar', 'field-notes.wim', 'field-notes.esd', 'field-notes.udf'])(
    'reads real entries and original artwork in %s', async name => {
      const index = await createArchiveResourceIndex(await sample(name), context(name));
      const member = (filename: string) => index.files.find(file => file.name === filename || file.name.endsWith(`/${filename}`))!;
      expect(await member('README.md').readAsText()).toBe(originalText);
      expect(await member('seasons.svg').readAsText()).toContain('A year in four colors');
      expect(JSON.parse(await member('palette.json').readAsText())).toMatchObject({ winter: '#6c8ead', autumn: '#e07a5f' });
    });

  it.each(['xz', 'zstd'])('opens an actual RPM with a %s CPIO payload through the shared nested reader', async codec => {
    const name = `field-notes-${codec}.rpm`;
    const index = await createArchiveResourceIndex(await sample(name), context(name));
    expect(index.files).toHaveLength(1);
    const member = index.files[0];
    expect(member.name).toContain(`.cpio.${codec === 'zstd' ? 'zst' : 'xz'}`);
    const child = await createArchiveResourceIndex(await member.readAsArrayBuffer(), context(member.name));
    expect(child.files).toHaveLength(3);
    expect(await child.read('README.md')!.readAsText()).toBe(originalText);
    expect(await child.read('seasons.svg')!.readAsText()).toContain('A year in four colors');
  });

  it('reads a UDF-only image uploaded with the usual .iso extension and keeps that reader for extraction', async () => {
    const index = await createArchiveResourceIndex(await sample('field-notes.udf'), context('udf-only.iso'));
    expect(await index.read('README.md')!.readAsText()).toBe(originalText);
    expect(await index.read('seasons.svg')!.readAsText()).toContain('A year in four colors');
  });

  it('keeps separate Windows images and extracts files from each image', async () => {
    const name = 'field-notes-multi.wim';
    const index = await createArchiveResourceIndex(await sample(name), context(name));
    expect(await index.read('1/README.md')!.readAsText()).toBe(originalText);
    expect(await index.read('2/README.md')!.readAsText()).toBe(originalText + '\nSecond image: winter edition.\n');
  });

  it.each(streams)('bounds %s stream output', async (extension, format) => {
    await expect(runSevenZip({ bytes: await sample(`field-notes.md.${extension}`), format, stream: true,
      maxEntries: 20_000, maxEntryBytes: 8 }, engine)).rejects.toThrow('size limit');
  });

  it.each(formats)('rejects unrelated data named %s', async extension => {
    await expect(createArchiveResourceIndex(new Uint8Array([1, 2, 3]), context(`broken.${extension}`))).rejects.toThrow();
  });

  it.each(formats)('honors cancellation before reading %s', async extension => {
    const controller = new AbortController(); controller.abort();
    await expect(createArchiveResourceIndex(new Uint8Array(), context(`cancelled.${extension}`, controller.signal))).rejects.toMatchObject({ name: 'AbortError' });
  });
});
