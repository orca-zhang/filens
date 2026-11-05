// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { createArchivePreviewDriver, createArchivePreviewRoutes, createArchiveResourceIndex } from '../src';

// Exercise the production WASM engine in Node while replacing only the browser
// Worker transport. The browser tests exercise the actual transport as well.
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

describe('existing container readers for additional formats', () => {
  it.each(['xpi', 'crx', 'zipx', 'cbr', 'cb7', 'cbt'])('registers an actual reader for %s', format => {
    expect(createArchivePreviewRoutes().find(route => route.extensions.includes(format))).toMatchObject({ family: 'archive', driverId: 'archive' });
    expect(createArchivePreviewDriver().supports(format)).toBe(true);
  });

  it.each(['color-study.xpi', 'color-study-v2.crx', 'color-study-v3.crx'])('opens %s and reads original manifest and artwork bytes', async name => {
    const index = await createArchiveResourceIndex(await sample(name), context(name));
    expect(index.files.map(entry => entry.name)).toEqual(expect.arrayContaining(['manifest.json', 'README.md', 'artwork.svg']));
    expect(JSON.parse(await index.read('manifest.json')!.readAsText())).toMatchObject({ name: 'Filens sample extension', version: '1.0.0' });
    expect(await index.read('artwork.svg')!.readAsText()).toContain('A language of shapes');
  });

  it.each(['color-study-bzip2.zipx', 'color-study-deflate64.zipx', 'color-study-lzma.zipx', 'color-study.cbr', 'color-study.cb7', 'color-study.cbt'])('decodes %s with the existing shared engine', async name => {
    const index = await createArchiveResourceIndex(await sample(name), context(name));
    expect(index.files).toHaveLength(3);
    expect(await index.read('README.md')!.readAsText()).toContain('Original color and shape artwork');
    const expected = await readFile(new URL('../../../apps/demo/public/samples/graphics/color-archive.jpeg', import.meta.url));
    expect(Buffer.from(await index.read('page-2.jpeg')!.readAsArrayBuffer())).toEqual(expected);
    expect(await index.read('page-10.svg')!.readAsText()).toContain('A language of shapes');
  });

  it.each(['xpi', 'crx', 'zipx', 'cbr', 'cb7'])('rejects unrelated bytes named %s', async extension => {
    await expect(createArchiveResourceIndex(new Uint8Array([1, 2, 3]), context(`broken.${extension}`))).rejects.toThrow();
  });

  it.each(['cbr', 'cb7', 'cbt', 'zipx', 'crx', 'xpi'])('honors cancellation before reading %s', async extension => {
    const controller = new AbortController(); controller.abort();
    await expect(createArchiveResourceIndex(new Uint8Array(), context(`cancelled.${extension}`, controller.signal))).rejects.toMatchObject({ name: 'AbortError' });
  });
});
