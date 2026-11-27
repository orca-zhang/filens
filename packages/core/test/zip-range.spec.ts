import { Blob as NodeBlob } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from '@zip.js/zip.js/lib/zip-core-native.js';
import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openZipArchive } from '../src/parser/zip';
import { openRangedZipArchive } from '../src/parser/zip-reader';

const url = 'https://files.example.test/large.cbz';

async function fixture() {
  const zip = new JSZip();
  zip.file('first.txt', 'First selected file.');
  zip.file('middle.bin', new Uint8Array(512 * 1024));
  zip.file('last.txt', 'Last selected file.');
  zip.file('padding.bin', new Uint8Array(256 * 1024));
  return zip.generateAsync({ type: 'uint8array', compression: 'STORE', comment: 'c'.repeat(65_535) });
}

async function zip64Fixture(offset = 0, commentLength = 0) {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { zip64: true, offset, useWebWorkers: false });
  await writer.add('first.txt', new Uint8ArrayReader(new TextEncoder().encode('ZIP64 page.')), { level: 0 });
  await writer.add('padding.bin', new Uint8ArrayReader(new Uint8Array(768 * 1024)), { level: 0 });
  return writer.close(new Uint8Array(commentLength));
}

function mockSource(bytes: Uint8Array, mode: 'range' | 'full' | 'hidden-headers' = 'range') {
  const requests: { range: string | null; size: number }[] = [];
  let etag = '"original"', pause = false, cancelled = false, truncated = false;
  const fetch = vi.fn(async (_source: string, init?: RequestInit) => {
    const range = new Headers(init?.headers).get('Range');
    if (mode === 'full' || !range) {
      requests.push({ range, size: bytes.length });
      return new Response(bytes.slice().buffer as ArrayBuffer);
    }
    const match = /^bytes=(\d+)-(\d+)$/.exec(range)!;
    const begin = Number(match[1]), end = Number(match[2]) + 1;
    requests.push({ range, size: end - begin });
    if (pause && begin === 0 && end === 30) {
      return new Promise<Response>((_, reject) => init!.signal!.addEventListener('abort', () => {
        cancelled = true;
        reject(init!.signal!.reason);
      }, { once: true }));
    }
    const headers = new Headers({ ETag: etag });
    if (mode !== 'hidden-headers') headers.set('Content-Range', `bytes ${begin}-${end - 1}/${bytes.length}`);
    return new Response(bytes.slice(begin, truncated ? end - 1 : end).buffer as ArrayBuffer, { status: 206, headers });
  });
  vi.stubGlobal('fetch', fetch);
  return { requests, changed: () => { etag = '"changed"'; }, truncate: () => { truncated = true; },
    holdFirst: () => { pause = true; }, cancelled: () => cancelled };
}

afterEach(() => vi.unstubAllGlobals());

