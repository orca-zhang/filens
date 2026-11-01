import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createWasmConverterClient } from '../src';
import type { ConverterClient } from '@filens/core';

const password = ' filens 密码🔐 ';
let client: ConverterClient;
let combinedClient: ConverterClient;
let coreWasm: Uint8Array;
let officeWasm: Uint8Array;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
beforeAll(async () => {
  coreWasm = new Uint8Array(await readFile(path.join(root, 'wasm/converter-core/dist/converter-core.wasm')));
  officeWasm = new Uint8Array(await readFile(path.join(root, 'wasm/converter-core/dist/converter-office.wasm')));
  client = createWasmConverterClient({ wasm: coreWasm, officeWasm });
  combinedClient = createWasmConverterClient({ wasm: new Uint8Array(await readFile(path.join(root, 'wasm/converter-core/dist/converter-core-full.wasm'))) });
});

async function convertFixture(converter: ConverterClient, fixture: string, sourceFormat: string, targetFormat: string, suppliedPassword?: string) {
  const source = new Uint8Array(await readFile(path.join(root, 'packages/converter-client/test/fixtures/password', fixture)));
  return converter.convert({ source, sourceFormat, targetFormat, password: suppliedPassword }, { descriptor: { source, name: fixture } });
}

async function encryptedRequest() {
  const source = new Uint8Array(await readFile(path.join(root, 'packages/converter-client/test/fixtures/password/agile.docx')));
  return { source, sourceFormat: 'docx', targetFormat: 'docx', password };
}

