import { webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { estimatePreviewModelBytes, PreviewModelCache, previewContentKey, snapshotPreviewBytes } from '../src/preview/model-cache';

const caches: PreviewModelCache[] = [];
const cache = () => { const value = new PreviewModelCache({ maxBytes: 1000, maxEntries: 2, idleMs: 100 }); caches.push(value); return value; };
afterEach(() => { caches.splice(0).forEach(value => value.clear()); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('preview model cache boundaries', () => {
  it('preserves the browser structuredClone receiver on both writes and reads', () => {
    const native = globalThis.structuredClone;
    vi.stubGlobal('structuredClone', function(this: unknown, model: unknown) {
      if (this !== globalThis) throw new TypeError('Illegal invocation');
      return native(model);
    });
    const value = cache(); value.put('a', { value: 1 }, { bytes: 100 }); expect(value.get('a')).toEqual({ value: 1 });
  });
  it('isolates both the saved input and every reader, including typed buffers and aliases', () => {
    const value = cache(), font = { family: 'Test' }, source = { fonts: [font], cell: { font }, bytes: new Uint8Array([1, 2]) };
    value.put('a', source, { bytes: 200 }); source.cell.font.family = 'Modified'; source.bytes.fill(0);
    const first = value.get<typeof source>('a')!;
    expect(first.cell.font.family).toBe('Test'); expect(first.cell.font).toBe(first.fonts[0]);
    first.cell.font.family = 'Tab 1'; first.bytes.fill(9);
    const second = value.get<typeof source>('a')!;
    expect(second.cell.font.family).toBe('Test'); expect([...second.bytes]).toEqual([1, 2]);
  });
  it('evicts the least recently used entry and enforces the combined byte budget', () => {
    const value = cache(); value.put('a', {}, { bytes: 400 }); value.put('b', {}, { bytes: 400 }); value.get('a');
    value.put('c', {}, { bytes: 500 }); expect(value.get('b')).toBeUndefined(); expect(value.get('a')).toEqual({});
    expect(value.accountedBytes).toBe(900);
    value.put('large', {}, { bytes: 1001 }); value.put('invalid', {}, { bytes: Infinity }); expect(value.size).toBe(2);
  });
  it('expires idle entries, refreshes a hit, and releases everything on pagehide', () => {
    vi.useFakeTimers(); const value = cache(); value.put('a', {}, { bytes: 100 });
    vi.advanceTimersByTime(80); expect(value.get('a')).toEqual({});
    vi.advanceTimersByTime(80); expect(value.size).toBe(1);
    vi.advanceTimersByTime(21); expect(value.get('a')).toBeUndefined(); expect(value.accountedBytes).toBe(0);
    value.put('b', {}, { bytes: 100 }); window.dispatchEvent(new Event('pagehide'));
    expect(value.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
  it('checks the deadline even when the event loop has not delivered an expiration timer', () => {
    vi.useFakeTimers(); const value = cache(); value.put('a', {}, { bytes: 100 });
    vi.setSystemTime(Date.now() + 101); expect(value.get('a')).toBeUndefined();
  });
  it('rejects uncloneable and oversized models without changing existing entries', () => {
    const value = cache(); value.put('a', {}, { bytes: 100 });
    value.put('b', { fn() {} }); value.put('c', new Uint8Array(2000));
    expect(value.size).toBe(1); expect(estimatePreviewModelBytes({ fn() {} })).toBe(Infinity);
    const cyclic: any = { bytes: new Uint8Array(100) }; cyclic.self = cyclic;
    expect(estimatePreviewModelBytes(cyclic)).toBeLessThan(1000);
  });
  it('hashes the full byte view and namespace, snapshots borrowed bytes, and respects abort', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const borrowed = new Uint8Array([9, 1, 2, 8]), pending = snapshotPreviewBytes(borrowed.subarray(1, 3)); borrowed.fill(0);
    const owned = (await pending)!; expect([...owned]).toEqual([1, 2]);
    const key = await previewContentKey(owned, 'xlsx');
    expect(await previewContentKey(new Uint8Array([1, 3]), 'xlsx')).not.toBe(key);
    expect(await previewContentKey(owned, 'iwork')).not.toBe(key);
    const controller = new AbortController(); controller.abort();
    await expect(previewContentKey(owned, 'xlsx', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
