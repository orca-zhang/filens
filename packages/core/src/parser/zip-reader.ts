import { inflateSync } from 'fflate';
import JSZip from 'jszip';
import { PreviewPasswordError } from '../preview/password';

export interface ZipEntry {
  name: string;
  directory: boolean;
  size?: number;
  modified?: number;
  encrypted?: boolean;
  bytes(password?: string, signal?: AbortSignal): Promise<Uint8Array>;
  text(): Promise<string>;
}

const decoder = new TextDecoder();

export interface ZipArchiveOptions {
  password?: string;
  signal?: AbortSignal;
  maxEntryBytes?: number;
}

/** ZIP reader for document containers. Retains ZIP64/Unicode compatibility,
 * and reports password_required without importing an encryption engine. */
export async function openUnencryptedZipArchive(bytes: Uint8Array, options: ZipArchiveOptions = {}): Promise<Map<string, ZipEntry>> {
  const indexed = indexZip(bytes, options.maxEntryBytes);
  if (indexed) return indexed;
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(bytes); }
  catch (error) {
    if (error instanceof Error && /encrypted/i.test(error.message)) throw new PreviewPasswordError('password_required');
    throw error;
  }
  const cache = { remaining: 8 * 1024 * 1024 };
  return new Map(Object.values(zip.files).map(file => {
    const metadata = file as typeof file & { _data?: { uncompressedSize?: number } };
    const read = entryReader(() => {
      if ((metadata._data?.uncompressedSize ?? 0) > (options.maxEntryBytes ?? 128 * 1024 * 1024)) {
        throw new Error('Archive entry exceeds the preview size limit.');
      }
      return file.async('uint8array');
    }, metadata._data?.uncompressedSize, cache);
    return [file.name, {
      name: file.name, directory: file.dir, size: metadata._data?.uncompressedSize,
      modified: file.date?.getTime(), bytes: read, text: async () => decoder.decode(await read())
    }];
  }));
}

function indexZip(bytes: Uint8Array, maxEntryBytes = 128 * 1024 * 1024): Map<string, ZipEntry> | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = bytes.length;
  let end = length - 22;
  const stop = Math.max(0, end - 65_535);
  for (; end >= stop; end--) {
    if (view.getUint32(end, true) === 0x06054b50 && end + 22 + view.getUint16(end + 20, true) === length) break;
  }
  if (end < stop) return undefined;
  if ([4, 6].some(offset => {
    const disk = view.getUint16(end + offset, true);
    return disk !== 0 && disk !== 0xffff;
  })) throw new Error('Multi-volume ZIP requires all archive parts.');
  const count = view.getUint16(end + 10, true);
  const size = view.getUint32(end + 12, true);
  let offset = view.getUint32(end + 16, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) ||
      view.getUint16(end + 8, true) !== count || count === 0xffff || size === 0xffffffff ||
      offset === 0xffffffff || offset + size !== end) return undefined;
  const entries = new Map<string, ZipEntry>();
  const cache = { remaining: 8 * 1024 * 1024 };
  const directoryStart = offset;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) return undefined;
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const originalSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > end) return undefined;
    if (flags & 1) throw new PreviewPasswordError('password_required');
    if ((method !== 0 && method !== 8) ||
        compressedSize === 0xffffffff || originalSize === 0xffffffff || localOffset === 0xffffffff ||
        view.getUint16(offset + 34, true)) return undefined;
    const rawName = bytes.subarray(offset + 46, offset + 46 + nameLength);
    if (!(flags & 0x800) && rawName.some(value => value >= 128)) return undefined;
    // JSZip understands Info-ZIP Unicode paths and ZIP64 extra fields.
    for (let extra = offset + 46 + nameLength; extra < offset + 46 + nameLength + extraLength;) {
      if (extra + 4 > next) return undefined;
      const tag = view.getUint16(extra, true);
      const extraSize = view.getUint16(extra + 2, true);
      if (tag === 0x7075 || tag === 1) return undefined;
      extra += 4 + extraSize;
      if (extra > offset + 46 + nameLength + extraLength) return undefined;
    }
    const parts: string[] = [];
    const decodedName = decoder.decode(rawName);
    for (const part of decodedName.split('/')) {
      if (part === '..') parts.pop();
      else if (part !== '.') parts.push(part);
    }
    let name = parts.join('/');
    const directory = decodedName.endsWith('/') || Boolean(view.getUint32(offset + 38, true) & 0x10);
    if (directory && !name.endsWith('/')) name += '/';
    if (localOffset + 30 > directoryStart || view.getUint32(localOffset, true) !== 0x04034b50) return undefined;
    const dataStart = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    if (dataStart + compressedSize > directoryStart) return undefined;
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    const date = view.getUint16(offset + 14, true);
    const time = view.getUint16(offset + 12, true);
    const modified = Date.UTC((date >> 9) + 1980, ((date >> 5) & 15) - 1, date & 31, time >> 11, (time >> 5) & 63, (time & 31) * 2);
    const read = entryReader(async () => {
      if (originalSize > maxEntryBytes) throw new Error('Archive entry exceeds the preview size limit.');
      const data = method === 0 ? compressed : await inflateEntry(compressed, originalSize);
      if (data.length !== originalSize) throw new Error(`Invalid ZIP entry size: ${name}.`);
      return data;
    }, originalSize, cache);
    entries.set(name, { name, directory, size: originalSize, modified, bytes: read, text: async () => decoder.decode(await read()) });
    offset = next;
  }
  return offset === end ? entries : undefined;
}


function entryReader(read: () => Promise<Uint8Array>, size: number | undefined, cache: { remaining: number }): () => Promise<Uint8Array> {
  let loaded: Promise<Uint8Array> | undefined;
  return () => {
    if (loaded) return loaded;
    const result = Promise.resolve().then(read);
    // Keep repeat reads fast without retaining the entire expanded archive.
    if (size !== undefined && size <= cache.remaining) {
      cache.remaining -= size;
      loaded = result;
      void result.catch(() => { if (loaded === result) { loaded = undefined; cache.remaining += size; } });
    }
    return result;
  };
}

async function inflateEntry(compressed: Uint8Array, size: number): Promise<Uint8Array> {
  // Native inflate avoids blocking JavaScript on large images and documents.
  // Small entries use fflate to avoid stream setup for every XML/text fragment.
  if (size >= 256 * 1024 && typeof DecompressionStream !== 'undefined' && typeof Response !== 'undefined') {
    let stream: DecompressionStream | undefined;
    try { stream = new DecompressionStream('deflate-raw'); } catch { /* Older browsers use fflate. */ }
    if (stream) {
      const input = new Response(compressed as Uint8Array<ArrayBuffer>).body!;
      const reader = input.pipeThrough(stream).getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > size) throw new Error('Invalid ZIP entry size.');
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      const data = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
      return data;
    }
  }
  // One spare byte makes undersized directory metadata detectable as well as
  // oversized metadata, while avoiding repeated buffer growth on small files.
  return inflateSync(compressed, { out: new Uint8Array(size + 1) });
}
