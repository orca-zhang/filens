/// <reference lib="webworker" />
import createHeif from '../vendor/libheif/libheif.js';
import { wasmResponse } from './wasm-response';
import { withDecodedHeif } from './heif-decoder';
import { createHeifNormalizer } from './heif-color';

const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = async ({ data }: MessageEvent<{
  input: Uint8Array; format: string; wasmUrl: string; imageWasmUrl: string;
  wasmBytes?: Uint8Array<ArrayBuffer>; imageWasmBytes?: Uint8Array<ArrayBuffer>;
}>) => {
  try {
    if (!['heic', 'heif'].includes(data.format)) throw new Error('Only HEIC/HEIF image decoding is bundled.');
    const normalize = await createHeifNormalizer(data.imageWasmBytes ?? data.imageWasmUrl);
    const source = await decodeHeif(data.input, data.wasmUrl, normalize, data.wasmBytes);
    scope.postMessage({ source, format: 'png', contentType: 'image/png' }, [source.buffer]);
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};

async function decodeHeif(input: Uint8Array, wasmUrl: string, normalize: Awaited<ReturnType<typeof createHeifNormalizer>>,
  wasmBytes?: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  if (!wasmBytes) {
    const response = await fetch(wasmUrl);
    if (!response.ok) throw new Error(`Failed to load the HEIF decoder: ${response.status}.`);
    wasmBytes = new Uint8Array(await (await wasmResponse(response)).arrayBuffer());
  }
  const heif = await createHeif({
    wasmBinary: wasmBytes,
    // Emscripten computes a fallback URL even when wasmBinary is supplied.
    // A Blob worker cannot resolve relative URLs against import.meta.url.
    locateFile: () => wasmUrl
  });
  return withDecodedHeif(heif, input, normalize, normalize.readColorProfile);
}
