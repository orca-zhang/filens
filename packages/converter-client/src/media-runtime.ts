import type { ConversionResult } from '@filens/core';
import MediaWorker from './media-worker?worker&inline';
import heifWasmUrl from '../vendor/libheif/libheif.wasm?url';
import imageWasmUrl from '../../../wasm/converter-image/dist/converter-image.wasm?url';
import { throwIfAborted } from './source';

// Single-file previews defer restoring embedded WASM until a codec is used.
const resolveWasmUrl = (source: string | (() => string)) => new URL(typeof source === 'function' ? source() : source, import.meta.url).href;

export function convertMedia(input: Uint8Array, format: string, signal?: AbortSignal): Promise<ConversionResult> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const worker = new MediaWorker();
    let stopped = false;
    const cleanup = () => {
      stopped = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      worker.terminate();
    };
    const abort = () => {
      cleanup();
      reject(new DOMException('Media conversion was aborted.', 'AbortError'));
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('HEIF decoding exceeded the 30 second preview limit.'));
    }, 30_000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = event => { cleanup(); reject(new Error(event.message || 'Media conversion worker failed.')); };
    worker.onmessageerror = () => { cleanup(); reject(new Error('Invalid media conversion response.')); };
    worker.onmessage = ({ data }: MessageEvent<ConversionResult & { error?: string }>) => {
      cleanup();
      if (data.error) reject(new Error(data.error));
      else resolve(data);
    };
    // Resolve asset URLs in the document, before passing them into a Blob worker.
    try {
      const wasmUrl = resolveWasmUrl(heifWasmUrl), imageUrl = resolveWasmUrl(imageWasmUrl);
      const message = { input, format, wasmUrl, imageWasmUrl: imageUrl };
      if ([wasmUrl, imageUrl].some(url => url.startsWith('blob:null/'))) {
        // File pages and their workers have distinct opaque origins. Read the
        // document-owned Blob URLs here and transfer bytes across that boundary.
        void Promise.all([wasmUrl, imageUrl].map(async url => {
          const response = await fetch(url, { signal });
          if (!response.ok) throw new Error(`Failed to load the HEIF WASM: ${response.status}.`);
          return new Uint8Array(await response.arrayBuffer());
        })).then(([wasmBytes, imageWasmBytes]) => {
          if (stopped) return;
          worker.postMessage({ ...message, wasmBytes, imageWasmBytes }, [input.buffer as ArrayBuffer, wasmBytes.buffer, imageWasmBytes.buffer]);
        }).catch(error => { if (!stopped) { cleanup(); reject(error); } });
      } else worker.postMessage(message, [input.buffer as ArrayBuffer]);
    } catch (error) { cleanup(); reject(error); }
  });
}
