import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { packPreviewAssets } from './preview-asset-packing.mjs';
import { createPackedAssetReader } from '../packages/preview/src/packed-assets.mjs';

const directory = await mkdtemp(path.join(os.tmpdir(), 'filens-packed-assets-test-'));
const wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
const wasmUrl = `data:application/wasm+gzip;base64,${gzipSync(wasm).toString('base64')}`;
const wasmTwo = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 0, 2, 1, 120]);
const wasmTwoUrl = `data:application/wasm+gzip;base64,${gzipSync(wasmTwo).toString('base64')}`;
const inlineWasm = `data:application/wasm;base64,${wasm.toString('base64')}`;
const text = '中文、é、\n"\\及🙂'.repeat(300), lone = '\ud800'.repeat(2000);
const worker = Buffer.from('self.onmessage = () => postMessage("ready");\n'.repeat(3000)).toString('base64');
const longName = 'property'.repeat(300), template = 'raw\\n'.repeat(400);
const external = 'data:text/javascript;base64,' + Buffer.from(`export const item=${JSON.stringify(text)};`).toString('base64');
const source = `import {item} from ${JSON.stringify(external)};
export {item};
export const wasm=()=>${JSON.stringify(wasmUrl)}, wasmTwo=()=>${JSON.stringify(wasmTwoUrl)}, text=${JSON.stringify(text)}, lone=${JSON.stringify(lone)}, worker=()=>${JSON.stringify(worker)};
export const inlineWasm=()=>${JSON.stringify(inlineWasm)}, inlineLength=${JSON.stringify(inlineWasm)}.length;
export const object={${JSON.stringify(longName)}:42};
export class Example { ${JSON.stringify(longName)}(){return 7} }
export const tagged=String.raw\`${template}\`;
`;
try {
  const packed = await packPreviewAssets(source, { cacheDirectory: directory, threshold: 32 });
  const second = await packPreviewAssets(source, { cacheDirectory: directory, threshold: 32 });
  assert.equal(packed.code, second.code, 'Cached builds must be deterministic.');
  await writeFile(path.join(directory, 'runtime.mjs'), packed.code);
  const createObjectURL = URL.createObjectURL;
  const WasmModule = WebAssembly.Module;
  let wasmBlobs = 0, decodes = 0, result;
  WebAssembly.Module = class extends WasmModule { constructor(bytes) { super(bytes); decodes++; } };
  URL.createObjectURL = blob => { if (blob.type === 'application/wasm') wasmBlobs++; return createObjectURL(blob); };
  try {
    result = await import('file://' + path.join(directory, 'runtime.mjs'));
    assert.equal(wasmBlobs, 0, 'Importing text and workers must not restore WASM.');
    assert.equal(decodes, 1, 'Import must restore only the small resource group.');
    assert.equal(result.worker(), worker, 'Worker bytes must retain their original Base64 encoding.');
    assert.equal(decodes, 1, 'The LZMA decoder module must be compiled only once.');
    result.worker();
    assert.equal(decodes, 1, 'Restored worker source must be reused.');
    assert.equal(typeof result.wasm, 'function');
    result.wasm();
    assert.equal(wasmBlobs, 1, 'First WASM use must restore its group.');
    assert.equal(decodes, 1);
    result.wasm();
    assert.equal(wasmBlobs, 1, 'Restored WASM URLs must be reused.');
    result.wasmTwo();
    assert.equal(wasmBlobs, 2, 'An unused WASM file must remain deferred.');
    assert.equal(decodes, 1, 'All resource groups must share the compiled LZMA module.');
  } finally { URL.createObjectURL = createObjectURL; WebAssembly.Module = WasmModule; }
  assert.equal(result.text, text);
  assert.equal(result.item, text, 'Static module specifiers must remain syntax.');
  assert.equal(result.lone, lone, 'Lone UTF-16 surrogates must remain exact.');
  assert.equal(result.object[longName], 42);
  assert.equal(new result.Example()[longName](), 7);
  assert.equal(result.tagged, template, 'Tagged template raw strings must remain syntax.');
  assert.equal(result.inlineWasm(), inlineWasm, 'Packed WASM data URLs must keep their original prefix and bytes.');
  assert.equal(result.inlineLength, inlineWasm.length);
  assert.equal((await fetch(result.wasm())).headers.get('content-type'), 'application/wasm');
  assert.deepEqual(Buffer.from(await (await fetch(result.wasm())).arrayBuffer()), wasm);
  assert(new WebAssembly.Module(await (await fetch(result.wasm())).arrayBuffer()));
  assert(new WebAssembly.Module(await (await fetch(result.wasmTwo())).arrayBuffer()));
  URL.revokeObjectURL(result.wasm());

  const decoder = (await readFile('packages/preview/vendor/lzma/decoder.wasm')).toString('base64');
  const report = packed.report;
  assert(report.assets.some(asset => asset.kind === 'base64' && asset.bytes === wasm.length));
  assert.equal(report.groups.length, 4);
  const reader = (bytes, ...rest) => createPackedAssetReader(decoder, bytes.toString('base64'), ...rest);
  for (const group of report.groups) {
    const compressed = await readFile(path.join(directory, `${group.decoded.sha256}-${report.encoder}.bin`));
    assert.equal(compressed[0], 3, 'The LZMA header must encode lc=3, lp=0 and pb=0.');
    const layout = group.assets.map(index => [['text', 'base64', 'wasm'].indexOf(report.assets[index].kind), report.assets[index].bytes]);
    const options = [layout, group.decoded.bytes, group.decoded.crc32];
    assert.throws(() => reader(compressed.subarray(0, 12), ...options)(0), /Invalid packed/);
    assert.throws(() => reader(compressed.subarray(0, -3), ...options)(0), /Invalid packed/);
    const damaged = Buffer.from(compressed); damaged[0] = 255;
    assert.throws(() => reader(damaged, ...options)(0), /Invalid packed/);
    assert.throws(() => reader(compressed, layout, group.decoded.bytes, group.decoded.crc32 ^ 1)(0), /Invalid packed/);
    assert.throws(() => reader(compressed, ...options)(-1), /Invalid packed/);
    const invalidLayout = layout.map(entry => [...entry]); invalidLayout[0][1]++;
    assert.throws(() => reader(compressed, invalidLayout, group.decoded.bytes, group.decoded.crc32)(0), /Invalid packed/);
  }
  console.log(JSON.stringify({ exactStringsAndWorkers: true, exactWasm: true, syntaxAndSurrogates: true,
    deterministicCache: true, deferredWasm: true, deferredWorkers: true,
    invalidInputsRejected: report.groups.length * 6, isolatedWasmGroups: true, assets: report.assets.length }));
} finally { await rm(directory, { recursive: true }); }
