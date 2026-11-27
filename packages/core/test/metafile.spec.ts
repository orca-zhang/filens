import { describe, expect, it } from 'vitest';
import { createMetafileDecoder } from '../src/render/metafile';
import { buildEmfPoster, buildWmfPoster } from './fixtures/metafile';

describe('metafile WebAssembly decoder', () => {
  it('paints EMF text and geometry and both WMF headers using the same decoder', async () => {
    const decoder = createMetafileDecoder();
    try {
      const svg = (data?: Uint8Array) => new TextDecoder().decode(data);
      const emf = svg(await decoder.render(buildEmfPoster()));
      expect(emf).toContain('Embedded EMF');
      expect(emf).toContain('#2255a0');
      const source = buildWmfPoster();
      const wmf = svg(await decoder.render(source));
      expect(wmf).toContain('viewBox="0 0 120 60"');
      expect(wmf).toContain('#31804b');
      expect(svg(await decoder.render(source.subarray(22)))).toContain('#31804b');
    } finally {
      decoder.destroy();
    }
  });

  it('rejects malformed or cancelled images while other requests can still render', async () => {
    const decoder = createMetafileDecoder();
    const abort = new AbortController();
    abort.abort();
    try {
      expect(await decoder.render(buildEmfPoster().slice(0, 88))).toBeUndefined();
      expect(await decoder.render(new Uint8Array(8 * 1024 * 1024 + 1))).toBeUndefined();
      expect(await createMetafileDecoder(abort.signal).render(buildWmfPoster())).toBeUndefined();
      expect(await decoder.render(buildWmfPoster())).toBeDefined();
    } finally {
      decoder.destroy();
    }
  });
});
