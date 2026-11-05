import { createFormatDetector } from './format-detector';
import { scalarWasmUrl, simdWasmUrl } from './format-detector-assets';

export { createFormatDetector } from './format-detector';
export type { FormatDetection } from './format-detector';

export type FormatDetectorWasm = BufferSource | WebAssembly.Module;
export interface FormatDetectorSources {
  scalar: () => FormatDetectorWasm | Promise<FormatDetectorWasm>;
  simd?: () => FormatDetectorWasm | Promise<FormatDetectorWasm>;
}

async function loadWasm(url: string) {
  const response = await fetch(new URL(url, import.meta.url));
  if (!response.ok) throw new Error(`Format detector download failed: HTTP ${response.status}`);
  return response.arrayBuffer();
}

const defaultSources: FormatDetectorSources = {
  scalar: () => loadWasm(scalarWasmUrl),
  simd: () => loadWasm(simdWasmUrl),
};

// A tiny module returning i8x16.popcnt(i8x16.splat(0)). Validation does not
// instantiate a detector or fetch either variant.
const simdProbe = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123,
  3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11
]);

/** Defaults to the packaged SIMD128 detector when supported, otherwise scalar.
 * SIMD loading/compilation failures also fall back to scalar; detection errors
 * still propagate. Custom sources may override the packaged artifacts. */
export async function createAutoFormatDetector(sources: FormatDetectorSources = defaultSources) {
  if (sources.simd && WebAssembly.validate(simdProbe)) {
    try {
      const detector = await createFormatDetector(await sources.simd());
      return Object.assign(detector, { implementation: 'simd128' as const });
    } catch {
      // A failed optional variant must not prevent the portable detector loading.
    }
  }
  const detector = await createFormatDetector(await sources.scalar());
  return Object.assign(detector, { implementation: 'scalar' as const });
}
