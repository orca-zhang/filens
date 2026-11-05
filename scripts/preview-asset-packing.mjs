import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { gunzipSync, gzipSync, brotliCompressSync } from 'node:zlib';
import { transform } from 'esbuild';
import { minify } from 'terser';
import ts from 'typescript';
import lzma from 'lzma';
import { createPackedAssetReader } from '../packages/preview/src/packed-assets.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const decoderFile = path.join(root, 'packages/preview/vendor/lzma/decoder.wasm');
const decoderSha256 = '2c899b6e3e5dee43d7326348f5a411e2097ef900272132e28ec97df3de91c3f1';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

function crc32(bytes) {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value;
  }
  let value = -1;
  for (const byte of bytes) value = table[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ -1) >>> 0;
}

export async function packPreviewAssets(code, { cacheDirectory = path.join(root, 'node_modules/.cache/filens-assets'), threshold = 1024 } = {}) {
  const ast = ts.createSourceFile('filens.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const assets = [], edits = [], byHash = new Map();
  const helper = '__filensPackedAsset';
  assert(!code.includes(helper), 'Packed asset helper collides with runtime code.');
  function visit(node) {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text.length > threshold) {
      const original = node.text;
      let kind = 0;
      // Names, static module specifiers and tagged templates require syntax,
      // rather than an ordinary string value expression.
      if (node.parent.name === node || ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent) ||
          ts.isTaggedTemplateExpression(node.parent)) return;
      let bytes = Buffer.from(original);
      // Keep lone UTF-16 surrogates in their original JS literal.
      if (bytes.toString('utf8') !== original) return;
      if (kind === 0 && original.startsWith('data:application/wasm+gzip;base64,')) {
        kind = 2;
        bytes = gunzipSync(Buffer.from(original.slice(original.indexOf(',') + 1), 'base64'));
      } else if (kind === 0 && /^[A-Za-z0-9+/=]{100000,}$/.test(original)) {
        const decoded = Buffer.from(original, 'base64');
        if (decoded.toString('base64') === original) { kind = 1; bytes = decoded; }
      }
      const key = `${kind}:${sha(bytes)}`;
      let index = byHash.get(key);
      if (index === undefined) {
        index = assets.length;
        assets.push({ kind, bytes, original });
        byHash.set(key, index);
      }
      edits.push([node.getStart(ast), node.end, `${helper}(${index})`]);
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert(assets.some(asset => asset.kind === 2), 'Merged preview has no embedded WASM to pack.');
  let stripped = code;
  for (const [start, end, replacement] of edits.sort((a, b) => b[0] - a[0])) {
    stripped = stripped.slice(0, start) + replacement + stripped.slice(end);
  }
  const input = Buffer.concat(assets.map(asset => asset.bytes));
  const layout = assets.map(asset => [asset.kind, asset.bytes.length]);
  const checksum = crc32(input), key = sha(input);
  const cache = path.join(cacheDirectory, `${key}-lzma-2.3.2-9.bin`);
  let compressed;
  try { compressed = await readFile(cache); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    compressed = await new Promise((resolve, reject) => lzma.compress(input, 9,
      (result, failure) => failure ? reject(failure) : resolve(Buffer.from(result))));
    await mkdir(cacheDirectory, { recursive: true });
    await writeFile(cache, compressed);
  }
  const decoder = await readFile(decoderFile);
  assert.equal(sha(decoder), decoderSha256, 'Packed preview decoder differs from its pinned ABI.');
  // Verify the same decoder that browsers run, including every byte of every
  // original worker/string and the uncompressed WASM, before writing output.
  const reader = createPackedAssetReader(decoder.toString('base64'), compressed.toString('base64'), layout, input.length, checksum);
  const urls = [];
  try {
    for (const [index, asset] of assets.entries()) {
      const result = reader(index);
      if (asset.kind === 2) {
        urls.push(result);
        assert.deepEqual(Buffer.from(await (await fetch(result)).arrayBuffer()), asset.bytes);
      } else assert.equal(result, asset.original);
    }
  } finally { for (const url of urls) URL.revokeObjectURL(url); }
  const minified = await minify(stripped, {
    ecma: 2020, module: true, compress: { passes: 3 }, mangle: true,
    format: { comments: /@license|@preserve|^!/ }
  });
  const bootstrap = await transform(`const ${helper}=(${createPackedAssetReader.toString()})(${JSON.stringify(decoder.toString('base64'))},${JSON.stringify(compressed.toString('base64'))},${JSON.stringify(layout)},${input.length},${checksum});`, {
    loader: 'js', target: 'es2020', minify: true, legalComments: 'none'
  });
  // Vite 5's asset scanner can mistake later code in a heavily minified bundle
  // for a comment. Put static sidecar URLs first so consumer builds copy them.
  // Keep resolution lazy: ordinary documents also work from blob-based HTML.
  const sidecars = [];
  assert(!code.includes('__filensSidecarUrl'), 'Sidecar URL helper collides with runtime code.');
  const body = minified.code.replace(/new URL\((['"])(?:\.\/)?(archive\/7zz\.wasm|assets\/archive-worker-[^'"]+\.js)\1,\s*import\.meta\.url\)\.href/g,
    (_match, _quote, file) => {
      const name = `__filensSidecarUrl${sidecars.length}`;
      sidecars.push(`const ${name}=()=>new URL(${JSON.stringify(`./${file}`)},import.meta.url).href;`);
      return `${name}()`;
    });
  const packed = sidecars.join('') + bootstrap.code + body;
  return {
    code: packed,
    report: {
      format: 'lzma-alone-static-assets-v1', sourceSha256: sha(code), outputSha256: sha(packed),
      decoder: { bytes: decoder.length, sha256: decoderSha256 },
      compressed: { bytes: compressed.length, sha256: sha(compressed) },
      decoded: { bytes: input.length, sha256: key, crc32: checksum },
      assets: assets.map(asset => ({ kind: ['text', 'base64', 'wasm'][asset.kind], bytes: asset.bytes.length, sha256: sha(asset.bytes) })),
      before: { raw: Buffer.byteLength(code), gzip: gzipSync(code, { level: 9 }).length, brotli: brotliCompressSync(code).length },
      after: { raw: Buffer.byteLength(packed), gzip: gzipSync(packed, { level: 9 }).length, brotli: brotliCompressSync(packed).length },
      verified: { exactAssets: true, checksummed: true, synchronousEsm: true }
    }
  };
}

export function packedPreviewAssets() {
  return {
    name: 'filens-packed-preview-assets',
    generateBundle: { order: 'post', async handler(_options, bundle) {
      const entry = Object.values(bundle).find(item => item.type === 'chunk' && item.isEntry);
      assert(entry, 'Merged preview entry is missing.');
      const packed = await packPreviewAssets(entry.code);
      entry.code = packed.code;
      const bytes = Buffer.from(packed.code);
      // Isolate the build codec's Emscripten globals and CPU work from Vite.
      const gzip = await new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./preview-gzip-worker.mjs', import.meta.url));
        let settled = false;
        worker.once('message', async message => {
          settled = true;
          await worker.terminate();
          if (message.error) reject(new Error(message.error));
          else resolve(Buffer.from(message.bytes));
        });
        worker.once('error', reject);
        worker.once('exit', code => { if (!settled) reject(new Error(`Preview gzip worker exited with ${code}.`)); });
        worker.postMessage(bytes);
      });
      const brotli = brotliCompressSync(bytes);
      // These exact deployable bytes, rather than an estimated zlib size, are
      // the compressed distribution. A server serves them with Content-Encoding.
      assert(gzip.length <= 4_000_000, `Merged preview gzip ${gzip.length} exceeds 4 MB.`);
      assert(brotli.length <= 4_000_000, `Merged preview Brotli ${brotli.length} exceeds 4 MB.`);
      assert.deepEqual(gunzipSync(gzip), bytes);
      packed.report.delivery = {
        gzip: { bytes: gzip.length, sha256: sha(gzip), encoder: 'Zopfli 15 iterations' },
        brotli: { bytes: brotli.length, sha256: sha(brotli), encoder: 'Brotli quality 11' },
        limit: 4_000_000
      };
      this.emitFile({ type: 'asset', fileName: 'filens.js.gz', source: gzip });
      this.emitFile({ type: 'asset', fileName: 'filens.js.br', source: brotli });
      this.emitFile({ type: 'asset', fileName: 'asset-packing.json', source: JSON.stringify(packed.report, null, 2) + '\n' });
      console.log(`Packed preview gzip: ${packed.report.before.gzip} -> ${gzip.length} bytes (zlib: ${packed.report.after.gzip})`);
    } }
  };
}
