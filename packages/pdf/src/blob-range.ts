import type { PDFDataRangeTransport } from 'pdfjs-dist';

export const PDF_RANGE_CHUNK_BYTES = 64 * 1024;

export function createPdfBlobRange(RangeTransport: typeof PDFDataRangeTransport, source: Blob,
  signal: AbortSignal, onError: (error: Error) => void): PDFDataRangeTransport {
  const transport = new RangeTransport(source.size, null, true);
  const readers = new Set<FileReader>();
  let stopped = false;
  const forget = (reader: FileReader) => {
    reader.onload = reader.onerror = null;
    readers.delete(reader);
  };
  const abort = () => {
    stopped = true;
    signal.removeEventListener('abort', abort);
    for (const reader of readers) {
      forget(reader);
      reader.abort();
    }
  };
  const fail = (error: unknown) => {
    if (stopped) return;
    abort();
    onError(error instanceof Error ? error : new Error(error instanceof DOMException ? error.message : String(error)));
  };

  transport.abort = abort;
  transport.requestDataRange = (begin, end) => {
    if (stopped) return;
    if (!Number.isSafeInteger(begin) || !Number.isSafeInteger(end) || begin < 0 || end <= begin || end > source.size) {
      fail(new Error('Invalid byte range for the selected PDF.'));
      return;
    }
    const reader = new FileReader();
    readers.add(reader);
    reader.onload = () => {
      forget(reader);
      if (stopped) return;
      try {
        if (!(reader.result instanceof ArrayBuffer) || reader.result.byteLength !== end - begin) {
          throw new Error('Could not read the requested bytes from the selected PDF.');
        }
        transport.onDataRange(begin, new Uint8Array(reader.result));
      } catch (error) { fail(error); }
    };
    reader.onerror = () => {
      forget(reader);
      fail(reader.error ?? new Error('Could not read the selected PDF.'));
    };
    try { reader.readAsArrayBuffer(source.slice(begin, end)); }
    catch (error) { forget(reader); fail(error); }
  };

  if (signal.aborted) abort();
  else signal.addEventListener('abort', abort, { once: true });
  return transport;
}
