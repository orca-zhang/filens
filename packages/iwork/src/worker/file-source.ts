import type { ZipBlobSource } from '@filens/core/zip';

export interface WorkerFileSource {
  size: number;
  port: MessagePort;
}

interface FileRead { id: number; start: number; end: number }
interface FileReadResult { id: number; bytes?: ArrayBuffer }
const unreadable = 'Could not read the requested bytes from the selected iWork file.';

export function serveWorkerFile(blob: Blob) {
  const channel = new MessageChannel();
  const readers = new Set<FileReader>();
  channel.port1.onmessage = ({ data }: MessageEvent<FileRead>) => {
    const { id, start, end } = data;
    const fail = () => channel.port1.postMessage({ id } satisfies FileReadResult);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > blob.size) {
      fail();
      return;
    }
    const reader = new FileReader();
    readers.add(reader);
    reader.onload = () => {
      readers.delete(reader);
      const bytes = reader.result;
      if (bytes instanceof ArrayBuffer && bytes.byteLength === end - start) {
        channel.port1.postMessage({ id, bytes } satisfies FileReadResult, [bytes]);
      } else fail();
    };
    reader.onerror = () => { readers.delete(reader); fail(); };
    try { reader.readAsArrayBuffer(blob.slice(start, end)); }
    catch { readers.delete(reader); fail(); }
  };
  return {
    source: { size: blob.size, port: channel.port2 } satisfies WorkerFileSource,
    close() {
      channel.port1.onmessage = null;
      channel.port1.close();
      channel.port2.close();
      for (const reader of readers) {
        reader.onload = reader.onerror = null;
        reader.abort();
      }
      readers.clear();
    }
  };
}

export function readWorkerFile({ size, port }: WorkerFileSource): ZipBlobSource {
  let requestId = 0;
  const pending = new Map<number, { resolve(bytes: ArrayBuffer): void; reject(error: Error): void }>();
  port.onmessage = ({ data }: MessageEvent<FileReadResult>) => {
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    if (data.bytes) request.resolve(data.bytes);
    else request.reject(new Error(unreadable));
  };
  const read = (start: number, end: number) => new Promise<ArrayBuffer>((resolve, reject) => {
    const id = ++requestId;
    pending.set(id, { resolve, reject });
    try { port.postMessage({ id, start, end } satisfies FileRead); }
    catch (error) { pending.delete(id); reject(error); }
  });
  return { size, arrayBuffer: () => read(0, size), slice: (start, end) => ({ arrayBuffer: () => read(start, end) }) };
}
