import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodePreviewText, readPreviewText } from '../src/preview/text-source';
afterEach(() => vi.unstubAllGlobals());

describe('text preview decoding', () => {
  it.each(['utf-16le', 'utf-16be'])('uses a %s BOM before a conflicting MIME charset', encoding => {
    const text = '中文\r\n🌙';
    const bytes = new Uint8Array(2 + text.length * 2), view = new DataView(bytes.buffer);
    view.setUint16(0, 0xfeff, encoding === 'utf-16le');
    for (let i = 0; i < text.length; i++) view.setUint16(2 + i * 2, text.charCodeAt(i), encoding === 'utf-16le');
    expect(decodePreviewText(bytes, 'text/plain;charset=utf-8')).toEqual({ text, encoding, warnings: [] });
  });
  it('honors an explicit legacy charset without guessing it for undeclared input', () => {
    expect(decodePreviewText(new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]), 'text/plain; charset="gb18030"'))
      .toEqual({ text: '中文', encoding: 'gb18030', warnings: [] });
    const invalid = decodePreviewText(new Uint8Array([0x63, 0x61, 0x66, 0xe9]));
    expect(invalid.text).toBe('caf�'); expect(invalid.warnings).toHaveLength(1);
    expect(decodePreviewText(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]), 'text/plain; charset=windows-1252').text).toBe('a');
  });
  it('keeps legitimate replacement characters and escape-containing logs without an invalid-byte warning', () => {
    const text = 'replacement �\n\u001b[31merror\u001b[0m';
    expect(decodePreviewText(new TextEncoder().encode(text))).toEqual({ text, encoding: 'utf-8', warnings: [] });
  });
  it('rejects binary data, unknown charsets and unsupported UTF-32 rather than displaying misleading text', () => {
    expect(() => decodePreviewText(new Uint8Array([65, 0, 66]))).toThrow('binary data');
    expect(() => decodePreviewText(new Uint8Array([1, 2, 3, 4]))).toThrow('binary data');
    expect(() => decodePreviewText(new Uint8Array([65]), 'text/plain;charset=made-up')).toThrow('Unsupported text encoding');
    expect(() => decodePreviewText(new Uint8Array([0xff, 0xfe, 0, 0, 65, 0, 0, 0]))).toThrow('UTF-32');
  });
  it('reads only a supplied byte view and uses HTTP charset metadata', async () => {
    const bytes = new Uint8Array([0, 0x63, 0x61, 0x66, 0xe9, 0]);
    const context = { descriptor: { contentType: 'text/plain;charset=windows-1252' } };
    expect((await readPreviewText(bytes.subarray(1, 5), context)).text).toBe('café');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(bytes.subarray(1, 5), { headers: { 'content-type': 'text/plain;charset=windows-1252' } })));
    expect((await readPreviewText('/legacy.txt', { descriptor: { contentType: 'text/plain' } })).text).toBe('café');
  });
  it('decodes standard data URLs, including byte-encoded UTF-16 and percent-escaped UTF-8', async () => {
    expect((await readPreviewText('data:text/plain;charset=utf-16le;base64,//5BAGIA', { descriptor: {} })).text).toBe('Ab');
    expect((await readPreviewText('data:text/plain,%E4%B8%AD%E6%96%87', { descriptor: {} })).text).toBe('中文');
  });
});
