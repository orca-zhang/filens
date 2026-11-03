import { InMemoryWasiHost, loadWasmModule } from './wasi-runner';
import type { HeifColorProfile, HeifRaster } from './heif-decoder';

interface ImageCore {
  memory: WebAssembly.Memory;
  filens_image_alloc(length: number): number;
  filens_image_free(pointer: number, length: number): void;
  filens_image_normalize_heif(pointer: number, length: number): bigint;
  filens_image_heif_profile(pointer: number, length: number, itemId: number): bigint;
}

/** Generic buffer transport; all color math and PNG encoding execute in WASM. */
export async function createHeifNormalizer(wasmUrl: string) {
  const module = await loadWasmModule(wasmUrl);
  const wasi = new InMemoryWasiHost({ args: ['converter-image'], files: {} });
  const instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: wasi.imports });
  wasi.setInstance(instance);
  const core = instance.exports as unknown as ImageCore;
  if (typeof core.filens_image_normalize_heif !== 'function' || typeof core.filens_image_heif_profile !== 'function') {
    throw new Error('Update the image WASM core to decode HEIF color profiles.');
  }
  const exchange = (length: number, write: (bytes: Uint8Array, at: number) => void, invoke: (input: number) => bigint) => {
    let input = 0, output = 0, outputLength = 0;
    try {
      input = core.filens_image_alloc(length) >>> 0;
      if (!input) throw new Error('Image core could not allocate its input buffer.');
      const bytes = new Uint8Array(core.memory.buffer);
      write(bytes, input);
      const result = invoke(input);
      output = Number(result & 0xffffffffn); outputLength = Number(result >> 32n);
      if (!output || outputLength < 4 || output + outputLength > core.memory.buffer.byteLength) throw new Error('Image core returned an invalid HEIF result.');
      const resultBytes = new Uint8Array(core.memory.buffer, output, outputLength);
      const metadataLength = new DataView(resultBytes.buffer, resultBytes.byteOffset).getUint32(0, true);
      if (metadataLength > outputLength - 4) throw new Error('Image core returned invalid HEIF metadata.');
      const status = JSON.parse(new TextDecoder().decode(resultBytes.subarray(4, 4 + metadataLength)));
      if (!status.ok) throw new Error(status.errorMessage || 'HEIF color conversion failed.');
      return { status, bytes: resultBytes.slice(4 + metadataLength) };
    } finally {
      if (output && outputLength) core.filens_image_free(output, outputLength);
      if (input) core.filens_image_free(input, length);
    }
  };
  const normalize = (raster: HeifRaster): Uint8Array<ArrayBuffer> => {
    const { icc, pixels, ...metadata } = raster;
    const json = new TextEncoder().encode(JSON.stringify({ ...metadata, iccLength: icc.length }));
    const length = 4 + json.length + icc.length + pixels.length;
    return exchange(length, (bytes, input) => {
      new DataView(bytes.buffer).setUint32(input, json.length, true);
      bytes.set(json, input + 4);
      bytes.set(icc, input + 4 + json.length);
      bytes.set(pixels, input + 4 + json.length + icc.length);
    }, input => core.filens_image_normalize_heif(input, length)).bytes;
  };
  return Object.assign(normalize, {
    readColorProfile(source: Uint8Array, itemId: number): HeifColorProfile | null {
      return exchange(source.length, (bytes, input) => bytes.set(source, input),
        input => core.filens_image_heif_profile(input, source.length, itemId)).status.profile;
    }
  });
}
