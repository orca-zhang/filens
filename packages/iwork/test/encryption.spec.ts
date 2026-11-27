// @vitest-environment node
import { createCipheriv, createHash, pbkdf2Sync, randomBytes } from 'node:crypto';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { detectIworkType, loadIwork } from '../src';
import { readFixture, repackageIworkFixture } from './helpers';
import { createModernNumbersArchive, frameIwa } from './fixtures/numbers-archive.mjs';

const readEncryptedNumbers = () => readFixture('test/fixtures/password/encrypted-non-latin.numbers');
const options = { password: '秘密' };

async function encryptFixture(source: Uint8Array): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(source);
  const salt = randomBytes(16), iv = randomBytes(16);
  const key = pbkdf2Sync(options.password, salt, 100_000, 16, 'sha1');
  const encrypt = (data: Uint8Array, iv: Uint8Array, pad = true) => {
    const cipher = createCipheriv('aes-128-cbc', key, iv).setAutoPadding(pad);
    return Buffer.concat([cipher.update(data), cipher.final()]);
  };
  const prefix = Buffer.alloc(8);
  prefix.writeUInt16LE(2, 0);
  prefix.writeUInt16LE(1, 2);
  prefix.writeUInt32LE(100_000, 4);
  const challenge = randomBytes(32);
  const digest = createHash('sha256').update(challenge).digest();
  zip.file('.iwpv2', Buffer.concat([prefix, salt, iv, encrypt(Buffer.concat([challenge, digest]), iv, false)]));
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !(entry.name.endsWith('.iwa') || entry.name.startsWith('Data/') || entry.name === 'Metadata/BuildVersionHistory.plist')) continue;
    const entryIv = randomBytes(16);
    const data = Buffer.concat([randomBytes(16), await entry.async('uint8array')]);
    zip.file(entry.name, Buffer.concat([entryIv, encrypt(data, entryIv), randomBytes(20)]));
  }
  return zip.generateAsync({ type: 'uint8array' });
}

describe('iWork package encryption', () => {
  it('requires a password and uses it for unnamed Numbers detection and content', async () => {
    const source = await readEncryptedNumbers();
    await expect(loadIwork(source, { hint: 'numbers' })).rejects.toMatchObject({ code: 'password_required' });
    await expect(detectIworkType(source)).rejects.toMatchObject({ code: 'password_required' });
    await expect(loadIwork(source, { password: 'wrong' })).rejects.toMatchObject({ code: 'password_invalid' });
    await expect(loadIwork(source, { password: '' })).rejects.toMatchObject({ code: 'password_invalid' });
    await expect(detectIworkType(source, options)).resolves.toBe('numbers');
    const document = await loadIwork(source, options);
    expect(document.kind).toBe('numbers');
    if (document.kind !== 'numbers') throw new Error('Expected a Numbers workbook');
    const cell = document.sheets[0].tables[0].item.cells.find(cell => cell.row === 0 && cell.column === 0);
    expect(cell?.textFrame.paragraphs.flatMap(paragraph => paragraph.runs.map(run => run.text)).join('')).toBe('Decryption');
  });

  it('uses the wrapper verifier for a nested index of encrypted IWA entries', async () => {
    const original = await readEncryptedNumbers();
    const source = await repackageIworkFixture(original, 'Workbook.numbers', true);
    await expect(detectIworkType(source)).rejects.toMatchObject({ code: 'password_required' });
    await expect(loadIwork(source, { password: 'wrong' })).rejects.toMatchObject({ code: 'password_invalid' });
    expect(await loadIwork(source, options)).toEqual(await loadIwork(original, options));
  });

  it.each(['pages', 'key'] as const)('parses an encrypted %s fixture and preserves its media bytes', async format => {
    const source = await readFixture(`vendor/iwork-converter/testdata/a.${format}`);
    const original = await loadIwork(source, { hint: format });
    const opened = await loadIwork(await encryptFixture(source), { ...options, hint: format });
    expect(opened.kind).toBe(format);
    if (opened.kind === 'numbers' || original.kind === 'numbers') throw new Error('Expected paged documents');
    expect(opened.kind === 'key' ? opened.slides.length : opened.pages.length).toBeGreaterThan(0);
    expect(Object.keys(opened.archive.records)).toEqual(Object.keys(original.archive.records));
    const media = Object.values(original.kind === 'key' ? original.presentation.media : original.media);
    const openedMedia = opened.kind === 'key' ? opened.presentation.media : opened.media;
    expect(media.length).toBeGreaterThan(0);
    expect(Object.keys(openedMedia)).toEqual(media.map(asset => asset.id));
    for (const asset of media) expect(Buffer.compare(openedMedia[asset.id].data, asset.data)).toBe(0);
  });

  it('opens encrypted packages without an optional hint and rejects a missing verifier', async () => {
    const zip = await JSZip.loadAsync(await readEncryptedNumbers());
    const hint = await zip.file('.iwph')!.async('uint8array');
    zip.remove('.iwph');
    await expect(loadIwork(await zip.generateAsync({ type: 'uint8array' }), options)).resolves.toMatchObject({ kind: 'numbers' });
    zip.file('.iwph', hint).remove('.iwpv2');
    await expect(loadIwork(await zip.generateAsync({ type: 'uint8array' }), options)).rejects.toThrow('verifier is missing');
  });

  it('decrypts a large stored IWA entry before reading its Snappy frames', async () => {
    const zip = await JSZip.loadAsync(await createModernNumbersArchive());
    const entry = zip.file('Index/Document.iwa')!;
    const frames = Buffer.concat([await entry.async('nodebuffer'), frameIwa([new Uint8Array([0]), randomBytes(300 * 1024)])]);
    zip.file(entry.name, frames);
    const source = new Blob([new Uint8Array(await encryptFixture(await zip.generateAsync({ type: 'uint8array' })))]);
    const document = await loadIwork(source, { ...options, hint: 'numbers' });
    expect(document.kind).toBe('numbers');
    if (document.kind === 'numbers') expect(document.sheets[0].tables[0].item.cells).toHaveLength(2095);
  });

  it.each([
    ['a truncated verifier', '.iwpv2', new Uint8Array(103), 'verifier is damaged'],
    ['an unsupported verifier', '.iwpv2', new Uint8Array(104), 'encryption format is unsupported'],
    ['an excessive key derivation count', '.iwpv2', new Uint8Array([2, 0, 1, 0, 0xff, 0xff, 0xff, 0xff, ...new Uint8Array(96)]), 'derivation count is outside'],
    ['a truncated encrypted entry', 'Index/Document.iwa', new Uint8Array(60), 'entry is damaged']
  ] as const)('rejects %s as a format error', async (_name, path, payload, message) => {
    const zip = await JSZip.loadAsync(await readEncryptedNumbers());
    zip.file(path, payload);
    await expect(loadIwork(await zip.generateAsync({ type: 'uint8array' }), options)).rejects.toThrow(message);
  });
});
