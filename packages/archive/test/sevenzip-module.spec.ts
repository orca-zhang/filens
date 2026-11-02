// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { loadArchiveModule } from '../src/sevenzip/module';

const wasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
afterEach(() => { vi.unstubAllGlobals(); });

it('fetches and compiles once for concurrent operations and later retries', async () => {
  const fetcher = vi.fn(async () => new Response(wasm, { headers: { 'content-type': 'application/wasm' } }));
  vi.stubGlobal('fetch', fetcher);
  const [one, two] = await Promise.all([loadArchiveModule('/shared.wasm'), loadArchiveModule('/shared.wasm')]);
  expect(one).toBeInstanceOf(WebAssembly.Module);
  expect(two).toBe(one);
  expect(await loadArchiveModule('/shared.wasm')).toBe(one);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(new WebAssembly.Instance(one).exports).toEqual({});
});

it('retries failed downloads and accepts untyped static servers', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('missing', { status: 404 }))
    .mockResolvedValueOnce(new Response(wasm));
  vi.stubGlobal('fetch', fetcher);
  await expect(loadArchiveModule('/retry.wasm')).rejects.toThrow('404');
  expect(await loadArchiveModule('/retry.wasm')).toBeInstanceOf(WebAssembly.Module);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('does not cache a corrupted module', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('corrupted'))
    .mockResolvedValueOnce(new Response(wasm));
  vi.stubGlobal('fetch', fetcher);
  await expect(loadArchiveModule('/corrupt.wasm')).rejects.toBeInstanceOf(WebAssembly.CompileError);
  expect(await loadArchiveModule('/corrupt.wasm')).toBeInstanceOf(WebAssembly.Module);
});
