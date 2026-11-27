import { describe, expect, it, vi } from 'vitest';
import { NumbersPreviewMedia } from '../src/worker/numbers-media';
import type { ParsedNumbersSheet } from '../src/types';

describe('Numbers preview media', () => {
  it('retries failed media and publishes only the bytes of each ZIP member once', async () => {
    const member = Uint8Array.of(0, 1, 2, 3).subarray(1, 3);
    const bytes = vi.fn().mockRejectedValueOnce(new Error('Interrupted read')).mockResolvedValue(member);
    const asset = { id: '1', contentType: 'image/png', path: 'Data/First.png' };
    const archive = new Map([['1', { asset, file: { name: asset.path, directory: false, bytes, text: async () => '' } }]]);
    const loader = new NumbersPreviewMedia(archive);
    const sheet = { canvas: { slide: { background: { type: 'picture', mediaId: '1' }, items: [] } }, tables: [] } as unknown as ParsedNumbersSheet;
    const post = vi.fn();
    await expect(loader.publish([sheet], post)).rejects.toThrow('Interrupted read');
    expect(post).not.toHaveBeenCalled();

    await loader.publish([sheet], post);
    const data: Uint8Array = post.mock.calls[0][0]['1'].data;
    expect([...data]).toEqual([1, 2]);
    expect(data.buffer.byteLength).toBe(data.byteLength);
    await loader.publish([sheet], post);
    expect(post).toHaveBeenLastCalledWith({});
    expect(bytes).toHaveBeenCalledTimes(2);
  });
});
