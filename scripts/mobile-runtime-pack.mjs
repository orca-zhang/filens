import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync } from 'node:zlib';
import { buildCodec, validateIndex } from '../sdk/mobile/prepare-runtime.mjs';
import { privacyIssues } from './agent-release-privacy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

export async function stageRuntimeDecoder(destination) {
  const upstream = path.join(root, 'sdk/mobile/runtime-codec');
  await cp(upstream, destination, { recursive: true });
  const source = await readFile(path.join(upstream, 'libzpaq.cpp'), 'utf8');
  const encoder = source.indexOf('/////////////////////////// Encoder ');
  const interpreter = source.indexOf('//////////////////////// ZPAQL::assemble()');
  const sort = source.indexOf('////////////////////////// divsufsort ');
  if (!(encoder > 0 && interpreter > encoder && sort > interpreter)) throw new Error('Unexpected ZPAQ source layout');
  // The SDK only restores assets; compression and suffix sorting stay in the repository build tools.
  await writeFile(path.join(destination, 'libzpaq.cpp'), source.slice(0, encoder) + source.slice(interpreter, sort) + '\n} // end namespace libzpaq\n');
  const wrapper = await readFile(path.join(upstream, 'runtime-codec.cpp'), 'utf8');
  const call = 'if (encode) libzpaq::compress(&input, &output, argc == 6 ? argv[5] : "56,120,0", "runtime.bin");';
  if (!wrapper.includes(call)) throw new Error('Unexpected SDK codec wrapper');
  await writeFile(path.join(destination, 'runtime-codec.cpp'), wrapper.replace(call, 'if (encode) throw std::runtime_error("This SDK tool only restores assets");'));
  const metadata = JSON.parse(await readFile(path.join(destination, 'UPSTREAM.json'), 'utf8'));
  metadata.changes.push('Distribution sources omit the unused encoder, configuration compiler and suffix sorter; decoder code is unchanged.');
  await writeFile(path.join(destination, 'UPSTREAM.json'), JSON.stringify(metadata, null, 2) + '\n');
}

export async function packMobileRuntime(runtime, work) {
  await mkdir(work, { recursive: true });
  await cp(path.join(root, 'sdk/mobile/runtime-codec'), path.join(work, 'tooling'), { recursive: true });
  const entries = [], chunks = [];
  let offset = 0, preparedBytes = 0;
  async function visit(prefix = '') {
    for (const entry of (await readdir(path.join(runtime, prefix), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const name = path.join(prefix, entry.name);
      if (entry.isDirectory()) { await visit(name); continue; }
      const stored = await readFile(path.join(runtime, name));
      const brotli = name.endsWith('.br'), bytes = brotli ? brotliDecompressSync(stored) : stored;
      const file = (brotli ? name.slice(0, -3) : name).replaceAll(path.sep, '/');
      const issues = privacyIssues(bytes);
      if (issues.length) throw new Error(`Runtime privacy check rejected ${file}: ${issues.join(', ')}`);
      entries.push({ file, offset, bytes: bytes.length, sha256: sha(bytes), brotli });
      chunks.push(bytes);
      offset += bytes.length;
      preparedBytes += stored.length;
    }
  }
  await visit();
  const bytes = Buffer.concat(chunks), index = { format: 'filens-mobile-runtime-1', bytes: bytes.length, sha256: sha(bytes), entries };
  validateIndex(index);
  const archivePath = path.join(work, 'runtime.zpaq'), indexPath = path.join(work, 'runtime-index.json');
  const methods = ['56,120,0', '56,120,1'];
  try {
    const cached = JSON.parse(await readFile(indexPath, 'utf8')), archive = await readFile(archivePath);
    if (cached.sha256 === index.sha256 && cached.methods?.join() === methods.join() && cached.archiveSha256 === sha(archive)) {
      return { archivePath, indexPath, index: cached, archiveBytes: archive.length, preparedBytes };
    }
  } catch { /* No matching distribution cache. */ }
  await writeFile(path.join(work, 'runtime.bin'), bytes);
  const binary = await buildCodec(work);
  let smallest;
  for (const method of methods) {
    const file = `runtime-${method.replaceAll(',', '-')}.zpaq`;
    const result = spawnSync(binary, ['encode', 'runtime.bin', file, String(index.bytes), method], {
      cwd: work, encoding: 'utf8', timeout: 300000, maxBuffer: 1 << 20
    });
    if (result.status !== 0) throw new Error(`SDK distribution compression failed: ${result.error?.message || result.stderr}`);
    const archive = await readFile(path.join(work, file));
    if (!smallest || archive.length < smallest.bytes.length) smallest = { bytes: archive, method };
  }
  await writeFile(archivePath, smallest.bytes);
  const check = spawnSync(binary, ['decode', 'runtime.zpaq', 'verified.bin', String(index.bytes)], {
    cwd: work, encoding: 'utf8', timeout: 180000, maxBuffer: 1 << 20
  });
  if (check.status !== 0 || sha(await readFile(path.join(work, 'verified.bin'))) !== index.sha256) {
    throw new Error(`SDK distribution round trip failed: ${check.error?.message || check.stderr}`);
  }
  Object.assign(index, { archiveSha256: sha(smallest.bytes), methods, encoderMethod: smallest.method });
  await writeFile(indexPath, JSON.stringify(index));
  await rm(path.join(work, 'runtime.bin'));
  await rm(path.join(work, 'verified.bin'));
  return { archivePath, indexPath, index, archiveBytes: smallest.bytes.length, preparedBytes };
}
