import { PreviewPasswordError } from '../preview/password';
import { openUnencryptedZipArchive, type ZipEntry, type ZipArchiveOptions } from './zip-reader';

export type { ZipEntry, ZipArchiveOptions } from './zip-reader';

/** Add lazy password support to the shared ordinary document ZIP reader. */
export async function openZipArchive(bytes: Uint8Array, options: ZipArchiveOptions = {}): Promise<Map<string, ZipEntry>> {
  try { return await openUnencryptedZipArchive(bytes, options); }
  catch (error) {
    if (!(error instanceof PreviewPasswordError) || error.code !== 'password_required') throw error;
    return openEncryptedZip(bytes, options);
  }
}

const decoder = new TextDecoder();

async function openEncryptedZip(bytes: Uint8Array, options: ZipArchiveOptions): Promise<Map<string, ZipEntry>> {
  // Load encryption support only for encrypted ZIPs. The native entry point has
  // a JS inflate fallback and needs no worker/WASM URLs in standalone builds.
  const { ZipReader, Uint8ArrayReader, ERR_INVALID_PASSWORD } = await import('@zip.js/zip.js/lib/zip-core-native.js');
  const reader = new ZipReader(new Uint8ArrayReader(bytes), { useWebWorkers: false });
  try {
    const entries = new Map<string, ZipEntry>();
    for (const entry of await reader.getEntries()) {
      let loaded: Uint8Array | undefined;
      const read = async (password = options.password, signal = options.signal): Promise<Uint8Array> => {
        signal?.throwIfAborted();
        if (loaded) return loaded;
        if (entry.directory) return new Uint8Array();
        if (entry.encrypted && !password) throw new PreviewPasswordError('password_required');
        const limit = options.maxEntryBytes ?? 128 * 1024 * 1024;
        if (entry.uncompressedSize > limit) throw new Error('Archive entry exceeds the preview size limit.');
        try {
          let size = 0;
          const chunks: Uint8Array[] = [];
          await entry.getData(new WritableStream<Uint8Array>({ write(chunk) {
            size += chunk.byteLength;
            if (size > limit) throw new Error('Archive entry exceeds the preview size limit.');
            chunks.push(chunk);
          } }), {
            password, signal, checkSignature: true
          });
          const data = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
          // Keep successful small reads, never a rejected password attempt.
          if (data.byteLength <= 8 * 1024 * 1024) loaded = data;
          return data;
        } catch (error) {
          if (error instanceof Error && error.message === ERR_INVALID_PASSWORD) throw new PreviewPasswordError('password_invalid');
          throw error;
        }
      };
      entries.set(entry.filename, {
        name: entry.filename, directory: entry.directory, encrypted: entry.encrypted,
        size: entry.uncompressedSize, modified: entry.lastModDate?.getTime(),
        bytes: read, text: async () => decoder.decode(await read())
      });
    }
    return entries;
  } finally { await reader.close(); }
}
