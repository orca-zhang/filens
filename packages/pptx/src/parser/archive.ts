import { openZipArchive, type ZipEntry } from '@filens/core/zip';
import { loadSourceBytes, throwIfAborted, type LoadSourceOptions, type PptxSource } from '@filens/core/presentation-support';

export class PptxArchiveEntry {
  private loaded?: Promise<Uint8Array>;
  constructor(private readonly data: Uint8Array | (() => Promise<Uint8Array>), private readonly signal?: AbortSignal) {}

  async(type: 'text'): Promise<string>;
  async(type: 'uint8array'): Promise<Uint8Array>;
  async async(type: 'text' | 'uint8array'): Promise<string | Uint8Array> {
    throwIfAborted(this.signal);
    this.loaded ??= typeof this.data === 'function' ? this.data() : Promise.resolve(this.data);
    const data = await this.loaded;
    throwIfAborted(this.signal);
    return type === 'text' ? new TextDecoder().decode(data) : data;
  }
}

export interface PptxArchive {
  file(name: string): PptxArchiveEntry | null;
}

export interface PptxArchiveOptions extends LoadSourceOptions {
  zipEntries?: ReadonlyMap<string, ZipEntry>;
}

export async function loadPptxArchive(source: PptxSource, { signal, zipEntries }: PptxArchiveOptions = {}): Promise<PptxArchive> {
  throwIfAborted(signal);
  // Index once and inflate only parts requested by the parser. Most decks
  // carry unused layouts, thumbnails and other non-preview attachments.
  const indexed = zipEntries ?? await openZipArchive(
    typeof source === 'string' || (typeof Blob !== 'undefined' && source instanceof Blob)
      ? source : await loadSourceBytes(source, { signal }), { signal });
  throwIfAborted(signal);
  const files = new Map<string, PptxArchiveEntry>();
  return { file(name) {
    let file = files.get(name);
    if (!file) {
      const entry = indexed.get(name);
      if (!entry) return null;
      file = new PptxArchiveEntry(() => entry.bytes(undefined, signal), signal);
      files.set(name, file);
    }
    return file;
  } };
}
