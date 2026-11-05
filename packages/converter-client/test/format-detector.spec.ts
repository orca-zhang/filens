// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAutoFormatDetector, createFormatDetector } from '../src/format-detector-auto';
import { createDetectorFixture } from './fixtures/detector.mjs';

vi.mock('../src/format-detector-assets', () => ({
  scalarWasmUrl: 'https://filens.test/converter-detect-scalar.wasm',
  simdWasmUrl: 'https://filens.test/converter-detect-simd.wasm',
}));

afterEach(() => vi.restoreAllMocks());

describe('adaptive format detector', () => {
  it('defaults to packaged SIMD and fetches only that artifact', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(createDetectorFixture()));
    expect(fetch).not.toHaveBeenCalled();
    const detector = await createAutoFormatDetector();
    expect(detector.implementation).toBe('simd128');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toContain('converter-detect-simd.wasm');
    expect(detector.detect(new Uint8Array(3)).format).toBe('txt');
  });

  it('defaults to packaged scalar on unsupported runtimes', async () => {
    vi.spyOn(WebAssembly, 'validate').mockReturnValue(false);
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(createDetectorFixture()));
    const detector = await createAutoFormatDetector();
    expect(detector.implementation).toBe('scalar');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toContain('converter-detect-scalar.wasm');
  });

  it('falls back to packaged scalar after a SIMD HTTP failure', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('Unavailable', { status: 503 }))
      .mockResolvedValueOnce(new Response(createDetectorFixture()));
    const detector = await createAutoFormatDetector();
    expect(detector.implementation).toBe('scalar');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(fetch.mock.calls[0][0])).toContain('converter-detect-simd.wasm');
    expect(String(fetch.mock.calls[1][0])).toContain('converter-detect-scalar.wasm');
    expect(detector.detect(new Uint8Array(3)).format).toBe('txt');
  });

  it('propagates a failed packaged scalar download', async () => {
    vi.spyOn(WebAssembly, 'validate').mockReturnValue(false);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Not found', { status: 404 }));
    await expect(createAutoFormatDetector()).rejects.toThrow('HTTP 404');
  });

  it('loads only SIMD on a supported runtime and retains live memory diagnostics', async () => {
    const scalar = vi.fn(() => createDetectorFixture());
    const simd = vi.fn(() => createDetectorFixture());
    const detector = await createAutoFormatDetector({ scalar, simd });
    expect(detector.implementation).toBe('simd128');
    expect(simd).toHaveBeenCalledTimes(1);
    expect(scalar).not.toHaveBeenCalled();
    expect(detector.memoryBytes).toBe(65536);
    expect(detector.detect(new Uint8Array(3))).toEqual({ format: 'txt', container: null,
      evidence: 'text', reason: 'fixture', bytesRead: 0, fileBytes: 3 });
    expect(detector.memoryBytes).toBe(131072);
    expect(detector.detect(new Uint8Array(17)).fileBytes).toBe(17);
    expect(detector.memoryBytes).toBe(196608);
  });

  it('never loads SIMD when feature validation rejects it', async () => {
    vi.spyOn(WebAssembly, 'validate').mockReturnValue(false);
    const simd = vi.fn(() => createDetectorFixture());
    const detector = await createAutoFormatDetector({ scalar: () => createDetectorFixture(), simd });
    expect(detector.implementation).toBe('scalar');
    expect(simd).not.toHaveBeenCalled();
    expect(detector.detect(new Uint8Array()).format).toBe('txt');
  });

  it.each(['download', 'compile', 'exports'])('falls back after a SIMD %s failure', async failure => {
    const scalar = vi.fn(() => createDetectorFixture());
    const detector = await createAutoFormatDetector({ scalar, simd: async () => {
      if (failure === 'download') throw new Error('SIMD download failed');
      if (failure === 'compile') return new Uint8Array([1, 2, 3]);
      return new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
    } });
    expect(detector.implementation).toBe('scalar');
    expect(scalar).toHaveBeenCalledTimes(1);
    expect(detector.detect(new Uint8Array()).format).toBe('txt');
  });

  it('accepts a compiled scalar module without probing SIMD when none is provided', async () => {
    const validate = vi.spyOn(WebAssembly, 'validate');
    const module = await WebAssembly.compile(createDetectorFixture());
    const detector = await createAutoFormatDetector({ scalar: () => module });
    expect(detector.implementation).toBe('scalar');
    expect(validate).not.toHaveBeenCalled();
  });

  it('propagates scalar initialization errors', async () => {
    await expect(createAutoFormatDetector({ scalar: () => { throw new Error('scalar failure'); } })).rejects.toThrow('scalar failure');
    await expect(createFormatDetector(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))).rejects.toThrow('WASM exports');
  });

  it('propagates detection traps without fetching another detector', async () => {
    const scalar = vi.fn(() => createDetectorFixture());
    const detector = await createAutoFormatDetector({ scalar, simd: () => createDetectorFixture({ trap: true }) });
    expect(() => detector.detect(new Uint8Array())).toThrow(WebAssembly.RuntimeError);
    expect(scalar).not.toHaveBeenCalled();
  });
});
