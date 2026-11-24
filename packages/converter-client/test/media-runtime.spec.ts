import { afterEach, describe, expect, it, vi } from 'vitest';
import { convertMedia } from '../src/media-runtime';

const workers = vi.hoisted(() => [] as Array<{
  terminate: ReturnType<typeof vi.fn>; postMessage: ReturnType<typeof vi.fn>;
  onmessage?: (event: { data: unknown }) => void;
}>);
const assets = vi.hoisted(() => ({
  heif: vi.fn(() => 'libheif.wasm'), image: vi.fn(() => 'converter-image.wasm')
}));
vi.mock('../vendor/libheif/libheif.wasm?url', () => ({ default: assets.heif }));
vi.mock('../../../wasm/converter-image/dist/converter-image.wasm?url', () => ({ default: assets.image }));
vi.mock('../src/media-worker?worker&inline', () => ({ default: class {
  terminate = vi.fn(); postMessage = vi.fn();
  constructor() { workers.push(this); }
} }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); workers.splice(0); });

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
    expect(assets.heif).not.toHaveBeenCalled();
    expect(assets.image).not.toHaveBeenCalled();
    const input = new Uint8Array([1]), pending = convertMedia(input, 'heic');
    const worker = workers[0]!;
    expect(worker.postMessage).toHaveBeenCalledWith({
      input, format: 'heic', wasmUrl: expect.stringMatching(/^\w+:.+libheif\.wasm/),
      imageWasmUrl: expect.stringMatching(/^\w+:.+converter-image\.wasm/)
    }, [input.buffer]);
    expect(assets.heif).toHaveBeenCalledOnce();
    expect(assets.image).toHaveBeenCalledOnce();
    const result = { source: new Uint8Array([137, 80]), format: 'png' };
    worker.onmessage!({ data: result });
    await expect(pending).resolves.toEqual(result);
    expect(worker.terminate).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans up the worker when restoring a deferred WASM URL fails', async () => {
    vi.useFakeTimers();
    assets.heif.mockImplementationOnce(() => { throw new Error('Invalid packed preview assets.'); });
    await expect(convertMedia(new Uint8Array([1]), 'heic')).rejects.toThrow('Invalid packed');
    expect(workers[0]!.terminate).toHaveBeenCalledOnce();
    expect(workers[0]!.postMessage).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('transfers opaque-origin WASM bytes instead of asking the worker to fetch document Blob URLs', async () => {
    assets.heif.mockReturnValueOnce('blob:null/heif'); assets.image.mockReturnValueOnce('blob:null/image');
    const bytes = new Uint8Array([0, 97, 115, 109]);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes)));
    const input = new Uint8Array([1]), pending = convertMedia(input, 'heic');
    await vi.waitFor(() => expect(workers[0]!.postMessage).toHaveBeenCalledOnce());
    const [message, transfer] = workers[0]!.postMessage.mock.calls[0]!;
    expect(message.wasmBytes).toEqual(bytes); expect(message.imageWasmBytes).toEqual(bytes);
    expect(transfer).toEqual([input.buffer, message.wasmBytes.buffer, message.imageWasmBytes.buffer]);
    workers[0]!.onmessage!({ data: { format: 'png', source: bytes } });
    await expect(pending).resolves.toMatchObject({ format: 'png' });
  });

  it('does not post to a terminated worker when opaque-origin WASM resolves after cancellation', async () => {
    assets.heif.mockReturnValueOnce('blob:null/heif'); assets.image.mockReturnValueOnce('blob:null/image');
    let finish!: () => void;
    const fetchResult = new Promise<void>(resolve => { finish = resolve; });
    vi.stubGlobal('fetch', vi.fn(() => fetchResult.then(() => new Response(new Uint8Array([0])))));
    const controller = new AbortController(), pending = convertMedia(new Uint8Array([1]), 'heic', controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    finish();
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(workers[0]!.postMessage).not.toHaveBeenCalled();
    expect(workers[0]!.terminate).toHaveBeenCalledOnce();
  });

  it('cleans up after an opaque-origin WASM read fails', async () => {
    assets.heif.mockReturnValueOnce('blob:null/heif'); assets.image.mockReturnValueOnce('blob:null/image');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    await expect(convertMedia(new Uint8Array([1]), 'heic')).rejects.toThrow('404');
    expect(workers[0]!.postMessage).not.toHaveBeenCalled();
    expect(workers[0]!.terminate).toHaveBeenCalledOnce();
  });
});
