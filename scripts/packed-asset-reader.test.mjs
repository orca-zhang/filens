import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { runInNewContext } from 'node:vm';
import lzma from 'lzma';
import { createPackedAssetReader } from '../packages/preview/src/packed-assets.mjs';
import { deferredPreviewWorkers } from './preview-asset-packing.mjs';

test('inline workers defer setup while preserving Blob fallback, options and URL cleanup', () => {
  const plugin = deferredPreviewWorkers(), id = '/media-worker.ts?worker&inline';
  // The setup and lifecycle follow Vite 6's classic inline worker wrapper.
  const source = `const jsContent = restore();
    const blob = typeof self !== 'undefined' && self.Blob && new Blob([jsContent], {type:'text/javascript;charset=utf-8'});
    export default function WorkerWrapper(options) {
      let objURL;
      try {
        objURL = blob && (self.URL || self.webkitURL).createObjectURL(blob);
        if (!objURL) throw '';
        const worker = new Worker(objURL, {name:options?.name});
        worker.addEventListener('error', () => (self.URL || self.webkitURL).revokeObjectURL(objURL));
        return worker;
      } catch {
        return new Worker('data:text/javascript;charset=utf-8,' + encodeURIComponent(jsContent), {name:options?.name});
      } finally { objURL && (self.URL || self.webkitURL).revokeObjectURL(objURL); }
    }`;
  assert.equal(plugin.transform(source, '/ordinary.ts'), undefined);
  assert.throws(() => plugin.transform('changed wrapper', id), /Vite inline worker wrapper changed/);
  const transformed = plugin.transform(source, id).code.replace('export default ', '');
  for (const mode of ['blob', 'no-blob', 'blob-failure']) {
    let restores = 0, blobs = 0;
    const revoked = [];
    const self = { Blob: mode !== 'no-blob', URL: {
      createObjectURL: () => 'blob:worker', revokeObjectURL: url => revoked.push(url)
    } };
    const Wrapper = runInNewContext(transformed + '\nWorkerWrapper;', {
      self, restore: () => { restores++; return 'postMessage("中文")'; },
      Blob: class { constructor() { blobs++; } },
      Worker: class {
        constructor(url, options) {
          if (mode === 'blob-failure' && url === 'blob:worker') throw new Error('Blob blocked');
          this.url = url; this.options = options;
        }
        addEventListener(_event, callback) { this.error = callback; }
      }
    });
    assert.equal(restores, 0); assert.equal(blobs, 0);
    for (let count = 1; count <= 2; count++) {
      const worker = new Wrapper({ name: 'test' });
      assert.equal(restores, count); assert.equal(worker.options.name, 'test');
      assert.equal(worker.url, mode === 'blob' ? 'blob:worker' :
        'data:text/javascript;charset=utf-8,' + encodeURIComponent('postMessage("中文")'));
      if (mode === 'blob') worker.error();
    }
    assert.equal(revoked.length, mode === 'no-blob' ? 0 : mode === 'blob' ? 4 : 2);
  }
});

test('fallback Base64 and sliced CRC preserve arbitrary bytes and reject corruption', async () => {
  const decoder = (await readFile(new URL('../packages/preview/vendor/lzma/decoder.wasm', import.meta.url))).toString('base64');
  const descriptor = Object.getOwnPropertyDescriptor(Uint8Array, 'fromBase64');
  Object.defineProperty(Uint8Array, 'fromBase64', { configurable: true, value: undefined });
  try {
    for (const size of [1, 2, 7, 8, 9, 15, 16, 17, 255, 256, 257, 65539]) {
      const bytes = randomBytes(size), gzip = gzipSync(bytes);
      // Use zlib's gzip trailer as an independent CRC-32 reference.
      const checksum = gzip.readUInt32LE(gzip.length - 8);
      const compressed = await new Promise((resolve, reject) => lzma.compress(bytes, 1,
        (result, error) => error ? reject(error) : resolve(Buffer.from(result).toString('base64'))));
      const reader = createPackedAssetReader(decoder, compressed, [[1, size]], size, checksum);
      assert.equal(reader(0), bytes.toString('base64'), `size ${size}`);
      assert.equal(reader(0), bytes.toString('base64'), 'Cached reads must remain exact.');
      assert.throws(() => createPackedAssetReader(decoder, compressed, [[1, size]], size, checksum ^ 1)(0), /Invalid packed/);
    }
    const bytes = Buffer.from('123456789');
    const compressed = await new Promise((resolve, reject) => lzma.compress(bytes, 1,
      (result, error) => error ? reject(error) : resolve(Buffer.from(result).toString('base64'))));
    assert.equal(createPackedAssetReader(decoder, compressed, [[0, 9]], 9, 0xcbf43926)(0), '123456789');
  } finally {
    if (descriptor) Object.defineProperty(Uint8Array, 'fromBase64', descriptor);
    else delete Uint8Array.fromBase64;
  }
});
