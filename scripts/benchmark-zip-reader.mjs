// Synthetic ZIP read benchmark; excludes rendering, networking and module loading.
// Run npm run build:core first. No files are written.
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { strToU8, zipSync } from 'fflate';
import JSZip from 'jszip';
import { openUnencryptedZipArchive } from '../packages/core/dist/zip.js';

const text = '<part>' + 'document preview '.repeat(32) + '</part>';
const contents = strToU8(text);
const entryCount = 1000;
const bytes = zipSync(Object.fromEntries(Array.from({ length: entryCount }, (_, index) => [
  `parts/part-${index}.xml`, [contents, { mtime: new Date('2025-01-01T00:00:00Z') }]
])));
const readers = {
  shared: async () => [...(await openUnencryptedZipArchive(bytes)).values()],
  jszip: async () => Object.values((await JSZip.loadAsync(bytes)).files)
    .filter(entry => !entry.dir).map(entry => ({ text: () => entry.async('text') }))
};

async function measure(cached) {
  const samples = { shared: [], jszip: [] };
  for (let iteration = 0; iteration < 10; iteration++) {
    // Rotate engines so one implementation does not always run first.
    for (const name of iteration % 2 ? ['jszip', 'shared'] : ['shared', 'jszip']) {
      let entries;
      if (cached) {
        entries = await readers[name]();
        for (const entry of entries) await entry.text();
      }
      const start = performance.now();
      entries ??= await readers[name]();
      const texts = [];
      for (const entry of entries) texts.push(await entry.text());
      const elapsed = performance.now() - start;
      assert.equal(texts.length, entryCount);
      assert(texts.every(value => value === text));
      if (iteration >= 3) samples[name].push(elapsed);
    }
  }
  const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const sharedMs = median(samples.shared), jszipMs = median(samples.jszip);
  return { sharedMs, jszipMs, ratio: jszipMs / sharedMs };
}

const result = {
  node: process.version, cpu: os.cpus()[0].model,
  entryCount, archiveBytes: bytes.length, expandedBytes: entryCount * contents.length,
  measuredIterations: 7, warmupIterations: 3,
  freshArchive: await measure(false), cachedEntries: await measure(true)
};

// Optional production measurement: follow static imports from the standalone
// entry, excluding optional engines, workers and WASM. Build stays in memory.
if (process.argv.includes('--bundle')) {
  const { build } = await import('vite');
  process.env.FILENS_PREVIEW_BUILD = 'split';
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const built = await build({ root: path.join(root, 'packages/preview'), logLevel: 'silent', build: { write: false } });
  const chunks = new Map((Array.isArray(built) ? built : [built]).flatMap(item => item.output)
    .filter(item => item.type === 'chunk').map(item => [item.fileName, item]));
  const files = new Set();
  const visit = name => {
    if (files.has(name) || !chunks.has(name)) return;
    files.add(name);
    for (const dependency of chunks.get(name).imports) visit(dependency);
  };
  visit('filens.js');
  assert(files.size > 0);
  const sizes = { raw: 0, gzip: 0, brotli: 0 };
  for (const name of files) {
    const code = chunks.get(name).code;
    sizes.raw += Buffer.byteLength(code);
    sizes.gzip += gzipSync(code, { level: 9 }).length;
    sizes.brotli += brotliCompressSync(code).length;
  }
  result.splitStartupJs = { ...sizes, files: [...files].sort() };
}

console.log(JSON.stringify(result, null, 2));
