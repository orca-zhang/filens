import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ damage: '' }));
vi.mock('../../converter-client/src/wasi-runner', async importOriginal => {
  const actual = await importOriginal<typeof import('../../converter-client/src/wasi-runner')>();
  return {
    ...actual,
    createWasmCoreRunner(options: Parameters<typeof actual.createWasmCoreRunner>[0]) {
      const run = actual.createWasmCoreRunner(options);
      return async (invocation: Parameters<typeof run>[0]) => {
        const result = await run(invocation);
        const bytes = result.files['/work/mesh.bin'];
        if (!bytes) return result;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const count = view.getUint32(12, true) * 3;
        switch (state.damage) {
          case 'header': bytes[0] ^= 0xff; break;
          case 'version': view.setUint32(8, 2, true); break;
          case 'count': view.setUint32(12, 0xffffffff, true); break;
          case 'truncated': result.files['/work/mesh.bin'] = bytes.subarray(0, -1); break;
          case 'position': view.setFloat32(16, NaN, true); break;
          case 'normal': view.setFloat32(16 + count * 4, Infinity, true); break;
          case 'offset': {
            const padded = new Uint8Array(bytes.length + 3);
            padded.set(bytes, 3); result.files['/work/mesh.bin'] = padded.subarray(3);
          }
        }
        return result;
      };
    }
  };
});
import { createStepReader } from '../src';

const wasm = new Uint8Array(await readFile(new URL('../vendor/filens-step.wasm', import.meta.url)));
const cube = new Uint8Array(await readFile(new URL('../../model3d/test/fixtures/occt/cube.stp', import.meta.url)));
beforeEach(() => { state.damage = ''; });

describe('binary output from the real STEP core', () => {
  it.each(['header', 'version', 'count', 'truncated', 'position', 'normal'])('rejects a damaged %s from a custom core', async damage => {
    state.damage = damage;
    await expect(createStepReader({ wasm }).read(cube)).rejects.toMatchObject({ name: 'StepReadError', code: 'invalid_mesh' });
  });

  it('reads little-endian Float32 output at an unaligned buffer offset', async () => {
    const expected = await createStepReader({ wasm }).read(cube);
    state.damage = 'offset';
    const actual = await createStepReader({ wasm }).read(cube);
    expect(actual.positions).toEqual(expected.positions);
    expect(actual.normals).toEqual(expected.normals);
  });
});
