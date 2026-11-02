// @vitest-environment node
import { readFile } from 'node:fs/promises';
import SevenZip from '7z-wasm';
import PreviewSevenZip from '../vendor/7zip/7zz.js';
import { runSevenZip, type SevenZipRequest } from '../src/sevenzip/runtime';

const defaults = { format: '7z' as const, maxEntries: 20_000, maxEntryBytes: 128 * 1024 * 1024 };
const run = (request: Partial<SevenZipRequest> & Pick<SevenZipRequest, 'bytes'>) => runSevenZip({ ...defaults, ...request }, PreviewSevenZip);
let plain: Uint8Array, encrypted: Uint8Array, headers: Uint8Array;
const payload = new TextEncoder().encode('A Unicode archive payload 文档 🔐');
const names = ['docs/色 图.txt', 'docs/other.txt', '@literal.txt', '-literal.txt', 'file[1].txt', 'file1.txt'];
beforeAll(async () => {
  const engine = await SevenZip({ print: () => {}, printErr: () => {} });
  engine.FS.mkdir('/data');
  engine.FS.chdir('/data');
  engine.FS.mkdir('docs');
  for (const name of names) engine.FS.writeFile(name, payload);
  engine.FS.mkdir('empty');
  engine.FS.writeFile('zero.txt', new Uint8Array());
  for (const [name, options] of [['plain', []], ['encrypted', ['-p secret 密码 ', '-mhe=off']], ['headers', ['-p secret 密码 ', '-mhe=on']]] as const) {
    engine.callMain(['a', `/${name}.7z`, '.', '-bd', ...options]);
  }
  plain = engine.FS.readFile('/plain.7z'); encrypted = engine.FS.readFile('/encrypted.7z'); headers = engine.FS.readFile('/headers.7z');
});

it('lists Unicode paths, directories and zero-byte files and extracts only literal names from a solid 7z', async () => {
  const { entries } = await run({ bytes: plain });
  expect(entries!.map(entry => entry.path)).toEqual(expect.arrayContaining([...names, 'empty', 'zero.txt']));
  expect(entries!.find(entry => entry.path === 'empty')?.directory).toBe(true);
  for (const name of names) {
    const entry = entries!.find(entry => entry.path === name)!;
    expect((await run({ bytes: plain, entry })).bytes).toEqual(payload);
  }
  expect((await run({ bytes: plain, entry: entries!.find(entry => entry.path === 'zero.txt') })).bytes).toEqual(new Uint8Array());
});

it('lists encrypted entries before prompting and validates each entry password', async () => {
  const entry = (await run({ bytes: encrypted })).entries!.find(entry => entry.path === names[0])!;
  expect(entry.encrypted).toBe(true);
  await expect(run({ bytes: encrypted, entry })).rejects.toMatchObject({ code: 'password_required' });
  await expect(run({ bytes: encrypted, entry, password: 'wrong' })).rejects.toMatchObject({ code: 'password_invalid' });
  expect((await run({ bytes: encrypted, entry, password: ' secret 密码 ' })).bytes).toEqual(payload);
});

it('unlocks encrypted 7z filenames and distinguishes a wrong password', async () => {
  await expect(run({ bytes: headers })).rejects.toMatchObject({ code: 'password_required' });
  await expect(run({ bytes: headers, password: 'wrong' })).rejects.toMatchObject({ code: 'password_invalid' });
  const entry = (await run({ bytes: headers, password: ' secret 密码 ' })).entries!.find(entry => !entry.directory)!;
  expect((await run({ bytes: headers, entry, password: ' secret 密码 ' })).bytes).toBeDefined();
});

for (const version of [4, 5]) for (const kind of ['encrypted', 'encrypted-filenames', 'solid-encrypted', 'solid-encrypted-filenames']) {
  it(`opens real RAR ${version} ${kind} archives with correct passwords`, async () => {
    const bytes = new Uint8Array(await readFile(new URL(`./fixtures/rar${version}-${kind}.rar`, import.meta.url)));
    const headerPassword = kind.includes('filenames') ? 'password' : undefined;
    if (headerPassword) {
      await expect(run({ bytes, format: 'rar' })).rejects.toMatchObject({ code: 'password_required' });
      await expect(run({ bytes, format: 'rar', password: 'wrong' })).rejects.toMatchObject({ code: 'password_invalid' });
    }
    const { entries } = await run({ bytes, format: 'rar', password: headerPassword });
    expect(entries!.map(entry => entry.path)).toEqual(['a.txt', 'b.txt', 'c.txt', 'd.txt']);
    const solid = kind.includes('solid');
    for (const entry of entries!) {
      const password = headerPassword ?? (solid || entry.path === 'b.txt' ? 'password' : entry.path === 'd.txt' ? 'password2' : undefined);
      if (entry.encrypted) await expect(run({ bytes, format: 'rar', entry, password: 'wrong' })).rejects.toMatchObject({ code: 'password_invalid' });
      const data = (await run({ bytes, format: 'rar', entry, password })).bytes!;
      expect(new TextDecoder().decode(data)).toBe(`This is from ${entry.path}`);
    }
  });
}

it('rejects corrupted archives without requesting a password and bounds metadata and extraction', async () => {
  await expect(run({ bytes: new Uint8Array([1, 2, 3]) })).rejects.toMatchObject({ code: undefined });
  await expect(run({ bytes: plain, maxEntries: 1 })).rejects.toThrow('too many');
  const entry = (await run({ bytes: plain })).entries!.find(entry => entry.path === names[0])!;
  await expect(run({ bytes: plain, entry, maxEntryBytes: 1 })).rejects.toThrow('size limit');
  await expect(run({ bytes: plain, entry: { ...entry, size: 1 } })).rejects.toThrow('size limit');
});

