// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { sourceToBytes } from '../src/source';

describe('bounded media source reads', () => {
  it('rejects oversized in-memory input before reading a Blob', async () => {
    const blob = new Blob([new Uint8Array(5)]), read = vi.spyOn(blob, 'arrayBuffer');
    await expect(sourceToBytes(blob, undefined, undefined, 4)).rejects.toThrow('byte limit');
    expect(read).not.toHaveBeenCalled();
    await expect(sourceToBytes(new Uint8Array(5), undefined, undefined, 4)).rejects.toThrow('byte limit');
    await expect(sourceToBytes('data:;base64,AQIDBAU=', undefined, undefined, 4)).rejects.toThrow('byte limit');
  });

  it.each([undefined, '1'])('bounds streamed downloads with absent or incorrect Content-Length: %s', async length => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(3)); }, cancel }), {
      headers: length ? { 'Content-Length': length } : {}
    });
    const fetch = vi.fn(async () => response) as unknown as typeof globalThis.fetch;
    await expect(sourceToBytes('https://example.test/photo.heic', fetch, undefined, 4)).rejects.toThrow('byte limit');
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body!.locked).toBe(false);
  });

  it('cancels an over-budget response before reading its body', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), { headers: { 'Content-Length': '99' } });
    const read = vi.spyOn(response, 'arrayBuffer');
    await expect(sourceToBytes('/photo.heic', vi.fn(async () => response), undefined, 4)).rejects.toThrow('byte limit');
    expect(read).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledOnce();
  });

  it('cancels a pending reader on abort and releases its lock', async () => {
    const controller = new AbortController(), cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }));
    const pending = sourceToBytes('/photo.heic', vi.fn(async () => response), controller.signal, 4);
    await vi.waitFor(() => expect(response.body!.locked).toBe(true));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancel).toHaveBeenCalledOnce(); expect(response.body!.locked).toBe(false);
  });

  it('accepts a download exactly at the limit', async () => {
    const fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4])));
    expect([...await sourceToBytes('/photo.heic', fetch, undefined, 4)]).toEqual([1, 2, 3, 4]);
  });
});
