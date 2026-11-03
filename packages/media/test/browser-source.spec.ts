import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserMediaSource } from '../src/browser-source';

afterEach(() => vi.unstubAllGlobals());

describe('browser-only bounded sources', () => {
  it('reads Blob slices without reading the whole file or uploading it', async () => {
    vi.stubGlobal('Blob', NodeBlob);
    const blob = new Blob([new Uint8Array(4 * 1024 * 1024)]);
    const whole = vi.spyOn(blob, 'arrayBuffer').mockRejectedValue(new Error('whole-file read'));
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const source = createBrowserMediaSource(blob);
    expect((await source.read(10, 30)).length).toBe(20);
    expect(whole).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    await expect(source.read(0, 1024 * 1024 + 1)).rejects.toThrow(/budget/i);
    source.close(); await expect(source.read(0, 1)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('preserves byte-view offsets and caller ownership', async () => {
    const bytes = new Uint8Array([9, 1, 2, 8]);
    const source = createBrowserMediaSource(bytes.subarray(1, 3));
    expect([...await source.read(0, 2)]).toEqual([1, 2]);
    source.close(); expect([...bytes]).toEqual([9, 1, 2, 8]);
  });

  it('rejects ignored Range before consuming a potentially huge response', async () => {
    const response = new Response(new Uint8Array(10));
    const cancel = vi.spyOn(response.body!, 'cancel');
    const getReader = vi.spyOn(response.body!, 'getReader');
    const fetch = vi.fn(async () => response);
    const source = createBrowserMediaSource('/video.mp4', { fetch });
    await expect(source.read(0, 8)).rejects.toThrow(/Range/);
    expect(getReader).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalled();
    expect(fetch.mock.calls[0]).toMatchObject(['/video.mp4', { headers: { Range: 'bytes=0-7' } }]);
  });

  it('checks resource revision across bounded HTTP reads', async () => {
    let revision = 0;
    const fetch = vi.fn(async () => new Response(new Uint8Array(8), { status: 206,
      headers: { 'Content-Range': 'bytes 0-7/100', ETag: String(++revision) } }));
    const source = createBrowserMediaSource('/video.mp4', { fetch });
    expect((await source.read(0, 8)).length).toBe(8);
    await expect(source.read(0, 8)).rejects.toThrow(/changed/);
    source.close();
  });

  it('aborts borrowed P2P reads without closing the host transport', async () => {
    let active!: AbortSignal;
    const close = vi.fn();
    const source = createBrowserMediaSource({ identity: 'p2p', size: 100, close,
      read: (_start, _end, signal) => new Promise((_resolve, reject) => {
        active = signal!; signal!.addEventListener('abort', () => reject(signal!.reason), { once: true });
      }) });
    const pending = source.read(0, 8); source.close();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(active.aborted).toBe(true); expect(close).not.toHaveBeenCalled();
  });

  it('rejects excessive HTTP body output and cleans up the reader', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(9)); }, cancel });
    const fetch = vi.fn(async () => new Response(body, { status: 206, headers: { 'Content-Range': 'bytes 0-7/100' } }));
    await expect(createBrowserMediaSource('/movie', { fetch }).read(0, 8)).rejects.toThrow(/length/);
    expect(cancel).toHaveBeenCalled();
  });
});
