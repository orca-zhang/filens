// Runs once on the developer's machine; strong compression never runs in the app.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync } from 'node:zlib';

const maximumBytes = 32 * 1024 * 1024;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

export function validateIndex(index) {
  if (index.format !== 'filens-mobile-runtime-1' || !Number.isSafeInteger(index.bytes) || index.bytes <= 0 ||
      index.bytes > maximumBytes || !/^[a-f0-9]{64}$/.test(index.sha256) ||
      !Array.isArray(index.entries) || !index.entries.length || index.entries.length > 256) throw new Error('Invalid runtime index');
  let offset = 0;
  const names = new Set();
  for (const entry of index.entries) {
    if (typeof entry.file !== 'string' || /[\\:\0]/.test(entry.file) || entry.file.split('/').some(part => !part || part === '.' || part === '..') ||
        names.has((entry.file + (entry.brotli ? '.br' : '')).toLowerCase()) || entry.offset !== offset || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 ||
        !/^[a-f0-9]{64}$/.test(entry.sha256) || typeof entry.brotli !== 'boolean') throw new Error('Invalid runtime entry');
    names.add((entry.file + (entry.brotli ? '.br' : '')).toLowerCase());
    offset += entry.bytes;
    if (offset > maximumBytes) throw new Error('Runtime size limit exceeded');
  }
  if (offset !== index.bytes) throw new Error('Runtime layout does not match its declared size');
}

export async function buildCodec(root) {
  const tooling = path.join(root, 'tooling');
  const sources = await Promise.all(['runtime-codec.cpp', 'libzpaq.cpp', 'libzpaq.h'].map(file => readFile(path.join(tooling, file))));
  const tag = `${process.platform}-${process.arch}-${sha(Buffer.concat(sources)).slice(0, 16)}`;
  const directory = path.join(root, '.runtime-tools', tag);
  const binary = path.join(directory, process.platform === 'win32' ? 'runtime-codec.exe' : 'runtime-codec');
  if (await stat(binary).then(info => info.isFile(), () => false)) return binary;
  await mkdir(directory, { recursive: true });
  const compilers = process.env.CXX ? [process.env.CXX] : process.platform === 'win32' ? ['clang++', 'g++', 'cl'] : ['clang++', 'c++', 'g++'];
  const failures = [];
  for (const compiler of compilers) {
    const msvc = /^cl(?:\.exe)?$/i.test(path.basename(compiler));
    // Relative arguments also work when the SDK directory contains non-ASCII characters on Windows.
    const output = path.relative(tooling, binary);
    const args = msvc
      ? ['/nologo', '/O2', '/EHsc', '/std:c++17', '/DNOJIT', 'runtime-codec.cpp', 'libzpaq.cpp', `/Fe:${output}`, 'advapi32.lib']
      : ['-O3', '-std=c++17', '-DNOJIT', ...(process.platform === 'win32' ? [] : ['-Dunix', '-pthread']), 'runtime-codec.cpp', 'libzpaq.cpp', '-o', output, ...(process.platform === 'win32' ? ['-ladvapi32'] : [])];
    const result = spawnSync(compiler, args, { cwd: tooling, encoding: 'utf8', timeout: 120000, windowsHide: true, maxBuffer: 1 << 20 });
    if (result.status === 0) return binary;
    failures.push(`${compiler}: ${result.error?.message || result.stderr || 'compilation failed'}`);
  }
  throw new Error(`Install a C++17 compiler (Xcode Command Line Tools / clang++ / g++) or set CXX to its executable.\n${failures.join('\n')}`);
}

export async function prepareRuntime(root) {
  const metadata = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
  if (!['ios', 'android'].includes(metadata.platform)) throw new Error('Unknown SDK platform');
  const indexText = await readFile(path.join(root, 'runtime-index.json'), 'utf8');
  const index = JSON.parse(indexText);
  validateIndex(index);
  const archive = await readFile(path.join(root, 'runtime.zpaq'));
  if (archive.length > 4 * 1048576 || sha(archive) !== index.archiveSha256) throw new Error('SDK runtime archive checksum mismatch');
  const relative = metadata.platform === 'ios' ? 'sdk/ios/Sources/FilensPreview/Resources/filens' : 'sdk/android/filens-preview/src/main/assets/filens';
  const destination = path.join(root, relative);
  const readyPath = path.join(root, '.runtime-ready.json');
  const outputName = entry => entry.file + (entry.brotli ? '.br' : '');
  try {
    const ready = JSON.parse(await readFile(readyPath, 'utf8'));
    if (ready.indexSha256 === sha(indexText) && Object.keys(ready.files).length === index.entries.length &&
        (await Promise.all(index.entries.map(async entry => {
          const file = outputName(entry), bytes = await readFile(path.join(destination, file));
          return sha(bytes) === ready.files[file];
        }))).every(Boolean)) {
      console.log('Offline runtime already prepared.');
      return destination;
    }
  } catch { /* Rebuild incomplete or evicted generated assets. */ }
  const binary = await buildCodec(root);
  const work = await mkdtemp(path.join(root, '.runtime-prepare-'));
  let staging, backup;
  try {
    await mkdir(path.dirname(destination), { recursive: true });
    staging = await mkdtemp(path.join(path.dirname(destination), '.filens-'));
    await writeFile(path.join(work, 'runtime.zpaq'), archive);
    console.log('Restoring the complete offline runtime on this computer (one-time preparation)...');
    const result = spawnSync(binary, ['decode', 'runtime.zpaq', 'runtime.bin', String(index.bytes)], {
      cwd: work, encoding: 'utf8', timeout: 180000, windowsHide: true, maxBuffer: 1 << 20
    });
    if (result.status !== 0) throw new Error(`Runtime restoration failed: ${result.error?.message || result.stderr || result.status}`);
    const bytes = await readFile(path.join(work, 'runtime.bin'));
    if (bytes.length !== index.bytes || sha(bytes) !== index.sha256) throw new Error('Restored runtime checksum mismatch');
    const files = {};
    for (const entry of index.entries) {
      const raw = bytes.subarray(entry.offset, entry.offset + entry.bytes);
      if (sha(raw) !== entry.sha256) throw new Error(`Runtime asset checksum mismatch: ${entry.file}`);
      const file = outputName(entry), output = entry.brotli ? brotliCompressSync(raw) : raw;
      await mkdir(path.dirname(path.join(staging, file)), { recursive: true });
      await writeFile(path.join(staging, file), output);
      files[file] = sha(output);
    }
    if (await stat(destination).then(() => true, () => false)) {
      backup = `${staging}-previous`;
      await rename(destination, backup);
    }
    try { await rename(staging, destination); }
    catch (error) { if (backup) { await rename(backup, destination); backup = undefined; } throw error; }
    await writeFile(readyPath, `${JSON.stringify({ indexSha256: sha(indexText), files })}\n`);
    console.log(`Prepared ${index.entries.length} offline resources. The app uses fast streamed resources; no strong decompression runs on the phone.`);
    return destination;
  } finally {
    await rm(work, { recursive: true, force: true });
    if (staging) await rm(staging, { recursive: true, force: true });
    if (backup) await rm(backup, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await prepareRuntime(path.dirname(fileURLToPath(import.meta.url))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
