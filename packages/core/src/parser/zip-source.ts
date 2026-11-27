import { openRangedZipArchive, ZIP_TAIL_LENGTH, type ZipArchiveOptions, type ZipEntry } from './zip-reader';

export interface ZipBlobSource {
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  slice(start: number, end: number): Pick<Blob, 'arrayBuffer'>;
}

export async function openZipSource(source: string | ZipBlobSource, options: ZipArchiveOptions, bufferedFirstByte?: number): Promise<Uint8Array | Map<string, ZipEntry>> {
  const { signal } = options;
  signal?.throwIfAborted();
  if (typeof source !== 'string') {
    const read = async (offset: number, size: number, requestSignal?: AbortSignal) => {
      signal?.throwIfAborted();
      requestSignal?.throwIfAborted();
      const bytes = new Uint8Array(await source.slice(offset, offset + size).arrayBuffer());
      signal?.throwIfAborted();
      requestSignal?.throwIfAborted();
      return bytes;
    };
    if (source.size > ZIP_TAIL_LENGTH) {
      const prefix = bufferedFirstByte === undefined ? undefined : await read(0, 1).catch(() => undefined);
      signal?.throwIfAborted();
      if (bufferedFirstByte === undefined || (prefix?.length === 1 && prefix[0] !== bufferedFirstByte)) {
        const archive = await openRangedZipArchive(source.size, read, options).catch(() => undefined);
        signal?.throwIfAborted();
        if (archive) return archive;
      }
    }
    const bytes = new Uint8Array(await source.arrayBuffer());
    signal?.throwIfAborted();
    return bytes;
  }

  const url = new URL(source, typeof location === 'undefined' ? undefined : location.href);
  if (/^https?:$/.test(url.protocol)) {
    // A single explicit range is CORS-safelisted. A suffix range requires preflight.
    const probe = await fetch(source, { headers: { Range: 'bytes=0-0' }, signal }).catch(() => undefined);
    signal?.throwIfAborted();
    if (probe?.status === 200) return responseBytes(probe, signal);
    if (probe) {
      const range = contentRange(probe);
      let useRanges = probe.status === 206 && range?.first === 0 && range.last === 0;
      if (useRanges && bufferedFirstByte !== undefined) {
        const prefix = await readRangeBody(probe, 1, signal).catch(() => undefined);
        useRanges = prefix !== undefined && prefix[0] !== bufferedFirstByte;
      }
      await discardResponse(probe);
      signal?.throwIfAborted();
      if (useRanges && range) {
        const archive = await openRangedZipArchive(range.length, (offset, size, requestSignal) =>
          readHttpRange(source, offset, size, range.length, probe, signal, requestSignal), options).catch(() => undefined);
        signal?.throwIfAborted();
        if (archive) return archive;
      }
      if (!probe.ok && ![400, 405, 416].includes(probe.status)) throw responseError(probe);
    }
  }
  return responseBytes(await fetch(source, { signal }), signal);
}

function contentRange(response: Response): { first: number; last: number; length: number } | undefined {
  const encoding = response.headers.get('Content-Encoding');
  if (encoding && encoding.toLowerCase() !== 'identity') return undefined;
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/i.exec(response.headers.get('Content-Range') ?? '');
  if (!match) return undefined;
  const first = Number(match[1]), last = Number(match[2]), length = Number(match[3]);
  if (!Number.isSafeInteger(length) || first > last || last >= length) return undefined;
  return { first, last, length };
}

async function readHttpRange(source: string, offset: number, size: number, archiveLength: number, probe: Response,
  archiveSignal?: AbortSignal, requestSignal?: AbortSignal): Promise<Uint8Array> {
  archiveSignal?.throwIfAborted();
  requestSignal?.throwIfAborted();
  if (!size) return new Uint8Array();
  const controller = archiveSignal && requestSignal && archiveSignal !== requestSignal ? new AbortController() : undefined;
  const abort = () => controller?.abort();
  if (controller) {
    archiveSignal!.addEventListener('abort', abort, { once: true });
    requestSignal!.addEventListener('abort', abort, { once: true });
  }
  const signal = controller?.signal ?? requestSignal ?? archiveSignal;
  try {
    const last = offset + size - 1;
    const response = await fetch(source, { headers: { Range: `bytes=${offset}-${last}` }, signal });
    const range = contentRange(response);
    const consistent = ['ETag', 'Last-Modified'].every(name => {
      const initial = probe.headers.get(name);
      return !initial || response.headers.get(name) === initial;
    });
    const initialUrl = probe.url, rangeUrl = response.url;
    const sameOrigin = !initialUrl || !rangeUrl || new URL(initialUrl).origin === new URL(rangeUrl).origin;
    if (response.status !== 206 || range?.first !== offset || range.last !== last || range.length !== archiveLength || !sameOrigin || !consistent) {
      await discardResponse(response);
      throw new Error('ZIP range response does not match the archive.');
    }
    return await readRangeBody(response, size, signal);
  } finally {
    if (controller) {
      archiveSignal!.removeEventListener('abort', abort);
      requestSignal!.removeEventListener('abort', abort);
    }
  }
}

async function readRangeBody(response: Response, size: number, signal?: AbortSignal): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Missing ZIP range response body.');
  const bytes = new Uint8Array(size);
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (length + value.byteLength > size) throw new Error('Invalid ZIP range response length.');
      bytes.set(value, length);
      length += value.byteLength;
    }
    if (length !== size) throw new Error('Invalid ZIP range response length.');
    signal?.throwIfAborted();
    return bytes;
  } finally { await reader.cancel().catch(() => {}); }
}

async function discardResponse(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => {});
}

function responseError(response: Response): Error {
  return Object.assign(new Error(`Failed to open ZIP source: ${response.status} ${response.statusText}`.trim()), {
    name: 'ZipSourceHttpError', status: response.status
  });
}

async function responseBytes(response: Response, signal?: AbortSignal): Promise<Uint8Array> {
  if (!response.ok) throw responseError(response);
  const bytes = new Uint8Array(await response.arrayBuffer());
  signal?.throwIfAborted();
  return bytes;
}
