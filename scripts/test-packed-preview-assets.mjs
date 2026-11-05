import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { packPreviewAssets } from './preview-asset-packing.mjs';
import { createPackedAssetReader } from '../packages/preview/src/packed-assets.mjs';

const directory = await mkdtemp(path.resolve('tmp/packed-assets-test-'));
const wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
const wasmUrl = `data:application/wasm+gzip;base64,${gzipSync(wasm).toString('base64')}`;
const text = '中文、é、\n"\\及🙂'.repeat(300), lone = '\ud800'.repeat(2000);
const worker = Buffer.from('self.onmessage = () => postMessage("ready");\n'.repeat(3000)).toString('base64');
const longName = 'property'.repeat(300), template = 'raw\\n'.repeat(400);
const external = 'data:text/javascript;base64,' + Buffer.from(`export const item=${JSON.stringify(text)};`).toString('base64');
const source = `import {item} from ${JSON.stringify(external)};
export {item};
export const wasm=${JSON.stringify(wasmUrl)}, text=${JSON.stringify(text)}, lone=${JSON.stringify(lone)}, worker=${JSON.stringify(worker)};
export const object={${JSON.stringify(longName)}:42};
export class Example { ${JSON.stringify(longName)}(){return 7} }
export const tagged=String.raw\`${template}\`;
`;
try {
  const packed = await packPreviewAssets(source, { cacheDirectory: directory, threshold: 32 });
  const second = await packPreviewAssets(source, { cacheDirectory: directory, threshold: 32 });
  assert.equal(packed.code, second.code, 'Cached builds must be deterministic.');
  await writeFile(path.join(directory, 'runtime.mjs'), packed.code);
  const result = await import('file://' + path.join(directory, 'runtime.mjs'));
  assert.equal(result.text, text);
  assert.equal(result.item, text, 'Static module specifiers must remain syntax.');
  assert.equal(result.lone, lone, 'Lone UTF-16 surrogates must remain exact.');
  assert.equal(result.worker, worker, 'Worker bytes must retain their original Base64 encoding.');
  assert.equal(result.object[longName], 42);
  assert.equal(new result.Example()[longName](), 7);
  assert.equal(result.tagged, template, 'Tagged template raw strings must remain syntax.');
  assert.equal((await fetch(result.wasm)).headers.get('content-type'), 'application/wasm');
  assert.deepEqual(Buffer.from(await (await fetch(result.wasm)).arrayBuffer()), wasm);
  assert(new WebAssembly.Module(await (await fetch(result.wasm)).arrayBuffer()));
  URL.revokeObjectURL(result.wasm);

  const file = (await readdir(directory)).find(name => name.endsWith('.bin'));
  const compressed = await readFile(path.join(directory, file));
  const decoder = (await readFile('packages/preview/vendor/lzma/decoder.wasm')).toString('base64');
  const report = packed.report, layout = report.assets.map(asset => [['text', 'base64', 'wasm'].indexOf(asset.kind), asset.bytes]);
  const options = [layout, report.decoded.bytes, report.decoded.crc32];
  const reader = (bytes, ...rest) => createPackedAssetReader(decoder, bytes.toString('base64'), ...rest);
  assert.throws(() => reader(compressed.subarray(0, 12), ...options)(0), /Invalid packed/);
  assert.throws(() => reader(compressed.subarray(0, -3), ...options)(0), /Invalid packed/);
  const damaged = Buffer.from(compressed); damaged[0] = 255;
  assert.throws(() => reader(damaged, ...options)(0), /Invalid packed/);
  assert.throws(() => reader(compressed, layout, report.decoded.bytes, report.decoded.crc32 ^ 1)(0), /Invalid packed/);
  assert.throws(() => reader(compressed, ...options)(-1), /Invalid packed/);
  const invalidLayout = layout.map(entry => [...entry]); invalidLayout[0][1]++;
  assert.throws(() => reader(compressed, invalidLayout, report.decoded.bytes, report.decoded.crc32)(0), /Invalid packed/);
  console.log(JSON.stringify({ exactStringsAndWorkers: true, exactWasm: true, syntaxAndSurrogates: true,
    deterministicCache: true, invalidInputsRejected: 6, assets: report.assets.length }));
} finally { await rm(directory, { recursive: true }); }
