import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { gunzipSync, gzipSync, brotliCompressSync } from 'node:zlib';
import { transform } from 'esbuild';
import { minify } from 'terser';
import ts from 'typescript';
import { createPackedAssetReader, createGroupedPackedAssetReader } from '../packages/preview/src/packed-assets.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const decoderFile = path.join(root, 'packages/preview/vendor/lzma/decoder.wasm');
const decoderSha256 = '2c899b6e3e5dee43d7326348f5a411e2097ef900272132e28ec97df3de91c3f1';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const encoderProfile = 'lzma-2.3.2-9-pb0-cut384';
const gzipIterations = 50;
const require = createRequire(import.meta.url);
let encoder;

async function loadAssetEncoder() {
  const file = require.resolve('lzma/src/lzma_worker.js');
  const source = await readFile(file, 'utf8');
  const bits = 'encoder._posStateBits = 2;', mask = 'encoder._posStateMask = 3;';
  const depth = 'this$static._cutValue = 16 + (matchMaxLen >> 1);';
  assert(source.includes(bits) && source.includes(mask) && source.includes(depth), 'Pinned LZMA encoder preset changed.');
  // These unaligned asset streams compress better with a single position context.
  // A deeper match search also reduces the largest embedded WASM group.
  return runInNewContext(source.replace(bits, 'encoder._posStateBits = 0;')
    .replace(mask, 'encoder._posStateMask = 0;')
    .replace(depth, 'this$static._cutValue = 384 + (matchMaxLen >> 1);'), { setImmediate }, { filename: file });
}

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

export async function packAssetGroups(assets, cacheDirectory = path.join(root, 'node_modules/.cache/filens-assets')) {
  const groups = [], mapping = [], indices = new Map(assets.map((asset, index) => [asset, index]));
  // Large resources and each WASM file get independent dictionaries so using
  // one worker or engine does not restore code for unrelated formats.
  const large = asset => asset.kind !== 2 && asset.bytes.length >= 100_000;
  const wasm = assets.filter(asset => asset.kind === 2);
  for (const members of [assets.filter(asset => asset.kind !== 2 && !large(asset)),
    ...assets.filter(large).map(asset => [asset]), ...wasm.map(asset => [asset])].filter(group => group.length)) {
    const input = Buffer.concat(members.map(asset => asset.bytes)), checksum = crc32(input), key = sha(input);
    const cache = path.join(cacheDirectory, `${key}-${encoderProfile}.bin`);
    let compressed;
    try { compressed = await readFile(cache); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const lzma = await (encoder ??= loadAssetEncoder());
      compressed = await new Promise((resolve, reject) => lzma.compress(input, 9,
        (result, failure) => failure ? reject(failure) : resolve(Buffer.from(result))));
      await mkdir(cacheDirectory, { recursive: true });
      await writeFile(cache, compressed);
    }
    const assetIndices = members.map(asset => indices.get(asset));
    assetIndices.forEach((index, local) => { mapping[index] = [groups.length, local]; });
    groups.push({ compressed, layout: members.map(asset => [asset.kind, asset.bytes.length]),
      size: input.length, checksum, sha256: key, assets: assetIndices });
  }
  return { groups, mapping };
}

/** @returns {import('vite').Plugin} */
export function deferredPreviewWorkers() {
  return {
    name: 'filens-deferred-inline-workers', enforce: 'post', apply: 'build',
    transform(code, id) {
      if (!/[?&]worker(?:&|$)/.test(id) || !/[?&]inline(?:&|$)/.test(id)) return;
      // Keep the source and Blob lazy. WebKit may load the worker after construction returns.
      const signature = 'export default function WorkerWrapper(options) {';
      const sourceEnd = code.indexOf('\n');
      assert(code.startsWith('const jsContent = ') && sourceEnd > 0 && code.includes(signature)
        && code.includes('new Worker(objURL, {') && code.includes('objURL && (self.URL || self.webkitURL).revokeObjectURL(objURL);'),
        'Vite inline worker wrapper changed; check deferred worker initialization.');
      return {
        code: `${signature}
          ${code.slice(0, sourceEnd)}
          let url;
          const release = () => {
            if (!url) return;
            (self.URL || self.webkitURL).revokeObjectURL(url);
            url = undefined;
          };
          try {
            if (typeof self !== 'undefined' && self.Blob) {
              url = (self.URL || self.webkitURL).createObjectURL(new Blob([jsContent], { type: 'text/javascript;charset=utf-8' }));
            }
            if (!url) throw new Error('Blob workers are unavailable.');
            const worker = new Worker(url, { name: options?.name });
            worker.addEventListener('message', release, { once: true });
            worker.addEventListener('error', release, { once: true });
            const terminate = worker.terminate.bind(worker);
            worker.terminate = () => { release(); terminate(); };
            return worker;
          } catch {
            release();
            return new Worker('data:text/javascript;charset=utf-8,' + encodeURIComponent(jsContent), { name: options?.name });
          }
        }`,
        map: { mappings: '' }
      };
    }
  };
}

