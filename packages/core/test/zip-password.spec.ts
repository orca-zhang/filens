// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ZipWriter, Uint8ArrayWriter, TextReader } from '@zip.js/zip.js/lib/zip-core-native.js';
import { openZipArchive } from '../src/parser/zip';
import { openUnencryptedZipArchive } from '../src/parser/zip-reader';

describe('encrypted ZIP entries', () => {
  it.each([true, false])('lists and retries independent entry passwords (ZipCrypto: %s)', async zipCrypto => {
    const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false });
    await writer.add('first.txt', new TextReader('First encrypted attachment'), { password: ' first 密码🔐 ', zipCrypto });
    await writer.add('second.txt', new TextReader('Different password'), { password: 'second', zipCrypto });
    await writer.add('public.txt', new TextReader('Public entry'));
    const bytes = await writer.close();
    await expect(openUnencryptedZipArchive(bytes)).rejects.toMatchObject({ code: 'password_required' });
    const zip = await openZipArchive(bytes);
    expect([...zip.keys()]).toEqual(['first.txt', 'second.txt', 'public.txt']);
    const first = zip.get('first.txt')!;
    expect(first.encrypted).toBe(true);
    await expect(first.bytes()).rejects.toMatchObject({ code: 'password_required' });
    await expect(first.bytes('wrong')).rejects.toMatchObject({ code: 'password_invalid' });
    expect(new TextDecoder().decode(await first.bytes(' first 密码🔐 '))).toBe('First encrypted attachment');
    await expect(zip.get('second.txt')!.bytes(' first 密码🔐 ')).rejects.toMatchObject({ code: 'password_invalid' });
    expect(new TextDecoder().decode(await zip.get('second.txt')!.bytes('second'))).toBe('Different password');
    await expect(zip.get('public.txt')!.text()).resolves.toBe('Public entry');
  });

  it('accepts a supplied password, enforces entry limits and observes abort', async () => {
    const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false });
    await writer.add('secret.txt', new TextReader('A secret attachment'), { password: 'secret' });
    const bytes = await writer.close();
    const zip = await openZipArchive(bytes, { password: 'secret' });
    await expect(zip.get('secret.txt')!.text()).resolves.toBe('A secret attachment');
    const limited = await openZipArchive(bytes, { password: 'secret', maxEntryBytes: 4 });
    await expect(limited.get('secret.txt')!.bytes()).rejects.toThrow('size limit');
    const controller = new AbortController();
    const cancelled = await openZipArchive(bytes, { password: 'secret', signal: controller.signal });
    controller.abort();
    await expect(cancelled.get('secret.txt')!.bytes()).rejects.toMatchObject({ name: 'AbortError' });
  });
});
