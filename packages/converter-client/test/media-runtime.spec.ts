import { afterEach, describe, expect, it, vi } from 'vitest';
import { convertMedia } from '../src/media-runtime';

const workers = vi.hoisted(() => [] as Array<{
  terminate: ReturnType<typeof vi.fn>; postMessage: ReturnType<typeof vi.fn>;
  onmessage?: (event: { data: unknown }) => void;
}>);
vi.mock('../src/media-worker?worker&inline', () => ({ default: class {
  terminate = vi.fn(); postMessage = vi.fn();
  constructor() { workers.push(this); }
} }));
afterEach(() => { vi.useRealTimers(); workers.splice(0); });

describe('HEIF worker lifecycle', () => {
  it('terminates a hung decoder after the preview deadline', async () => {
    vi.useFakeTimers();
    const pending = convertMedia(new Uint8Array([1]), 'heic');
    const rejected = expect(pending).rejects.toThrow('30 second');
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
    expect(workers[0]!.terminate).toHaveBeenCalledOnce();
  });

  it('terminates immediately on abort and removes the deadline', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const pending = convertMedia(new Uint8Array([1]), 'heic', controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(workers[0]!.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('resolves both WASM URLs before posting to the Blob worker and clears the deadline on success', async () => {
    vi.useFakeTimers();
    const input = new Uint8Array([1]), pending = convertMedia(input, 'heic');
    const worker = workers[0]!;
    expect(worker.postMessage).toHaveBeenCalledWith({
      input, format: 'heic', wasmUrl: expect.stringMatching(/^\w+:.+libheif\.wasm/),
      imageWasmUrl: expect.stringMatching(/^\w+:.+converter-image\.wasm/)
    }, [input.buffer]);
    const result = { source: new Uint8Array([137, 80]), format: 'png' };
    worker.onmessage!({ data: result });
    await expect(pending).resolves.toEqual(result);
    expect(worker.terminate).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
});
