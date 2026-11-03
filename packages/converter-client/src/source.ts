import type { PreviewSource } from '@filens/core';

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function abortError(): Error {
  return Object.assign(new Error('The conversion was aborted.'), { name: 'AbortError' });
}

export function waitForConversion<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortError());
    // Observe late failures even if the operation was cancelled synchronously.
    work.then(
      value => { signal.removeEventListener('abort', abort); resolve(value); },
      error => { signal.removeEventListener('abort', abort); reject(error); }
    );
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

export function retryableLoader<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    if (!pending) {
      const attempt = Promise.resolve().then(load);
      pending = attempt;
      void attempt.catch(() => { if (pending === attempt) pending = undefined; });
    }
    return pending;
  };
}

export function isConversionSourceUrl(source: string): boolean {
  return /^(?:https?:|blob:|\/|\.{1,2}\/)/i.test(source);
}

export function isDataUrl(source: string): boolean {
  return source.trimStart().toLowerCase().startsWith('data:');
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < bytes.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function readDataUrl(source: string): { bytes: Uint8Array; contentType?: string } {
  const url = source.trimStart(), comma = url.indexOf(',');
  if (comma < 0) throw new Error('Conversion data URL is missing its payload separator.');
  const meta = url.slice(0, comma), payload = url.slice(comma + 1);
  const contentType = meta.match(/^data:([^;,]+)/i)?.[1];
  if (/;base64$/i.test(meta)) return { bytes: base64ToBytes(payload), contentType };
  // Decode percent escapes as bytes: binary payloads need not be valid UTF-8.
  const bytes = new TextEncoder().encode(payload);
  let written = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 37) {
      const high = hexDigit(bytes[i + 1]), low = hexDigit(bytes[i + 2]);
      if (high >= 0 && low >= 0) {
        bytes[written++] = (high << 4) | low;
        i += 2;
        continue;
      }
    }
    bytes[written++] = bytes[i];
  }
  return { bytes: bytes.subarray(0, written), contentType };
}

function hexDigit(value: number): number {
  if (value >= 48 && value <= 57) return value - 48;
  const lower = value | 32;
  return lower >= 97 && lower <= 102 ? lower - 87 : -1;
}

export async function sourceToBytes(source: PreviewSource, fetchImpl = globalThis.fetch, signal?: AbortSignal, maxBytes = Infinity): Promise<Uint8Array> {
  const bounded = (size: number) => {
    if (size > maxBytes) throw new Error('Conversion source exceeds the preview byte limit.');
  };
  if (isBlobLikeSource(source)) {
    bounded(source.size);
    const bytes = new Uint8Array(await waitForConversion(source.arrayBuffer(), signal));
    bounded(bytes.length);
    return bytes;
  }
  if (source instanceof ArrayBuffer) {
    bounded(source.byteLength);
    return new Uint8Array(source);
  }
  if (ArrayBuffer.isView(source)) {
    bounded(source.byteLength);
    return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  }
  if (typeof source === 'string') {
    if (isDataUrl(source)) {
      // A data URL can expand to at most three source characters per byte.
      bounded(Math.max(0, source.length - source.indexOf(',') - 1) / 3);
      const bytes = readDataUrl(source).bytes;
      bounded(bytes.length);
      return bytes;
    }
    if (isConversionSourceUrl(source)) {
      if (!fetchImpl) throw new Error('A fetch implementation is required to load a conversion source URL.');
      const response = await waitForConversion(fetchImpl(source, { signal }), signal);
      throwIfAborted(signal);
      if (!response.ok) {
        throw new Error(`Failed to fetch conversion source: ${response.status} ${response.statusText}`.trim());
      }
      try {
        bounded(Number(response.headers.get('content-length')));
        if (!Number.isFinite(maxBytes) || !response.body) {
          const bytes = new Uint8Array(await waitForConversion(response.arrayBuffer(), signal));
          bounded(bytes.length);
          return bytes;
        }
        const reader = response.body.getReader();
        try {
          const chunks: Uint8Array[] = [];
          let length = 0;
          while (true) {
            const { value, done } = await waitForConversion(reader.read(), signal);
            if (done) break;
            length += value.length;
            bounded(length);
            chunks.push(value);
          }
          const bytes = new Uint8Array(length);
          let at = 0;
          for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
          return bytes;
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
      } catch (error) {
        await response.body?.cancel().catch(() => {});
        throw error;
      }
    }
    bounded(source.length);
    const bytes = new TextEncoder().encode(source);
    bounded(bytes.length);
    return bytes;
  }
  throw new Error('Unsupported conversion source type.');
}

function isBlobLikeSource(source: PreviewSource): source is Blob | File {
  return typeof source === 'object'
    && source !== null
    && 'arrayBuffer' in source
    && typeof source.arrayBuffer === 'function';
}