export async function packPreviewAssets(code, { cacheDirectory = path.join(root, 'node_modules/.cache/filens-assets'), threshold = 208 } = {}) {
  const ast = ts.createSourceFile('filens.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const assets = [], edits = [], byHash = new Map();
  const helper = '__filensPackedAsset';
  const wasmDataPrefix = 'data:application/wasm;base64,';
  assert(!code.includes(helper), 'Packed asset helper collides with runtime code.');
  function visit(node) {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text.length > threshold) {
      const original = node.text;
      let kind = 0;
      let prefix = '';
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
      } else if (original.startsWith(wasmDataPrefix) || /^[A-Za-z0-9+/=]{100000,}$/.test(original)) {
        const data = original.startsWith(wasmDataPrefix) ? original.slice(wasmDataPrefix.length) : original;
        const decoded = Buffer.from(data, 'base64');
        if (decoded.toString('base64') === data) {
          kind = 1;
          bytes = decoded;
          prefix = original.slice(0, original.length - data.length);
        }
      }
      const key = `${kind}:${sha(bytes)}`;
      let index = byHash.get(key);
      if (index === undefined) {
        index = assets.length;
        assets.push({ kind, bytes, original: original.slice(prefix.length) });
        byHash.set(key, index);
      }
      const read = `${helper}(${index})`;
      edits.push([node.getStart(ast), node.end, prefix ? `(${JSON.stringify(prefix)}+${read})` : read]);
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
  const checksum = crc32(input), key = sha(input);
  const { groups, mapping } = await packAssetGroups(assets, cacheDirectory);
  const groupArguments = groups.map(group => [group.compressed.toString('base64'), group.layout, group.size, group.checksum]);
  const compressed = Buffer.concat(groups.map(group => group.compressed));
  const decoder = await readFile(decoderFile);
  assert.equal(sha(decoder), decoderSha256, 'Packed preview decoder differs from its pinned ABI.');
  // Verify the same decoder that browsers run, including every byte of every
  // original worker/string and the uncompressed WASM, before writing output.
  const reader = createGroupedPackedAssetReader(createPackedAssetReader, decoder.toString('base64'), groupArguments, mapping);
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
  const bootstrap = await transform(`const ${helper}=(${createGroupedPackedAssetReader.toString()})(${createPackedAssetReader.toString()},${JSON.stringify(decoder.toString('base64'))},${JSON.stringify(groupArguments)},${JSON.stringify(mapping)});`, {
    loader: 'js', target: 'es2020', minify: true, legalComments: 'none'
  });
  // Vite 5's asset scanner can mistake later code in a heavily minified bundle
  // for a comment. Put static sidecar URLs first so consumer builds copy them.
  // Keep resolution lazy: ordinary documents also work from blob-based HTML.
  const sidecars = [];
  assert(!code.includes('__filensSidecarUrl'), 'Sidecar URL helper collides with runtime code.');
  const body = minified.code.replace(/new URL\((['"])(?:\.\/)?(archive\/7zz\.wasm|assets\/archive-worker-[^'"]+\.js|xlsx\/pcre2\.wasm)\1,\s*import\.meta\.url\)\.href/g,
    (_match, _quote, file) => {
      const name = `__filensSidecarUrl${sidecars.length}`;
      sidecars.push(`const ${name}=()=>new URL(${JSON.stringify(`./${file}`)},import.meta.url).href;`);
      return `${name}()`;
    });
  const packed = sidecars.join('') + bootstrap.code + body;
  return {
    code: packed,
    report: {
      format: 'lzma-alone-static-asset-groups-v2', encoder: encoderProfile, sourceSha256: sha(code), outputSha256: sha(packed),
      decoder: { bytes: decoder.length, sha256: decoderSha256 },
      compressed: { bytes: compressed.length, sha256: sha(compressed) },
      groups: groups.map(group => ({ assets: group.assets,
        decoded: { bytes: group.size, sha256: group.sha256, crc32: group.checksum },
        compressed: { bytes: group.compressed.length, sha256: sha(group.compressed) } })),
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
        worker.postMessage({ bytes, iterations: gzipIterations });
      });
      const brotli = brotliCompressSync(bytes);
      // These exact deployable bytes, rather than an estimated zlib size, are
      // the compressed distribution. A server serves them with Content-Encoding.
      assert(gzip.length <= 4_000_000, `Merged preview gzip ${gzip.length} exceeds 4 MB.`);
      assert(brotli.length <= 4_000_000, `Merged preview Brotli ${brotli.length} exceeds 4 MB.`);
      assert.deepEqual(gunzipSync(gzip), bytes);
      packed.report.delivery = {
        gzip: { bytes: gzip.length, sha256: sha(gzip), encoder: `Zopfli ${gzipIterations} iterations, unrestricted block splitting` },
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
