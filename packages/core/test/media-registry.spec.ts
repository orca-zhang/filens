import { Blob as NodeBlob, Buffer } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MediaRegistry } from '../src/render/dom';
import type { ParsedPresentation } from '../src/types';
import { createMultipageTiff } from './fixtures/multipage-tiff.mjs';

const nativeBase64 = Object.getOwnPropertyDescriptor(Uint8Array.prototype, 'toBase64');
afterEach(() => {
  vi.unstubAllGlobals();
  if (nativeBase64) Object.defineProperty(Uint8Array.prototype, 'toBase64', nativeBase64);
});

function registry(data: Uint8Array, contentType = 'application/octet-stream') {
  const presentation: ParsedPresentation = {
    size: { width: 1, height: 1 }, theme: { colors: {}, fonts: {} }, slides: [], warnings: [],
    media: { image: { id: 'image', path: 'image.bin', contentType, data } }
  };
  return new MediaRegistry(presentation);
}

describe('MediaRegistry binary URLs', () => {
  it('renders the first TIFF page and ignores a corrupt unused page', () => {
    const { bytes, firstPage, width, height } = createMultipageTiff(3, 8, 8);
    // The final page has a broken Adler checksum; it is outside this preview.
    bytes[bytes.length - 1] ^= 1;
    const pixels = new Uint8ClampedArray(firstPage.length), put = vi.fn();
    const original = document.createElement.bind(document);
    const create = vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => tag === 'canvas' ? {
      width: 0, height: 0, getContext: () => ({ createImageData: (w: number, h: number) => {
        expect([w, h]).toEqual([width, height]); return { data: pixels };
      }, putImageData: put }), toDataURL: () => 'data:image/png;base64,first-page'
    } : original(tag)) as typeof document.createElement);
    const media = registry(bytes, 'image/tiff');
    try {
      expect(media.getUrl('image')).toBe('data:image/png;base64,first-page');
      expect(new Uint8Array(pixels)).toEqual(firstPage);
      expect(put).toHaveBeenCalledTimes(1);
      expect(media.getUrl('image')).toBe('data:image/png;base64,first-page');
      expect(put).toHaveBeenCalledTimes(1);
    } finally { create.mockRestore(); media.destroy(); }
  });

  it.each([false, true])('snapshots exactly the media view and releases cached URLs (shared buffer: %s)', async shared => {
    const buffer = shared ? new SharedArrayBuffer(8) : new ArrayBuffer(8);
    const bytes = new Uint8Array(buffer);
    bytes.set([99, 98, 0, 127, 128, 255, 97, 96]);
    let captured!: NodeBlob;
    const create = vi.fn((blob: NodeBlob) => { captured = blob; return 'blob:media-test'; });
    const revoke = vi.fn();
    vi.stubGlobal('Blob', NodeBlob);
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
    const media = registry(bytes.subarray(2, 6));
    try {
      expect(media.getUrl('image')).toBe('blob:media-test');
      bytes.fill(42);
      expect(new Uint8Array(await captured.arrayBuffer())).toEqual(new Uint8Array([0, 127, 128, 255]));
      expect(captured.type).toBe('application/octet-stream');
      expect(media.getUrl('image')).toBe('blob:media-test');
      expect(media.getUrl('missing')).toBe('');
      expect(create).toHaveBeenCalledTimes(1);
      media.destroy(); media.destroy();
      expect(revoke).toHaveBeenCalledTimes(1);
      expect(revoke).toHaveBeenCalledWith('blob:media-test');
    } finally { media.destroy(); }
  });

  it.each([0, 1, 2, 3, 32767, 32768, 32769, 131077])('preserves all bytes in browser Base64 fallback (%i bytes)', length => {
    const bytes = Uint8Array.from({ length: length + 7 }, (_, index) => index % 256);
    const view = bytes.subarray(3, length + 3);
    const expected = `data:application/octet-stream;base64,${Buffer.from(view).toString('base64')}`;
    vi.stubGlobal('URL', {});
    vi.stubGlobal('Buffer', undefined);
    Reflect.deleteProperty(Uint8Array.prototype, 'toBase64');
    const media = registry(view);
    try {
      expect(media.getUrl('image')).toBe(expected);
      expect(media.getUrl('image')).toBe(expected);
    } finally { media.destroy(); }
  });

  it('preserves subarray boundaries with the Node Base64 fallback', () => {
    vi.stubGlobal('URL', {});
    Reflect.deleteProperty(Uint8Array.prototype, 'toBase64');
    const media = registry(new Uint8Array([99, 0, 128, 255, 98]).subarray(1, 4));
    try { expect(media.getUrl('image')).toBe('data:application/octet-stream;base64,AID/'); }
    finally { media.destroy(); }
  });
});
