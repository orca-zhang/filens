import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PdfPageCache, pdfContentKey, pdfPageKey } from '../src/page-cache';

const cache = new PdfPageCache();
const drawImage = vi.fn();
const canvas = (width = 400, height = 600) => {
  const value = document.createElement('canvas');
  value.width = width; value.height = height;
  return value;
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('crypto', webcrypto);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as never);
  drawImage.mockClear();
});
afterEach(() => { cache.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('recent PDF first-page pixels', () => {
  it('keys the complete byte content, preserving caller ownership and ignoring filenames', async () => {
    const first = new Uint8Array([37, 80, 68, 70, 1]);
    const key = await pdfContentKey(first);
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(await pdfContentKey(first.slice())).toBe(key);
    expect(await pdfContentKey(new Uint8Array([37, 80, 68, 70, 2]))).not.toBe(key);
    expect(first).toEqual(new Uint8Array([37, 80, 68, 70, 1]));
  });

  it('does not cache password opens, mutable URL sources or failed digests', async () => {
    expect(await pdfContentKey(new Uint8Array([1]), 'secret')).toBeUndefined();
    expect(await pdfContentKey(new Uint8Array([1]), '')).toBeUndefined();
    expect(await pdfContentKey('https://example.test/file.pdf')).toBeUndefined();
    vi.stubGlobal('crypto', { subtle: { digest: () => Promise.reject(new Error('unavailable')) } });
    expect(await pdfContentKey(new Uint8Array([1]))).toBeUndefined();
    vi.stubGlobal('crypto', {});
    expect(await pdfContentKey(new Uint8Array([1]))).toBeUndefined();
  });

  it('separates exact CSS viewports and backing resolutions', () => {
    const target = canvas();
    const key = pdfPageKey('content', { width: 400, height: 600 }, target);
    expect(pdfPageKey('other', { width: 400, height: 600 }, target)).not.toBe(key);
    expect(pdfPageKey('content', { width: 400.1, height: 600 }, target)).not.toBe(key);
    expect(pdfPageKey('content', { width: 400, height: 600 }, canvas(800, 1200))).not.toBe(key);
    expect(pdfPageKey(undefined, { width: 400, height: 600 }, target)).toBeUndefined();
  });

  it('owns a pixel copy after the live page is cleared and rejects mismatched target sizes', () => {
    const source = canvas();
    cache.write('page', source);
    expect(drawImage).toHaveBeenLastCalledWith(source, 0, 0);
    source.width = source.height = 0;
    expect(cache.read('page', canvas(800, 1200))).toBe(false);
    expect(cache.read('page', canvas())).toBe(true);
    const retained = drawImage.mock.calls.at(-1)![0] as HTMLCanvasElement;
    expect(retained).not.toBe(source);
    expect([retained.width, retained.height]).toEqual([400, 600]);
    cache.clear();
    expect([retained.width, retained.height]).toEqual([0, 0]);
  });

  it('evicts the least recently used page at the entry and pixel-byte bounds', () => {
    for (let i = 0; i < 4; i++) cache.write(String(i), canvas(1024, 1024));
    expect(cache.read('0', canvas(1024, 1024))).toBe(true);
    cache.write('4', canvas(1024, 1024));
    expect(cache.read('1', canvas(1024, 1024))).toBe(false);
    expect(cache.read('0', canvas(1024, 1024))).toBe(true);
    cache.write('large', canvas(2048, 2048));
    expect(cache.read('0', canvas(1024, 1024))).toBe(false);
    expect(cache.read('4', canvas(1024, 1024))).toBe(false);
    expect(cache.read('large', canvas(2048, 2048))).toBe(true);
    cache.write('too-large', canvas(2048, 2049));
    expect(cache.read('too-large', canvas(2048, 2049))).toBe(false);
    expect(cache.read('large', canvas(2048, 2048))).toBe(true);
  });

  it('expires pixel buffers 30 seconds after their most recent use', () => {
    cache.write('page', canvas());
    vi.advanceTimersByTime(29_999);
    expect(cache.read('page', canvas())).toBe(true);
    const retained = drawImage.mock.calls.at(-1)![0] as HTMLCanvasElement;
    vi.advanceTimersByTime(29_999);
    expect(retained.width).toBe(400);
    vi.advanceTimersByTime(1);
    expect(retained.width).toBe(0);
    expect(cache.read('page', canvas())).toBe(false);
  });

  it('clears retained pixels when the page is hidden or unloaded', () => {
    cache.write('page', canvas());
    expect(cache.read('page', canvas())).toBe(true);
    const retained = drawImage.mock.calls.at(-1)![0] as HTMLCanvasElement;
    window.dispatchEvent(new Event('pagehide'));
    expect(cache.read('page', canvas())).toBe(false);
    expect(retained.width).toBe(0);
    cache.write('again', canvas());
    window.dispatchEvent(new Event('pagehide'));
    expect(cache.read('again', canvas())).toBe(false);
  });

  it('falls back to rendering when copying is unavailable or fails', () => {
    drawImage.mockImplementationOnce(() => { throw new Error('copy failed'); });
    cache.write('page', canvas());
    expect(cache.read('page', canvas())).toBe(false);
    cache.write('page', canvas());
    drawImage.mockImplementationOnce(() => { throw new Error('context lost'); });
    expect(cache.read('page', canvas())).toBe(false);
    expect(cache.read('page', canvas())).toBe(false);
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    cache.write('missing', canvas());
    expect(cache.read('missing', canvas())).toBe(false);
  });
});
