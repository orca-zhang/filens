import { Inflate, inflateSync } from 'fflate';
import { PreviewPasswordError } from '../preview/password';

export interface ZipEntry {
  name: string;
  directory: boolean;
  size?: number;
  modified?: number;
  encrypted?: boolean;
  bytes(password?: string, signal?: AbortSignal): Promise<Uint8Array>;
  text(): Promise<string>;
  chunks?(signal?: AbortSignal): AsyncIterable<Uint8Array> | undefined;
}

const decoder = new TextDecoder();
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
const zip64LocatorLength = 20;
const zip64RecordLength = 56;
const maxUint32 = 0xffffffff;
export const ZIP_TAIL_LENGTH = 22 + 65_535 + zip64LocatorLength;
const defaultEntryLimit = 128 * 1024 * 1024;
type ReadRange = (offset: number, length: number, signal?: AbortSignal) => Promise<Uint8Array>;
type ReadEntryRange = (offset: number, length: number) => Uint8Array | Promise<Uint8Array>;
type OpenEntry = (signal?: AbortSignal) => ReadEntryRange | Promise<ReadEntryRange>;
interface ZipDirectory { start: number; size: number; count: number }
interface Zip64Locator { record: number; locator: number }

export interface ZipArchiveOptions {
  password?: string;
  signal?: AbortSignal;
  maxEntryBytes?: number;
}

/** ZIP reader for document containers. Reports password_required without importing an encryption engine. */
export async function openUnencryptedZipArchive(bytes: Uint8Array, options: ZipArchiveOptions = {}): Promise<Map<string, ZipEntry>> {
  options.signal?.throwIfAborted();
  const indexed = indexZip(bytes, options);
  if (indexed) return indexed;
  // Retain the compatibility reader for ZIPs with layouts outside the direct index.
  const { default: JSZip } = await import('jszip');
  options.signal?.throwIfAborted();
  let zip: Awaited<ReturnType<typeof JSZip.loadAsync>>;
  try { zip = await JSZip.loadAsync(bytes); }
  catch (error) {
    if (error instanceof Error && /encrypted/i.test(error.message)) throw new PreviewPasswordError('password_required');
    throw error;
  }
  options.signal?.throwIfAborted();
  const cache = { remaining: 8 * 1024 * 1024 };
  return new Map(Object.values(zip.files).map(file => {
    const metadata = file as typeof file & { _data?: { uncompressedSize?: number } };
    const read = entryReader(() => {
      if ((metadata._data?.uncompressedSize ?? 0) > (options.maxEntryBytes ?? defaultEntryLimit)) {
        throw new Error('Archive entry exceeds the preview size limit.');
      }
      return file.async('uint8array');
    }, metadata._data?.uncompressedSize, cache, options.signal);
    return [file.name, {
      name: file.name, directory: file.dir, size: metadata._data?.uncompressedSize,
      modified: file.date?.getTime(), bytes: read, text: async () => decoder.decode(await read())
    }];
  }));
}

function indexZip(bytes: Uint8Array, options: ZipArchiveOptions): Map<string, ZipEntry> | undefined {
  const location = findDirectory(bytes.subarray(-ZIP_TAIL_LENGTH), bytes.length);
  if (!location) return undefined;
  const directory = 'record' in location
    ? readZip64Directory(bytes.subarray(location.record, location.record + zip64RecordLength), location)
    : location;
  if (!directory) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return indexDirectory(bytes.subarray(directory.start, directory.start + directory.size), directory.count, options, (offset, size) => {
    const start = entryDataStart(view, offset, offset, size, directory.start);
    if (start !== undefined) return () => (relative, length) => bytes.subarray(start + relative, start + relative + length);
    return undefined;
  }, { remaining: 8 * 1024 * 1024 });
}

/** Index a single-volume ZIP using only its tail and central directory. */
export async function openRangedZipArchive(length: number, read: ReadRange, options: ZipArchiveOptions):
  Promise<Map<string, ZipEntry> | undefined> {
  const tailStart = Math.max(0, length - ZIP_TAIL_LENGTH);
  const tail = await read(tailStart, length - tailStart, options.signal);
  const location = findDirectory(tail, length);
  if (!location) return undefined;
  const readBytes: ReadRange = async (offset, size, signal) => {
    signal?.throwIfAborted();
    if (!size) return new Uint8Array();
    if (offset >= tailStart) return tail.subarray(offset - tailStart, offset - tailStart + size);
    return read(offset, size, signal);
  };
  const directory = 'record' in location
    ? readZip64Directory(await readBytes(location.record, zip64RecordLength, options.signal), location)
    : location;
  if (!directory || directory.size > defaultEntryLimit) return undefined;
  const central = await readBytes(directory.start, directory.size, options.signal);
  return indexDirectory(central, directory.count, options, (offset, size) => {
    if (offset > directory.start - 30 - size) return undefined;
    return async signal => {
      const header = await readBytes(offset, 30, signal);
      const start = entryDataStart(new DataView(header.buffer, header.byteOffset, header.byteLength), 0, offset, size, directory.start);
      if (start === undefined) throw new Error('Invalid ZIP local file header.');
      return (relative, length) => readBytes(start + relative, length, signal);
    };
  });
}

