// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { createArchivePreviewDriver, createArchivePreviewRoutes, createArchiveResourceIndex } from '../src';
import { createPreviewContainerContext, PREVIEW_CONTAINER_LIMITS } from '@filens/core';
import { runSevenZip, type SevenZipRequest } from '../src/sevenzip/runtime';
import engine from '../vendor/7zip/7zz.js';

// Replace transport only: these tests decode with the production WASM binary.
vi.mock('../src/sevenzip/client', async () => {
  const { runSevenZip } = await import('../src/sevenzip/runtime');
  const { default: engine } = await import('../vendor/7zip/7zz.js');
  return { runArchiveWorker: async (request: SevenZipRequest, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    const result = await runSevenZip({ ...request, maxEntries: 20_000, maxEntryBytes: 128 << 20 }, engine);
    signal?.throwIfAborted();
    return result;
  } };
});

const sample = (name: string) => readFile(new URL(`../../../apps/demo/public/samples/archives/${name}`, import.meta.url));
const context = (name: string, signal?: AbortSignal) => ({ descriptor: { source: new Uint8Array(), name, extension: name.split('.').pop() }, signal });
const formats = ['bz2', 'xz', 'lzma', 'zst', 'zstd', 'tbz', 'tbz2', 'txz', 'tlz', 'ar', 'deb', 'cpio', 'cab', 'iso'];
const codecs = [['bz2', 'bzip2'], ['xz', 'xz'], ['lzma', 'lzma'], ['zst', 'zstd'], ['zstd', 'zstd']] as const;
const originalText = '# Filens archive study\n\nOriginal color and shape artwork, packaged for local read-only preview.\n';

describe('compressed streams and WASM archive containers', () => {
  it.each(formats)('registers a usable %s route', format => {
    expect(createArchivePreviewRoutes().find(route => route.extensions.includes(format))).toMatchObject({ family: 'archive', driverId: 'archive' });
    expect(createArchivePreviewDriver().supports(format)).toBe(true);
  });

  it.each(codecs)('decodes a standalone %s stream to its original file', async extension => {
    const name = `archive-readme.md.${extension}`;
    const index = await createArchiveResourceIndex(await sample(name), context(name));
    expect(index.files.map(file => file.name)).toEqual(['archive-readme.md']);
    expect(await index.read('archive-readme.md')!.readAsText()).toBe(originalText);
  });

  it.each(['tbz', 'tbz2', 'txz', 'tlz', 'ar', 'cpio', 'cab', 'iso'])('reads actual %s directory entries and original image bytes', async extension => {
    const name = `color-study.${extension}`;
    const index = await createArchiveResourceIndex(await sample(name), context(name));
    expect(index.files.map(file => file.name).sort()).toEqual(['README.md', 'page-10.svg', 'page-2.jpeg']);
    expect(await index.read('README.md')!.readAsText()).toBe(originalText);
    const expected = await readFile(new URL('../../../apps/demo/public/samples/graphics/color-archive.jpeg', import.meta.url));
    expect(Buffer.from(await index.read('page-2.jpeg')!.readAsArrayBuffer())).toEqual(expected);
  });

  it.each([['tbz2', 'bz2'], ['txz', 'xz'], ['tlz', 'lzma']])('recognizes .tar.%s compound filenames', async (alias, extension) => {
    const name = `color-study.tar.${extension}`;
    const index = await createArchiveResourceIndex(await sample(`color-study.${alias}`), context(name));
    expect(await index.read('README.md')!.readAsText()).toBe(originalText);
  });

  it('reads a real Debian ar package and nested XZ/Zstandard TAR members', async () => {
    const name = 'color-study.deb';
    const index = await createArchiveResourceIndex(await sample(name), context(name));
    expect(index.files.map(file => file.name)).toEqual(['control.tar.xz', 'data.tar.zst', 'debian-binary']);
    expect(await index.read('debian-binary')!.readAsText()).toBe('2.0\n');
    expect(index.read('debian-binary')!.contentType).toBe('text/plain');
    for (const [member, filename, expected] of [
      ['control.tar.xz', 'control', 'Package: filens-color-study'],
      ['data.tar.zst', 'README.md', originalText]
    ]) {
      const child = await createArchiveResourceIndex(await index.read(member)!.readAsArrayBuffer(), context(member));
      expect(await child.read(filename)!.readAsText()).toContain(expected);
      if (filename === 'control') expect(child.read(filename)!.contentType).toBe('text/plain');
    }
  });

  it.each(formats)('rejects unrelated bytes labeled %s', async extension => {
    await expect(createArchiveResourceIndex(new Uint8Array([1, 2, 3]), context(`broken.${extension}`))).rejects.toThrow();
  });

  it.each(codecs)('bounds %s streams even when their size is absent', async (extension, format) => {
    await expect(runSevenZip({ bytes: await sample(`archive-readme.md.${extension}`), format,
      stream: true, maxEntries: 20_000, maxEntryBytes: 8 }, engine)).rejects.toThrow('size limit');
  });

  it.each(codecs)('rejects truncated %s streams', async (extension, format) => {
    const bytes = await sample(`archive-readme.md.${extension}`);
    await expect(runSevenZip({ bytes: bytes.subarray(0, bytes.length - 8), format,
      stream: true, maxEntries: 20_000, maxEntryBytes: 128 << 20 }, engine)).rejects.toThrow();
  });

  it('charges compressed stream output to the shared nested expansion budget', async () => {
    const name = 'archive-readme.md.xz';
    const containerContext = createPreviewContainerContext();
    const initial = PREVIEW_CONTAINER_LIMITS.maxExpandedBytes - new TextEncoder().encode(originalText).length + 1;
    containerContext.budget.expandedBytes = initial;
    await expect(createArchiveResourceIndex(await sample(name), context(name), { containerContext })).rejects.toThrow('size limit');
    expect(containerContext.budget.expandedBytes).toBe(initial);
  });

  it.each([['bz2', 'bzip2'], ['xz', 'xz'], ['zst', 'zstd']] as const)('reads concatenated %s frames', async (extension, format) => {
    const bytes = await sample(`archive-readme.md.${extension}`);
    const result = await runSevenZip({ bytes: Buffer.concat([bytes, bytes]), format,
      stream: true, maxEntries: 20_000, maxEntryBytes: 128 << 20 }, engine);
    expect(new TextDecoder().decode(result.bytes)).toBe(originalText.repeat(2));
  });

  it.each(formats)('honors cancellation before reading %s', async extension => {
    const controller = new AbortController(); controller.abort();
    await expect(createArchiveResourceIndex(new Uint8Array(), context(`cancelled.${extension}`, controller.signal))).rejects.toMatchObject({ name: 'AbortError' });
  });
});