it.each(['7z', 'zip'] as const)('opens encrypted numbered %s volumes and rejects a missing tail', async format => {
  const password = format === '7z' ? ' secret 密码 ' : ' split secret ';
  const engine = await SevenZip({ print: () => {}, printErr: () => {} });
  engine.FS.writeFile('notes.txt', payload);
  engine.callMain(['a', `/split.${format}`, 'notes.txt', '-v80b', `-p${password}`, ...(format === '7z' ? ['-mhe=on'] : ['-mem=AES256']), '-bd']);
  const files = engine.FS.readdir('/').filter(name => name.startsWith(`split.${format}.`)).sort().map(name => ({ name, bytes: engine.FS.readFile(`/${name}`) }));
  expect(files.length).toBeGreaterThan(1);
  const input = { ...files[0], format, volumes: files.slice(1) };
  if (format === '7z') await expect(run(input)).rejects.toMatchObject({ code: 'password_required' });
  const { entries } = await run({ ...input, password });
  const entry = entries![0];
  await expect(run({ ...input, entry, password: 'wrong' })).rejects.toMatchObject({ code: 'password_invalid' });
  expect((await run({ ...input, entry, password })).bytes).toEqual(payload);
  await expect(run({ ...input, volumes: files.slice(1, -1), password })).rejects.toThrow('volumes');
});

for (const version of [4, 5]) {
  it(`reads actual RAR ${version} volumes together and detects missing tails`, async () => {
    const { readdir } = await import('node:fs/promises');
    const root = new URL('./fixtures/multivolume/', import.meta.url);
    const names = (await readdir(root)).filter(name => version === 4 ? name.startsWith('test_rar_') : name.startsWith('test_read_')).sort();
    const files = await Promise.all(names.map(async name => ({ name, bytes: new Uint8Array(await readFile(new URL(name, root))) })));
    const input = { ...files[0], format: 'rar' as const, volumes: files.slice(1) };
    const { entries } = await run(input);
    const entry = entries!.find(entry => entry.path === (version === 4 ? 'LibarchiveAddingTest.html' : 'elf-Linux-ARMv7-ls'))!;
    expect(entry).toBeDefined();
    const data = (await run({ ...input, entry })).bytes!;
    expect(data.length).toBe(entry.size);
    if (version === 4) expect(new TextDecoder().decode(data).toLowerCase()).toContain('<html');
    else expect([...data.subarray(0, 4)]).toEqual([0x7f, 0x45, 0x4c, 0x46]);
    await expect(run({ ...input, volumes: files.slice(1, -1) })).rejects.toThrow('volumes');
  });
}

it('opens legacy .rar/.r00 volumes without concatenating their RAR headers', async () => {
  const files = await Promise.all([1, 2, 3].map(async index => ({ name: index === 1 ? 'old.rar' : `old.r0${index - 2}`,
    bytes: new Uint8Array(await readFile(new URL(`./fixtures/multivolume/test_rar_multivolume_single_file.part${index}.rar`, import.meta.url))) })));
  const input = { ...files[0], format: 'rar' as const, volumes: files.slice(1) };
  const entry = (await run(input)).entries![0];
  expect((await run({ ...input, entry })).bytes!.length).toBe(entry.size);
});

it('opens traditional ZIP .z01/.zip volumes with offsets across disks', async () => {
  const bytes = new Uint8Array(await readFile(new URL('./fixtures/multivolume/classic.zip', import.meta.url)));
  const first = new Uint8Array(await readFile(new URL('./fixtures/multivolume/classic.z01', import.meta.url)));
  const input = { bytes, name: 'classic.zip', format: 'zip' as const, volumes: [{ name: 'classic.z01', bytes: first }] };
  const entry = (await run(input)).entries![0];
  expect((await run({ ...input, entry })).bytes).toEqual(Uint8Array.from({ length: 70000 }, (_, index) => index % 256));
});

it.each(['Copy', 'LZMA', 'LZMA2', 'PPMd', 'BZip2', 'Deflate', 'Deflate64'])('retains the %s decoder after removing archive writers', async method => {
  const generator = await SevenZip({ print: () => {}, printErr: () => {} });
  generator.FS.writeFile('/payload.txt', payload);
  expect(generator.callMain(['a', '/codecs.7z', '/payload.txt', `-m0=${method}`, '-bd'])).toBe(0);
  const bytes = generator.FS.readFile('/codecs.7z');
  const entry = (await run({ bytes })).entries![0];
  expect((await run({ bytes, entry })).bytes).toEqual(payload);
});

it.each(['BCJ', 'ARM', 'ARM64', 'ARMT', 'PPC', 'SPARC', 'IA64', 'Delta'])('retains the %s 7z filter', async filter => {
  const generator = await SevenZip({ print: () => {}, printErr: () => {} });
  const bytes = Uint8Array.from({ length: 4096 }, (_, index) => index % 256);
  generator.FS.writeFile('/payload.bin', bytes);
  expect(generator.callMain(['a', '/filters.7z', '/payload.bin', `-m0=${filter}`, '-m1=LZMA2', '-bd'])).toBe(0);
  const archive = generator.FS.readFile('/filters.7z');
  const entry = (await run({ bytes: archive })).entries![0];
  expect((await run({ bytes: archive, entry })).bytes).toEqual(bytes);
});