function findDirectory(tail: Uint8Array, length: number): ZipDirectory | Zip64Locator | undefined {
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let end = tail.length - 22;
  for (; end >= 0; end--) {
    if (view.getUint32(end, true) === 0x06054b50 && end + 22 + view.getUint16(end + 20, true) === tail.length) break;
  }
  if (end < 0) return undefined;
  if ([4, 6].some(offset => {
    const disk = view.getUint16(end + offset, true);
    return disk !== 0 && disk !== 0xffff;
  })) throw new Error('Multi-volume ZIP requires all archive parts.');
  const count = view.getUint16(end + 10, true);
  const size = view.getUint32(end + 12, true);
  const start = view.getUint32(end + 16, true);
  if (!view.getUint16(end + 4, true) && !view.getUint16(end + 6, true) &&
      view.getUint16(end + 8, true) === count && count !== 0xffff && size !== maxUint32 &&
      start !== maxUint32 && start + size === length - tail.length + end) return { start, size, count };

  const at = end - zip64LocatorLength;
  if (at < 0 || view.getUint32(at, true) !== 0x07064b50) return undefined;
  if (view.getUint32(at + 4, true) !== 0 || view.getUint32(at + 16, true) !== 1) {
    throw new Error('Multi-volume ZIP requires all archive parts.');
  }
  const record = zipUint64(view, at + 8), locator = length - tail.length + at;
  if (record === undefined || record > locator - zip64RecordLength) return undefined;
  return { record, locator };
}

function readZip64Directory(bytes: Uint8Array, { record, locator }: Zip64Locator): ZipDirectory | undefined {
  if (bytes.length !== zip64RecordLength) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x06064b50 || zipUint64(view, 4) !== locator - record - 12) return undefined;
  if (view.getUint32(16, true) !== 0 || view.getUint32(20, true) !== 0) {
    throw new Error('Multi-volume ZIP requires all archive parts.');
  }
  const count = zipUint64(view, 32), size = zipUint64(view, 40), start = zipUint64(view, 48);
  if (count === undefined || size === undefined || start === undefined ||
      zipUint64(view, 24) !== count || start !== record - size) return undefined;
  return { start, size, count };
}

function zipUint64(view: DataView, offset: number): number | undefined {
  const value = Number(view.getBigUint64(offset, true));
  return Number.isSafeInteger(value) ? value : undefined;
}

function readZip64Entry(view: DataView, start: number, end: number, sizes: number[], disk: number): number | undefined {
  // ZIP64 stores only fields whose 32-bit value (16-bit for the disk) is saturated.
  for (let index = 0; index < sizes.length; index++) {
    if (sizes[index] !== maxUint32) continue;
    const value = start <= end - 8 ? zipUint64(view, start) : undefined;
    if (value === undefined) return undefined;
    sizes[index] = value;
    start += 8;
  }
  return disk !== 0xffff ? disk : start <= end - 4 ? view.getUint32(start, true) : undefined;
}

// Upper half of IBM code page 437, the ZIP default without a UTF-8 path.
const cp437 = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐'
  + '└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u00a0';

function decodeZipName(bytes: Uint8Array, flags: number): string {
  if (flags & 0x800 || !bytes.some(value => value >= 128)) return decoder.decode(bytes);
  // Some writers omit the flag even for valid UTF-8. Preserve those names.
  try { return utf8Decoder.decode(bytes); }
  catch { return Array.from(bytes, value => value < 128 ? String.fromCharCode(value) : cp437[value - 128]).join(''); }
}