describe('optional Office WASM loading', () => {
  it('also supports the combined core without loading an addon', async () => {
    const load = vi.fn(() => { throw new Error('Combined core requested the Office addon'); });
    const full = new Uint8Array(await readFile(path.join(root, 'wasm/converter-core/dist/converter-core-full.wasm')));
    const combined = createWasmConverterClient({ wasm: full, officeWasm: load });
    const request = await encryptedRequest();
    const context = { descriptor: { source: request.source } };
    await expect(combined.convert({ ...request, password: 'wrong' }, context)).rejects.toMatchObject({ result: { errorCode: 'password_invalid' } });
    expect((await combined.convert(request, context)).format).toBe('docx');
    expect(load).not.toHaveBeenCalled();
  });

  it('skips ordinary documents and password prompts, shares a concurrent load and reuses it after a wrong password', async () => {
    const load = vi.fn(() => officeWasm);
    const split = createWasmConverterClient({ wasm: coreWasm, officeWasm: load });
    const plain = { source: new TextEncoder().encode('Ordinary document'), sourceFormat: 'txt', targetFormat: 'docx' };
    await split.convert(plain, { descriptor: { source: plain.source } });
    const request = await encryptedRequest();
    const context = { descriptor: { source: request.source } };
    await expect(split.convert({ ...request, password: undefined }, context)).rejects.toMatchObject({ result: { errorCode: 'password_required' } });
    expect(load).not.toHaveBeenCalled();
    await Promise.all([1, 2].map(() => expect(split.convert({ ...request, password: 'wrong' }, context))
      .rejects.toMatchObject({ result: { errorCode: 'password_invalid' } })));
    const result = await split.convert(request, context);
    expect((await JSZip.loadAsync(result.source as Uint8Array)).file('word/document.xml')).not.toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reports an unavailable engine when the optional module is omitted', async () => {
    const split = createWasmConverterClient({ wasm: coreWasm });
    const request = await encryptedRequest();
    await expect(split.convert(request, { descriptor: { source: request.source } })).rejects.toMatchObject({
      result: { errorCode: 'engine_unavailable', requiredModule: 'office' }
    });
  });

  it('retries a failed optional module download', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('Network unavailable')).mockResolvedValue(officeWasm);
    const split = createWasmConverterClient({ wasm: coreWasm, officeWasm: load });
    const request = await encryptedRequest();
    const context = { descriptor: { source: request.source } };
    await expect(split.convert(request, context)).rejects.toThrow('Network unavailable');
    expect((await split.convert(request, context)).format).toBe('docx');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('cancels while loading Office WASM without breaking a later conversion', async () => {
    let finish!: (bytes: Uint8Array) => void;
    let started!: () => void;
    const loading = new Promise<void>(resolve => { started = resolve; });
    const load = vi.fn(() => { started(); return new Promise<Uint8Array>(resolve => { finish = resolve; }); });
    const split = createWasmConverterClient({ wasm: coreWasm, officeWasm: load });
    const request = await encryptedRequest();
    const context = { descriptor: { source: request.source } };
    const controller = new AbortController();
    const conversion = split.convert(request, { ...context, signal: controller.signal });
    const rejected = expect(conversion).rejects.toMatchObject({ name: 'AbortError' });
    await loading;
    controller.abort();
    await rejected;
    finish(officeWasm);
    expect((await split.convert(request, context)).format).toBe('docx');
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe.each(['split', 'combined'])('Office document decryption in the %s WASM core', build => {
  const convert = (fixture: string, source: string, target: string, password?: string) =>
    convertFixture(build === 'combined' ? combinedClient : client, fixture, source, target, password);
  it.each([
    ['docx', 'word/document.xml', 'Fixture DOCX document'],
    ['xlsx', 'xl/worksheets/sheet1.xml', 'Fixture XLSX workbook'],
    ['pptx', 'ppt/slides/slide1.xml', 'Fixture PPTX presentation slide']
  ])('opens an independently encrypted %s, distinguishing missing and wrong passwords', async (format, part, text) => {
    await expect(convert(`agile.${format}`, format, format)).rejects.toMatchObject({ result: { errorCode: 'password_required' } });
    await expect(convert(`agile.${format}`, format, format, 'wrong')).rejects.toMatchObject({ result: { errorCode: 'password_invalid' } });
    const result = await convert(`agile.${format}`, format, format, password);
    const zip = await JSZip.loadAsync(result.source as Uint8Array);
    expect(await zip.file(part)?.async('string')).toContain(text);
    expect(result.format).toBe(format);
    expect(zip.file('vbaProject.bin')).toBeNull();
  });

  it.each([['docx', 'docm'], ['xlsx', 'xlsm'], ['pptx', 'pptm']])('decrypts a %s envelope through its %s conversion route', async (target, source) => {
    const result = await convert(`agile.${target}`, source, target, password);
    expect(result.format).toBe(target);
    expect((result.source as Uint8Array).slice(0, 2)).toEqual(new Uint8Array([80, 75]));
  });

  it('rejects damaged ciphertext as a document error after a correct password', async () => {
    await expect(convert('tampered.docx', 'docx', 'docx', password)).rejects.toMatchObject({ result: { errorCode: 'parse_error' } });
  });

  it.each([
    ['ecma376standard_password.docx', 'docx', 'docx', 'word/document.xml', 'Password1234_'],
    ['rc4cryptoapi_password.doc', 'doc', 'docx', 'word/document.xml', 'Password1234_'],
    ['rc4cryptoapi_password.xls', 'xls', 'xlsx', 'xl/worksheets/sheet1.xml', 'Password1234_'],
    ['rc4cryptoapi_password.ppt', 'ppt', 'pptx', 'ppt/slides/slide1.xml', 'Password1234_'],
    ['xor_password_123456789012345.xls', 'xls', 'xlsx', 'xl/worksheets/sheet1.xml', '123456789012345']
  ])('opens the upstream reference %s', async (fixture, source, target, part, key) => {
    await expect(convert(`reference/${fixture}`, source, target)).rejects.toMatchObject({ result: { errorCode: 'password_required' } });
    await expect(convert(`reference/${fixture}`, source, target, 'wrong')).rejects.toMatchObject({ result: { errorCode: 'password_invalid' } });
    const result = await convert(`reference/${fixture}`, source, target, key);
    const zip = await JSZip.loadAsync(result.source as Uint8Array);
    expect(await zip.file(part)?.async('string')).toContain('<?xml');
  });
});
