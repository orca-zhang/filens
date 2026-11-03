import { cancellable, HttpRangeSource, linkAbort, MEDIA_LIMITS, type BoundedMediaSource } from './engine-snapshot/core';

export type BrowserMediaInput = string | Blob | ArrayBuffer | Uint8Array | BoundedMediaSource;
export interface BrowserSourceOptions {
  /** Optional host authentication/CORS handling; only the requested media URL is fetched. */
  fetch?: typeof globalThis.fetch;
}

/** Each session owns its cancellation, never a caller's Blob, bytes or P2P transport. */
export function createBrowserMediaSource(input: BrowserMediaInput, options: BrowserSourceOptions = {}): BoundedMediaSource {
  if (typeof input === 'string') return new HttpRangeSource(input, async (start, end, signal) => {
    const response = await (options.fetch ?? globalThis.fetch)(input, { headers: { Range: `bytes=${start}-${end}` }, signal });
    const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') ?? '');
    const expected = range ? Number(range[2]) - start + 1 : 0;
    // Never call arrayBuffer() on an unvalidated remote response: a server can
    // ignore Range and return the entire original, including a multi-GB video.
    if (response.status !== 206 || !range || Number(range[1]) !== start ||
      Number(range[2]) > end || expected <= 0 || expected > MEDIA_LIMITS.readBytes ||
      !Number.isSafeInteger(Number(range[3])) || Number(range[3]) <= Number(range[2]) || !response.body) {
      await response.body?.cancel().catch(() => {});
      throw new Error('Browser media requires a valid HTTP Range response (206).');
    }
    const reader = response.body.getReader();
    const bytes = new Uint8Array(expected);
    let offset = 0;
    try {
      for (;;) {
        const { value, done } = await cancellable(reader.read(), signal);
        if (done) break;
        if (offset + value.length > expected) throw new Error('Invalid Range body length.');
        bytes.set(value, offset); offset += value.length;
      }
      if (offset !== expected) throw new Error('Invalid Range body length.');
      return { status: response.status, headers: response.headers, data: bytes.buffer };
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }, input);

  const lifetime = new AbortController();
  const blob = input instanceof Blob ? input : undefined;
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : input instanceof Uint8Array ? input : undefined;
  const borrowed = !blob && !bytes ? input as BoundedMediaSource : undefined;
  const size = blob?.size ?? bytes?.byteLength ?? borrowed?.size;
  return {
    identity: borrowed?.identity ?? 'browser-local', size, nativeUrl: borrowed?.nativeUrl,
    async read(start, endExclusive, signal) {
      lifetime.signal.throwIfAborted(); signal?.throwIfAborted();
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(endExclusive) || start < 0 || endExclusive <= start ||
        endExclusive - start > MEDIA_LIMITS.readBytes) throw new Error('Browser media read budget exceeded.');
      const end = size === undefined ? endExclusive : Math.min(size, endExclusive);
      if (start >= end) return new Uint8Array();
      const link = linkAbort(lifetime.signal, signal);
      try {
        const result = blob ? new Uint8Array(await cancellable(blob.slice(start, end).arrayBuffer(), link.controller.signal)) :
          bytes ? bytes.slice(start, end) : await cancellable(borrowed!.read(start, end, link.controller.signal), link.controller.signal);
        if (result.byteLength > end - start) throw new Error('Browser media source exceeded its read budget.');
        return result;
      } finally { link.controller.abort(); link.dispose(); }
    },
    close() { lifetime.abort(); }
  };
}