function filenameCrc(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function entryDataStart(view: DataView, header: number, offset: number, size: number, directoryStart: number): number | undefined {
  if (offset > directoryStart - 30 || view.getUint32(header, true) !== 0x04034b50) return undefined;
  const start = offset + 30 + view.getUint16(header + 26, true) + view.getUint16(header + 28, true);
  return size <= directoryStart - start ? start : undefined;
}

function indexDirectory(bytes: Uint8Array, count: number, options: ZipArchiveOptions,
  compressedEntry: (offset: number, size: number) => OpenEntry | undefined,
  cache?: { remaining: number }): Map<string, ZipEntry> | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const maxEntryBytes = options.maxEntryBytes ?? defaultEntryLimit;
  const entries = new Map<string, ZipEntry>();
  let offset = 0;
  const end = bytes.length;
  if (count > Math.floor(end / 46)) return undefined;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) return undefined;
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const sizes = [view.getUint32(offset + 24, true), view.getUint32(offset + 20, true), view.getUint32(offset + 42, true)];
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > end) return undefined;
    if (flags & 1) throw new PreviewPasswordError('password_required');
    const rawName = bytes.subarray(offset + 46, offset + 46 + nameLength);
    let disk = view.getUint16(offset + 34, true);
    let needsZip64 = disk === 0xffff || sizes.includes(maxUint32);
    let unicodePath: string | undefined;
    const extrasEnd = offset + 46 + nameLength + extraLength;
    for (let extra = offset + 46 + nameLength; extra < extrasEnd;) {
      if (extra + 4 > extrasEnd) return undefined;
      const tag = view.getUint16(extra, true);
      const payload = extra + 4, fieldEnd = payload + view.getUint16(extra + 2, true);
      if (fieldEnd > extrasEnd) return undefined;
      if (tag === 1 && needsZip64) {
        const zip64Disk = readZip64Entry(view, payload, fieldEnd, sizes, disk);
        if (zip64Disk === undefined) return undefined;
        disk = zip64Disk;
        needsZip64 = false;
      } else if (tag === 0x7075 && !(flags & 0x800) && fieldEnd - payload > 5 &&
          bytes[payload] === 1 && view.getUint32(payload + 1, true) === filenameCrc(rawName)) {
        unicodePath = decoder.decode(bytes.subarray(payload + 5, fieldEnd));
      }
      extra = fieldEnd;
    }
    if (needsZip64 || disk !== 0) return undefined;
    const [originalSize, compressedSize, localOffset] = sizes;
    const decodedName = unicodePath ?? decodeZipName(rawName, flags);
    let name = decodedName;
    // Most document paths have no dot components. Preserve the original
    // spelling (including empty segments) without allocating a parts array.
    if (/(^|\/)\.\.?(\/|$)/.test(name)) {
      const parts: string[] = [];
      for (const part of name.split('/')) {
        if (part === '..') parts.pop();
        else if (part !== '.') parts.push(part);
      }
      name = parts.join('/');
    }
    const directory = decodedName.endsWith('/') || Boolean(view.getUint32(offset + 38, true) & 0x10);
    if (directory && !name.endsWith('/')) name += '/';
    const openEntry = compressedEntry(localOffset, compressedSize);
    if (!openEntry) return undefined;
    const date = view.getUint16(offset + 14, true);
    const time = view.getUint16(offset + 12, true);
    const modified = Date.UTC((date >> 9) + 1980, ((date >> 5) & 15) - 1, date & 31, time >> 11, (time >> 5) & 63, (time & 31) * 2);
    const openCompressed: OpenEntry = signal => {
      if (originalSize > maxEntryBytes || (!cache && compressedSize > defaultEntryLimit)) {
        throw new Error('Archive entry exceeds the preview size limit.');
      }
      // An unused attachment with another method must not force a second ZIP
      // index or prevent supported document parts from being read.
      if (method !== 0 && method !== 8) throw new Error(`Unsupported ZIP compression method: ${method}.`);
      return openEntry(signal);
    };
    const read = entryReader(async signal => {
      const readRange = await openCompressed(signal);
      signal?.throwIfAborted();
      const compressed = await readRange(0, compressedSize);
      signal?.throwIfAborted();
      const data = method === 0 ? compressed : await inflateEntry(compressed, originalSize, signal);
      if (data.length !== originalSize) throw new Error(`Invalid ZIP entry size: ${name}.`);
      return data;
    }, originalSize, cache, options.signal);
    const entry: ZipEntry = { name, directory, size: originalSize, modified, bytes: read, text: async () => decoder.decode(await read()) };
    if ((method === 0 || method === 8) && originalSize >= streamThreshold) {
      entry.chunks = (signal = options.signal) => streamEntry(openCompressed, compressedSize, originalSize, method, signal, options.signal);
    }
    entries.set(name, entry);
    offset = next;
  }
  return offset === end ? entries : undefined;
}


