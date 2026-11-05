// Original archive/extension specimens. RAR is a fixture-generation tool only.
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import SevenZip from '7z-wasm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'apps/demo/public/samples/archives');
await mkdir(output, { recursive: true });
const readme = Buffer.from('# Filens archive study\n\nOriginal color and shape artwork, packaged for local read-only preview.\n');
const artwork = await readFile(path.join(root, 'apps/demo/public/samples/graphics/color-archive.jpeg'));
const vector = await readFile(path.join(root, 'apps/demo/public/samples/graphics/shape-study.svg'));
const files = { 'README.md': readme, 'page-2.jpeg': artwork, 'page-10.svg': vector };
const manifest = Buffer.from(JSON.stringify({
  manifest_version: 3, name: 'Filens sample extension', version: '1.0.0',
  description: 'Original extension package for archive inspection; no executable scripts.'
}, null, 2));
const extension = zipSync({ 'manifest.json': manifest, 'README.md': readme, 'artwork.svg': vector }, { level: 6 });
await writeFile(path.join(output, 'color-study.xpi'), extension);

// Proper CRX2 and CRX3 envelopes with valid RSA proofs. The ephemeral signing
// key is discarded; previews inspect the ZIP payload and do not verify proofs.
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicKey = keys.publicKey.export({ type: 'spki', format: 'der' });
const u32 = value => { const bytes = Buffer.alloc(4); bytes.writeUInt32LE(value); return bytes; };
const signature2 = sign('sha1', extension, keys.privateKey);
await writeFile(path.join(output, 'color-study-v2.crx'), Buffer.concat([
  Buffer.from('Cr24'), u32(2), u32(publicKey.length), u32(signature2.length), publicKey, signature2, extension
]));
const varint = value => {
  const bytes = [];
  while (value >= 128) { bytes.push((value & 127) | 128); value >>>= 7; }
  return Buffer.from([...bytes, value]);
};
const field = (number, bytes) => Buffer.concat([varint((number << 3) | 2), varint(bytes.length), bytes]);
const signedHeader = field(1, createHash('sha256').update(publicKey).digest().subarray(0, 16));
const signature3 = sign('sha256', Buffer.concat([
  Buffer.from('CRX3 SignedData\0'), u32(signedHeader.length), signedHeader, extension
]), keys.privateKey);
const proof = Buffer.concat([field(1, publicKey), field(2, signature3)]);
const header3 = Buffer.concat([field(2, proof), field(10000, signedHeader)]);
await writeFile(path.join(output, 'color-study-v3.crx'), Buffer.concat([
  Buffer.from('Cr24'), u32(3), u32(header3.length), header3, extension
]));

for (const [name, options] of [
  ['color-study.cb7', ['-t7z', '-m0=LZMA2']],
  ['color-study.cbt', ['-ttar']],
  ['color-study-bzip2.zipx', ['-tzip', '-mm=BZip2']],
  ['color-study-deflate64.zipx', ['-tzip', '-mm=Deflate64']],
  ['color-study-lzma.zipx', ['-tzip', '-mm=LZMA']]
]) {
  const engine = await SevenZip({ print: () => {}, printErr: () => {} });
  engine.FS.mkdir('/artwork');
  engine.FS.chdir('/artwork');
  for (const [filename, bytes] of Object.entries(files)) engine.FS.writeFile(filename, bytes);
  const result = engine.callMain(['a', `/${name}`, ...Object.keys(files), ...options, '-bd']);
  if (result !== 0) throw new Error(`Cannot generate ${name}: ${result}`);
  await writeFile(path.join(output, name), engine.FS.readFile(`/${name}`));
}

const work = await mkdtemp(path.join(os.tmpdir(), 'filens-comic-fixture-'));
try {
  for (const [name, bytes] of Object.entries(files)) await writeFile(path.join(work, name), bytes);
  const result = spawnSync(process.env.FILENS_RAR_BIN || 'rar', [
    'a', '-ma5', '-m0', '-ep', '-idq', '-ts-', '-mt1', '-y', path.join(output, 'color-study.cbr'), ...Object.keys(files)
  ], { cwd: work, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw result.error ?? new Error(`RAR fixture generation failed: ${result.stderr}${result.stdout}`);
} finally { await rm(work, { recursive: true, force: true }); }
console.log('Generated 9 original extension, ZIPX and comic archive samples.');
