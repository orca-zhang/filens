// @vitest-environment node
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { wasmResponse } from '../src/wasm-response';
import { createWasmCoreRunner, loadWasmModule } from '../src/wasi-runner';
import { createWasiProgram } from './fixtures/wasi.mjs';

const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
const encoded = (data: Uint8Array) => `data:application/wasm+gzip;base64,${gzipSync(data).toString('base64')}`;
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('compressed embedded WASM', () => {
  it.each([true, false])('decodes and compiles real WASM with native decompression %s', async native => {
    if (!native) vi.stubGlobal('DecompressionStream', undefined);
    const response = await wasmResponse(await fetch(encoded(bytes)));
    expect(response.headers.get('content-type')).toBe('application/wasm');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(await loadWasmModule(encoded(bytes))).toBeInstanceOf(WebAssembly.Module);
  });

  it('streams correctly typed modules and preserves untyped custom responses', async () => {
    const streaming = vi.spyOn(WebAssembly, 'compileStreaming');
    expect(await loadWasmModule(new Response(bytes, { headers: { 'content-type': 'application/wasm' } }))).toBeInstanceOf(WebAssembly.Module);
    expect(streaming).toHaveBeenCalledOnce();
    expect(await loadWasmModule(new Response(bytes))).toBeInstanceOf(WebAssembly.Module);
    expect(streaming).toHaveBeenCalledOnce();
  });

  it('retries corrupt compressed input and reuses a successful compiled module', async () => {
    const program = createWasiProgram({ commands: [] });
    const load = vi.fn().mockResolvedValueOnce('data:application/wasm+gzip;base64,AQID').mockResolvedValue(encoded(program));
    const run = createWasmCoreRunner({ wasm: load });
    await expect(run({ args: [], files: {} })).rejects.toThrow();
    expect((await run({ args: [], files: {} })).exitCode).toBe(0);
    expect((await run({ args: [], files: {} })).exitCode).toBe(0);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
