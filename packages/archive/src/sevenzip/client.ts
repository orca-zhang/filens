import ArchiveWorker from './archive-worker.ts?worker';
import archiveWasmUrl from '../../vendor/7zip/7zz.wasm?archive-url';
import { PREVIEW_CONTAINER_LIMITS, PreviewPasswordError } from '@filens/core';
import type { SevenZipRequest, SevenZipResult } from './runtime';
import { ARCHIVE_VOLUME_LIMITS } from '../volumes';
import { loadArchiveModule } from './module';

export function runArchiveWorker(
  request: Omit<SevenZipRequest, 'maxEntries' | 'maxEntryBytes' | 'wasmUrl' | 'wasmModule'>, signal?: AbortSignal
): Promise<SevenZipResult> {
  signal?.throwIfAborted();
  if (/^(blob|data):/.test(import.meta.url) || globalThis.location?.protocol === 'file:') {
    throw new Error('This format needs separate archive engine files. Use filens preview FILE --mode serve, or deploy the archive assets over HTTP(S).');
  }
  if (1 + (request.volumes?.length ?? 0) > ARCHIVE_VOLUME_LIMITS.maxVolumes ||
      request.bytes.byteLength + (request.volumes ?? []).reduce((sum, file) => sum + file.bytes.byteLength, 0) > ARCHIVE_VOLUME_LIMITS.maxBytes) {
    throw new Error('Archive volumes exceed the preview input limit.');
  }
  return new Promise((resolve, reject) => {
    const worker = new ArchiveWorker();
    let settled = false;
    const finish = (result?: SevenZipResult, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      worker.terminate();
      if (error) reject(error); else resolve(result!);
    };
    const abort = () => finish(undefined, new DOMException('Archive preview aborted.', 'AbortError'));
    const timeout = setTimeout(() => finish(undefined, new Error('Archive processing exceeded the preview time limit.')), 60_000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = event => {
      const { result, error } = event.data;
      finish(result, error ? error.code === 'password_required' || error.code === 'password_invalid'
        ? new PreviewPasswordError(error.code) : new Error(error.message) : undefined);
    };
    worker.onerror = () => finish(undefined, new Error('The archive WASM worker could not be loaded or stopped unexpectedly.'));
    worker.onmessageerror = () => finish(undefined, new Error('The archive worker returned an invalid response.'));
    void (async () => {
      const wasmUrl = archiveWasmUrl();
      const wasmModule = await loadArchiveModule(wasmUrl);
      if (settled) return;
      // Preserve the source for entry reads and password retries. Only this copy
      // is transferred; extracted output transfers back without another copy.
      const bytes = request.bytes.slice();
      const volumes = request.volumes?.map(file => ({ name: file.name, bytes: file.bytes.slice() }));
      const message = { ...request, bytes, volumes, wasmUrl, maxEntries: PREVIEW_CONTAINER_LIMITS.maxEntries,
        maxEntryBytes: PREVIEW_CONTAINER_LIMITS.maxEntryBytes };
      const transfer = [bytes.buffer, ...(volumes ?? []).map(file => file.bytes.buffer)];
      try { worker.postMessage({ ...message, wasmModule }, transfer); }
      catch (error) {
        // Older browsers may not clone compiled modules. A failed clone leaves
        // transfer buffers attached; preserve their existing URL-loading path.
        if (!(error instanceof DOMException) || error.name !== 'DataCloneError') throw error;
        worker.postMessage(message, transfer);
      }
    })().catch(error => finish(undefined, error instanceof Error ? error : new Error(String(error))));
  });
}
