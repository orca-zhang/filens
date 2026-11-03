/// <reference lib="webworker" />
import createHeif from 'libheif-js/libheif-wasm/libheif.js';
import { wasmResponse } from './wasm-response';
import { withDecodedHeif } from './heif-decoder';
import { createHeifNormalizer } from './heif-color';

const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = async ({ data }: MessageEvent<{ input: Uint8Array; format: string; wasmUrl: string; imageWasmUrl: string }>) => {
  try {
    if (!['heic', 'heif'].includes(data.format)) throw new Error('Only HEIC/HEIF image decoding is bundled.');
    const normalize = await createHeifNormalizer(data.imageWasmUrl);
    const source = await decodeHeif(data.input, data.wasmUrl, normalize);
    scope.postMessage({ source, format: 'png', contentType: 'image/png' }, [source.buffer]);
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};

async function decodeHeif(input: Uint8Array, wasmUrl: string, normalize: Awaited<ReturnType<typeof createHeifNormalizer>>): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(wasmUrl);
  if (!response.ok) throw new Error(`Failed to load the HEIF decoder: ${response.status}.`);
  const heif = await createHeif({ wasmBinary: new Uint8Array(await (await wasmResponse(response)).arrayBuffer()) });
  return withDecodedHeif(heif, input, normalize, normalize.readColorProfile);
}
