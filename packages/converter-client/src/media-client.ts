import type { ConverterClient } from '@filens/core';
import { sourceToBytes, throwIfAborted, waitForConversion } from './source';
import { MAX_HEIF_INPUT_BYTES } from './heif-decoder';

/** Small browser-local HEIF decoder; video playback uses browser codecs. */
export function createMediaConverterClient(): ConverterClient {
  return {
    async convert(request, context) {
      const sourceFormat = request.sourceFormat.replace(/^\./, '').toLowerCase();
      const targetFormat = request.targetFormat.replace(/^\./, '').toLowerCase();
      if (!(['heic', 'heif'].includes(sourceFormat) && targetFormat === 'png')) {
        throw new Error(`Unsupported media conversion: ${sourceFormat} -> ${targetFormat}.`);
      }
      throwIfAborted(context.signal);
      // Snapshot caller-owned views before yielding. Transfers must never detach them.
      if ((request.source instanceof Blob ? request.source.size : typeof request.source === 'string' ? 0 : request.source.byteLength) > MAX_HEIF_INPUT_BYTES) {
        throw new Error('HEIF input exceeds the 64 MiB preview limit.');
      }
      const source = ArrayBuffer.isView(request.source) ? request.source.slice() :
        request.source instanceof ArrayBuffer ? request.source.slice(0) : request.source;
      const input = await sourceToBytes(source, globalThis.fetch, context.signal, MAX_HEIF_INPUT_BYTES);
      throwIfAborted(context.signal);
      const runtime = await waitForConversion(import('./media-runtime'), context.signal);
      throwIfAborted(context.signal);
      return runtime.convertMedia(input, sourceFormat, context.signal);
    }
  };
}
