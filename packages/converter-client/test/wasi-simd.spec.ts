// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWasmCoreRunner } from '../src/wasi-runner';
import { call, createWasiProgram, iov } from './fixtures/wasi.mjs';

function program(marker: string, simd = false, trap = false) {
  return createWasiProgram({ data: [[4096, marker]], commands: [
    // i32.const 0; i8x16.splat; i8x16.popcnt; drop.
    ...(simd ? [[0x41, 0, 0xfd, 0x0f, 0xfd, 0x62, 0x1a]] : []),
    ...(trap ? [[0x00]] : []),
    iov(4096, marker.length), call('fd_write', [1, 64, 1, 200])
  ] });
}
const invocation = { args: ['simd-selection'], files: {}, captureStdio: true };
afterEach(() => vi.restoreAllMocks());

describe('optional SIMD128 WASM selection', () => {
  it('executes a real SIMD module and caches its loader without loading scalar', async () => {
    const wasm = vi.fn(() => program('scalar'));
    const simdWasm = vi.fn(() => program('simd', true));
    const run = createWasmCoreRunner({ wasm, simdWasm });
    for (let i = 0; i < 2; i++) expect((await run(invocation)).stdout).toBe('simd');
    expect(simdWasm).toHaveBeenCalledTimes(1);
    expect(wasm).not.toHaveBeenCalled();
  });

  it('does not request SIMD on engines without the capability', async () => {
    vi.spyOn(WebAssembly, 'validate').mockReturnValue(false);
    const wasm = vi.fn(() => program('scalar'));
    const simdWasm = vi.fn(() => program('simd', true));
    const run = createWasmCoreRunner({ wasm, simdWasm });
    for (let i = 0; i < 2; i++) expect((await run(invocation)).stdout).toBe('scalar');
    expect(simdWasm).not.toHaveBeenCalled();
    expect(wasm).toHaveBeenCalledTimes(1);
  });

  it.each(['load', 'compile'])('uses scalar when optional SIMD %s fails', async failure => {
    const wasm = vi.fn(() => program('scalar'));
    const simdWasm = vi.fn(() => {
      if (failure === 'load') throw new Error('Optional asset unavailable');
      return new Uint8Array([0]);
    });
    const run = createWasmCoreRunner({ wasm, simdWasm });
    for (let i = 0; i < 2; i++) expect((await run(invocation)).stdout).toBe('scalar');
    expect(simdWasm).toHaveBeenCalledTimes(1);
    expect(wasm).toHaveBeenCalledTimes(1);
  });

  it('propagates execution failures without repeating the operation on scalar', async () => {
    const wasm = vi.fn(() => program('scalar'));
    const run = createWasmCoreRunner({ wasm, simdWasm: program('simd', true, true) });
    await expect(run(invocation)).rejects.toBeInstanceOf(WebAssembly.RuntimeError);
    expect(wasm).not.toHaveBeenCalled();
  });
});
