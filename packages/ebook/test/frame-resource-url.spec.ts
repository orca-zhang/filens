import { Blob as NodeBlob, Buffer as NodeBuffer } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFrameResourceUrl } from '../src/frame-resource-url';

const original = Object.getOwnPropertyDescriptor(Uint8Array.prototype, 'toBase64');
afterEach(() => {
  if (original) Object.defineProperty(Uint8Array.prototype, 'toBase64', original);
  else Reflect.deleteProperty(Uint8Array.prototype, 'toBase64');
  vi.unstubAllGlobals();
});

describe('chapter frame resource URLs', () => {
  it.each(['native', 'node', 'compatibility'])('preserves byte views and chunk boundaries using %s Base64', mode => {
    vi.stubGlobal('window', { origin: 'null' });
    const native = vi.fn(function (this: Uint8Array) {
      return NodeBuffer.from(this.buffer, this.byteOffset, this.byteLength).toString('base64');
    });
    Object.defineProperty(Uint8Array.prototype, 'toBase64', { configurable: true, value: mode === 'native' ? native : undefined });
    if (mode === 'compatibility') vi.stubGlobal('Buffer', undefined);
    const createUrl = vi.fn();
    for (const length of [0, 1, 2, 3, 32767, 32768, 32769, 65537]) {
      const storage = Uint8Array.from({ length: length + 8 }, (_, i) => i % 256);
      const view = storage.subarray(3, length + 3);
      expect(createFrameResourceUrl(view, 'image/png', createUrl))
        .toBe(`data:image/png;base64,${NodeBuffer.from(view).toString('base64')}`);
    }
    expect(native).toHaveBeenCalledTimes(mode === 'native' ? 8 : 0);
    expect(createUrl).not.toHaveBeenCalled();
  });

  it('encodes Unicode stylesheet strings in opaque frames as UTF-8', () => {
    vi.stubGlobal('window', { origin: 'null' });
    const text = '.标题{content:"中文😀"}';
    expect(createFrameResourceUrl(text, 'text/css', vi.fn())).toBe(`data:text/css;base64,${NodeBuffer.from(text).toString('base64')}`);
  });

  it.each([false, true])('snapshots exactly the view before later edits (shared: %s)', async shared => {
    vi.stubGlobal('Blob', NodeBlob);
    vi.stubGlobal('window', { origin: 'https://example.test' });
    const storage = new Uint8Array(shared ? new SharedArrayBuffer(6) : new ArrayBuffer(6));
    storage.set([99, 1, 2, 3, 4, 98]);
    let captured: Blob | undefined;
    expect(createFrameResourceUrl(storage.subarray(1, 5), 'image/png', blob => { captured = blob; return 'blob:frame'; })).toBe('blob:frame');
    storage.fill(9);
    expect(captured?.type).toBe('image/png');
    expect([...new Uint8Array(await captured!.arrayBuffer())]).toEqual([1, 2, 3, 4]);
  });
});