describe('ranged ZIP source', () => {
  it('reads a separate central directory and fetches only selected entries', async () => {
    const bytes = await fixture(), source = mockSource(bytes);
    const archive = await openZipArchive(url);
    expect([...archive.keys()]).toEqual(['first.txt', 'middle.bin', 'last.txt', 'padding.bin']);
    expect(source.requests).toHaveLength(3);
    await expect(archive.get('first.txt')!.text()).resolves.toBe('First selected file.');
    await expect(archive.get('last.txt')!.text()).resolves.toBe('Last selected file.');
    expect(source.requests).toHaveLength(7);
    expect(source.requests.reduce((sum, request) => sum + request.size, 0)).toBeLessThan(bytes.length / 8);
    expect(source.requests.every(request => request.range)).toBe(true);
  });

  it('streams a large DEFLATE entry from a ranged ZIP', async () => {
    const content = 'Catalog entry 星表\n'.repeat(30_000);
    const zip = new JSZip().file('catalog.txt', content, { compression: 'DEFLATE' });
    zip.file('unused.bin', new Uint8Array(512 * 1024), { compression: 'STORE' });
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const source = mockSource(bytes);
    const entry = (await openZipArchive(url)).get('catalog.txt')!;
    const chunks: Uint8Array[] = [];
    for await (const chunk of entry.chunks!()!) chunks.push(chunk);
    expect(chunks.length).toBeGreaterThan(1);
    expect(Buffer.concat(chunks).toString()).toBe(content);
    expect(source.requests.map(request => request.range)).toContain('bytes=0-29');
    expect(source.requests.every(request => request.range)).toBe(true);
    expect(source.requests.reduce((sum, request) => sum + request.size, 0)).toBeLessThan(bytes.length / 4);
  });

  it.each(['STORE', 'DEFLATE'] as const)('reads %s entry payloads in bounded ranges', async compression => {
    const content = randomBytes(2 * 1024 * 1024 + 8192);
    const zip = new JSZip().file('large.bin', content, { compression });
    zip.file('unused.bin', new Uint8Array(256 * 1024), { compression: 'STORE' });
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const source = mockSource(bytes);
    const entry = (await openZipArchive(url)).get('large.bin')!;
    const start = source.requests.length;
    const stream = entry.chunks!()![Symbol.asyncIterator]();
    const first = await stream.next();
    expect(first.done).toBe(false);
    expect(first.value.byteLength).toBeLessThan(content.length);
    // Once the first output arrives, the rest of the entry is still unread.
    expect(source.requests.slice(start).reduce((sum, request) => sum + request.size, 0)).toBeLessThan(content.length);
    const chunks = [first.value];
    for (let next = await stream.next(); !next.done; next = await stream.next()) chunks.push(next.value);
    expect(Buffer.compare(Buffer.concat(chunks), content)).toBe(0);
    const ranges = source.requests.slice(start);
    expect(ranges[0].range).toBe('bytes=0-29');
    expect(ranges.slice(1)).toHaveLength(3);
    expect(ranges.slice(1).every(request => request.size <= 1024 * 1024)).toBe(true);

    const nextRead = source.requests.length;
    const preview = entry.chunks!()![Symbol.asyncIterator]();
    await preview.next();
    await preview.return!();
    expect(source.requests.slice(nextRead).map(request => request.size)).toEqual([30, 1024 * 1024]);
  });

  it.each(['full', 'hidden-headers'] as const)('uses a whole response when the server has %s support', async mode => {
    const bytes = await fixture(), source = mockSource(bytes, mode);
    const archive = await openZipArchive(url);
    await expect(archive.get('first.txt')!.text()).resolves.toBe('First selected file.');
    expect(source.requests.map(request => request.range)).toEqual(mode === 'full' ? ['bytes=0-0'] : ['bytes=0-0', null]);
  });

  it('rejects a changed version after indexing the central directory', async () => {
    const source = mockSource(await fixture());
    const archive = await openZipArchive(url);
    source.changed();
    await expect(archive.get('first.txt')!.text()).rejects.toThrow('ZIP range response does not match the archive');
  });

  it('rejects a short response body even when the response advertises the requested range', async () => {
    const source = mockSource(await fixture());
    const archive = await openZipArchive(url);
    source.truncate();
    await expect(archive.get('first.txt')!.text()).rejects.toThrow('Invalid ZIP range response length');
  });

  it.each(['目录/文.txt', 'café.txt', 'grüße.txt'])('reads the legacy ZIP path %s without a full GET', async name => {
    const unicodeName = '目录/文.txt';
    const zip = new JSZip().file(unicodeName, 'Readable path', { createFolders: false });
    const rawName = name === 'grüße.txt' ? Buffer.from(name) : Buffer.from('caf\x82.txt', 'latin1');
    const bytes = await zip.generateAsync({ type: 'uint8array', encodeFileName: value =>
      value === unicodeName ? rawName : Buffer.from(value) });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const central = view.getUint32(bytes.length - 6, true);
    expect(view.getUint16(central + 8, true) & 0x800).toBe(0);
    const unicodeExtra = central + 46 + rawName.length;
    expect(view.getUint16(unicodeExtra, true)).toBe(0x7075);
    if (name !== unicodeName) bytes[unicodeExtra + 5] ^= 1; // Invalidate the stored filename CRC.
    const source = mockSource(bytes);
    const archive = await openZipArchive(url);
    await expect(archive.get(name)!.text()).resolves.toBe('Readable path');
    expect(source.requests.every(request => request.range)).toBe(true);
  });

  it('reads a ZIP64 end record outside the tail when the ZIP comment is full', async () => {
    const bytes = await zip64Fixture(0, 65_535), source = mockSource(bytes);
    const record = bytes.length - 65_535 - 22 - 20 - 56;
    const archive = await openZipArchive(url);
    await expect(archive.get('first.txt')!.text()).resolves.toBe('ZIP64 page.');
    expect(source.requests.map(request => request.range)).toContain(`bytes=${record}-${record + 55}`);
    expect(source.requests.every(request => request.range)).toBe(true);
    const buffered = await openZipArchive(bytes);
    await expect(buffered.get('first.txt')!.text()).resolves.toBe('ZIP64 page.');
  });

  it('reads entries at ZIP64 offsets past 4 GiB', async () => {
    const offset = 2 ** 32 + 4096;
    const bytes = await zip64Fixture(offset);
    const read = vi.fn(async (start: number, size: number) => {
      expect(start).toBeGreaterThanOrEqual(offset);
      expect(start + size).toBeLessThanOrEqual(offset + bytes.length);
      return bytes.subarray(start - offset, start - offset + size);
    });
    const archive = await openRangedZipArchive(offset + bytes.length, read, {});
    await expect(archive?.get('first.txt')?.text()).resolves.toBe('ZIP64 page.');
    expect(read).toHaveBeenCalledWith(offset, 30, undefined);
    expect(read.mock.calls).toHaveLength(3);
  });

  it.each(['archive', 'entry'] as const)('cancels a pending fetch through the %s signal', async owner => {
    const source = mockSource(await fixture());
    const book = new AbortController(), entry = new AbortController();
    const archive = await openZipArchive(url, { signal: book.signal });
    source.holdFirst();
    const pending = expect(archive.get('first.txt')!.bytes(undefined, entry.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(source.requests.at(-1)?.range).toBe('bytes=0-29'));
    if (owner === 'archive') book.abort();
    else {
      entry.abort();
      await expect(archive.get('last.txt')!.text()).resolves.toBe('Last selected file.');
    }
    await pending;
    expect(source.cancelled()).toBe(true);
  });

  it.each([
    ['ZIP', fixture, 'First selected file.'], ['ZIP64', zip64Fixture, 'ZIP64 page.'],
  ] as const)('reads a large local %s Blob by slices', async (_, create, expectedText) => {
    const bytes = await create();
    const blob = new NodeBlob([bytes as Uint8Array<ArrayBuffer>]) as unknown as Blob;
    const full = vi.spyOn(blob, 'arrayBuffer'), slice = vi.spyOn(blob, 'slice');
    const archive = await openZipArchive(blob);
    await expect(archive.get('first.txt')!.text()).resolves.toBe(expectedText);
    expect(full).not.toHaveBeenCalled();
    expect(slice.mock.calls.reduce((sum, [start = 0, end = 0]) => sum + end - start, 0)).toBeLessThan(blob.size / 8);
  });
});