function entryReader(read: (signal?: AbortSignal) => Promise<Uint8Array>, size: number | undefined,
  cache: { remaining: number } | undefined, signal?: AbortSignal): ZipEntry['bytes'] {
  let loaded: Promise<Uint8Array> | undefined;
  return async (_password, readSignal = signal) => {
    signal?.throwIfAborted();
    readSignal?.throwIfAborted();
    const cacheable = cache && size !== undefined && size <= cache.remaining;
    const result = loaded ?? Promise.resolve().then(() => {
      // Shared cache fills follow archive lifetime; cancelling one reader must not fail its peers.
      const activeSignal = cacheable ? signal : readSignal;
      activeSignal?.throwIfAborted();
      return read(activeSignal);
    });
    // Keep repeat reads fast without retaining the entire expanded archive.
    if (!loaded && cache && cacheable) {
      cache.remaining -= size!;
      loaded = result;
      void result.catch(() => { if (loaded === result) { loaded = undefined; cache.remaining += size!; } });
    }
    const data = await result;
    signal?.throwIfAborted();
    readSignal?.throwIfAborted();
    return data;
  };
}

const streamThreshold = 256 * 1024;
const entryRangeSize = 1024 * 1024;
const inflatedChunkSize = 64 * 1024;

function nativeInflater(): DecompressionStream | undefined {
  if (typeof DecompressionStream === 'undefined') return undefined;
  try { return new DecompressionStream('deflate-raw'); } catch { return undefined; }
}

async function* streamEntry(open: OpenEntry, compressedSize: number, size: number, method: 0 | 8,
  signal?: AbortSignal, archiveSignal?: AbortSignal): AsyncGenerator<Uint8Array> {
  signal?.throwIfAborted();
  archiveSignal?.throwIfAborted();
  if (!compressedSize || (method === 0 && compressedSize !== size)) throw new Error('Invalid ZIP entry size.');
  const controller = new AbortController();
  const abort = (event: Event) => controller.abort((event.currentTarget as AbortSignal).reason);
  signal?.addEventListener('abort', abort, { once: true });
  archiveSignal?.addEventListener('abort', abort, { once: true });
  let length = 0;
  let data: Uint8Array = new Uint8Array();
  // Pull a new range only after the parser consumes the previous output.
  const inflate = method === 8 ? new Inflate(chunk => { data = chunk; }) : undefined;
  try {
    const read = await open(controller.signal);
    for (let offset = 0; offset < compressedSize; offset += entryRangeSize) {
      controller.signal.throwIfAborted();
      const count = Math.min(entryRangeSize, compressedSize - offset);
      const block = await read(offset, count);
      controller.signal.throwIfAborted();
      if (block.byteLength !== count) throw new Error('Invalid ZIP range response length.');
      if (!inflate) { yield block; continue; }

      // Bound the expansion from each synchronous DEFLATE push.
      for (let start = 0; start < count; start += 4096) {
        controller.signal.throwIfAborted();
        const end = Math.min(start + 4096, count);
        inflate.push(block.subarray(start, end), offset + end === compressedSize);
        length += data.byteLength;
        if (length > size) throw new Error('Invalid ZIP entry size.');
        for (let index = 0; index < data.byteLength; index += inflatedChunkSize) {
          controller.signal.throwIfAborted();
          yield data.subarray(index, index + inflatedChunkSize);
        }
      }
    }
    controller.signal.throwIfAborted();
    if (inflate && length !== size) throw new Error('Invalid ZIP entry size.');
  } finally {
    signal?.removeEventListener('abort', abort);
    archiveSignal?.removeEventListener('abort', abort);
  }
}

async function* inflateChunks(compressed: Uint8Array, size: number, stream: DecompressionStream,
  signal?: AbortSignal): AsyncGenerator<Uint8Array> {
  signal?.throwIfAborted();
  let offset = 0;
  const input = new ReadableStream({ pull(controller) {
    const end = Math.min(offset + 16 * 1024, compressed.length);
    if (end > offset) controller.enqueue(compressed.subarray(offset, end));
    offset = end;
    if (offset === compressed.length) controller.close();
  } });
  const reader = input.pipeThrough(stream).getReader();
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      length += value.byteLength;
      if (length > size) throw new Error('Invalid ZIP entry size.');
      yield value;
    }
    if (length !== size) throw new Error('Invalid ZIP entry size.');
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
  }
}

async function inflateEntry(compressed: Uint8Array, size: number, signal?: AbortSignal): Promise<Uint8Array> {
  // Small entries use fflate to avoid stream setup for every XML/text fragment.
  const stream = size >= streamThreshold ? nativeInflater() : undefined;
  if (stream) {
    const data = new Uint8Array(size);
    let length = 0;
    for await (const value of inflateChunks(compressed, size, stream, signal)) {
      data.set(value, length);
      length += value.byteLength;
    }
    return data;
  }
  // One spare byte makes undersized directory metadata detectable as well as
  // oversized metadata, while avoiding repeated buffer growth on small files.
  return inflateSync(compressed, { out: new Uint8Array(size + 1) });
}
