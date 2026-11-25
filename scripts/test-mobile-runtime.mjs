import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { brotliDecompressSync } from 'node:zlib';
import { buildCodec, prepareRuntime, validateIndex } from '../sdk/mobile/prepare-runtime.mjs';
import { stageRuntimeDecoder } from './mobile-runtime-pack.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const raw = Buffer.from('Complete offline assets: 中文\n');
const base = () => ({ format: 'filens-mobile-runtime-1', bytes: raw.length, sha256: sha(raw),
  entries: [{ file: 'filens.js', offset: 0, bytes: raw.length, sha256: sha(raw), brotli: true }] });

test('runtime index rejects traversal, output collisions and invalid size/layout', () => {
  validateIndex(base());
  for (const file of ['/absolute', '../escape', 'a/../escape', 'a//b', 'C:/escape', 'a\\b', 'a\0b']) {
    const index = base(); index.entries[0].file = file;
    assert.throws(() => validateIndex(index));
  }
  for (const mutate of [
    index => { index.bytes = 33 * 1024 * 1024; },
    index => { index.entries[0].offset = 1; },
    index => { index.entries[0].bytes = -1; },
    index => { index.entries[0].sha256 = 'bad'; },
    index => { index.entries.push({ ...index.entries[0], file: 'FILENS.JS.br', offset: raw.length, bytes: 0, brotli: false }); }
  ]) { const index = base(); mutate(index); assert.throws(() => validateIndex(index)); }
});

test('offline preparation roundtrip, cache, recovery and failure preserve existing assets', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'filens-sdk-'));
  try {
    await cp(new URL('../sdk/mobile/runtime-codec/', import.meta.url), path.join(root, 'tooling'), { recursive: true });
    const binary = await buildCodec(root);
    await writeFile(path.join(root, 'runtime.bin'), raw);
    const encoded = spawnSync(binary, ['encode', 'runtime.bin', 'runtime.zpaq', String(raw.length), '1'], { cwd: root, encoding: 'utf8' });
    assert.equal(encoded.status, 0, encoded.stderr);
    await stageRuntimeDecoder(path.join(root, 'tooling'));
    const decoder = await buildCodec(root);
    assert.notEqual(decoder, binary, 'distribution compiles only the decoder sources');
    const unavailable = spawnSync(decoder, ['encode', 'runtime.bin', 'unused.zpaq', String(raw.length)], { cwd: root, encoding: 'utf8' });
    assert.notEqual(unavailable.status, 0);
    const archive = await readFile(path.join(root, 'runtime.zpaq'));
    const index = { ...base(), archiveSha256: sha(archive) };
    await writeFile(path.join(root, 'runtime-index.json'), JSON.stringify(index));
    await writeFile(path.join(root, 'manifest.json'), JSON.stringify({ platform: 'android' }));
    const destination = await prepareRuntime(root);
    const asset = path.join(destination, 'filens.js.br');
    assert.deepEqual(brotliDecompressSync(await readFile(asset)), raw);
    const first = await stat(asset);
    await prepareRuntime(root);
    assert.equal((await stat(asset)).mtimeMs, first.mtimeMs, 'intact assets are reused');
    const damaged = Buffer.from(await readFile(asset)); damaged[damaged.length - 1] ^= 1;
    await writeFile(asset, damaged);
    await prepareRuntime(root);
    assert.deepEqual(brotliDecompressSync(await readFile(asset)), raw, 'same-size corruption is repaired');
    await rm(asset);
    await prepareRuntime(root);
    assert.deepEqual(brotliDecompressSync(await readFile(asset)), raw, 'missing assets are restored');
    await writeFile(path.join(root, 'runtime.zpaq'), 'broken');
    await assert.rejects(prepareRuntime(root), /archive checksum/);
    index.archiveSha256 = sha('broken');
    await writeFile(path.join(root, 'runtime-index.json'), JSON.stringify(index));
    await assert.rejects(prepareRuntime(root), /restoration failed/);
    assert.deepEqual(brotliDecompressSync(await readFile(asset)), raw, 'failed replacement preserves old assets');
    assert.ok(!(await readdir(root)).some(name => name.startsWith('.runtime-prepare-')));
    assert.ok(!(await readdir(path.dirname(destination))).some(name => name.startsWith('.filens-')));
  } finally { await rm(root, { recursive: true, force: true }); }
});
