// Compare one-file and split CDN entries for cold import and first previews.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { brotliCompressSync } from 'node:zlib';
import { chromium } from '@playwright/test';

const roots = {
  singlePerGroup: path.resolve(process.argv[2] ?? 'tmp/lazy-decoder/before/build'),
  singleSharedDecoder: path.resolve(process.argv[3] ?? 'tmp/lazy-decoder/after/build'),
  split: path.resolve(process.argv[4] ?? 'tmp/lazy-workers/split/build')
};
const cache = new Map();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function asset(root, relative) {
  const full = path.resolve(root, relative);
  assert(full.startsWith(root + path.sep));
  if (!cache.has(full)) {
    const bytes = await readFile(full);
    cache.set(full, { bytes, brotli: /\.(?:m?js|css)$/.test(relative) ? brotliCompressSync(bytes) : null });
  }
  return cache.get(full);
}
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/') {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<!doctype html><div id="host" style="width:800px;height:600px"></div>'); return;
  }
  const [variant, ...parts] = url.pathname.slice(1).split('/');
  if (!roots[variant]) { response.writeHead(404).end(); return; }
  try {
    const relative = parts.join('/') || 'filens.js';
    const found = await asset(roots[variant], relative);
    response.writeHead(200, { 'content-type': relative.endsWith('.wasm') ? 'application/wasm' :
      relative.endsWith('.css') ? 'text/css' : relative.endsWith('.html') ? 'text/html' : 'text/javascript',
      ...(found.brotli ? { 'content-encoding': 'br' } : {}), 'cache-control': 'no-store' });
    response.end(found.brotli ?? found.bytes);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch(), origin = `http://127.0.0.1:${server.address().port}`;
const formats = [{ name: 'text.txt', bytes: Buffer.from('CDN startup 中文').toString('base64') },
  ...await Promise.all([
    ['apps/demo/public/samples/filens-cosmic-atlas.pdf', 'atlas.pdf'],
    ['apps/demo/public/samples/a.pages', 'sample.pages'],
    ['packages/converter-client/test/fixtures/heif/420-srgb8-full.heic', 'color.heic'],
    ['packages/model3d/test/fixtures/occt/cube.stp', 'cube.stp']
  ].map(async ([file, name]) => ({ name, bytes: (await readFile(file)).toString('base64') })))];
const report = { observedAt: new Date().toISOString(), node: process.version, browser: browser.version(),
  scope: 'Current workspace build. Single-file uses its produced Brotli sidecar; split mode Brotli-compresses each JS module and CSS at the local server, while WASM is served raw. Seven cold trials per entry and format, each in a fresh browser context. First preview timing ends at onRendered and includes first-time format worker setup. Startup byte totals include only resources requested through the selected preview; module request counts exclude the HTML page.', artifacts: {}, variants: {} };
for (const [variant, root] of Object.entries(roots)) {
  const main = await readFile(path.join(root, 'filens.js'));
  report.artifacts[variant] = { mainSha256: hash(main), mainRawBytes: main.length };
  try {
    const packed = JSON.parse(await readFile(path.join(root, 'asset-packing.json'), 'utf8'));
    report.artifacts[variant].packedOutputSha256 = packed.outputSha256;
    report.artifacts[variant].delivery = packed.delivery;
    report.artifacts[variant].decoderBytes = packed.decoder.bytes;
  } catch { /* split output has no packing manifest */ }
}
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
try {
  for (const variant of Object.keys(roots)) {
    const cases = {};
    for (const format of formats) {
      const samples = [], files = new Map();
      for (let trial = 0; trial < 7; trial++) {
        const context = await browser.newContext(), page = await context.newPage(), requests = [], errors = [];
        page.on('request', request => requests.push(request.url()));
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(decoderBytes => {
          window.wasmBlobs = 0;
          const original = URL.createObjectURL;
          URL.createObjectURL = blob => {
            if (blob.type === 'application/wasm') window.wasmBlobs++;
            return original(blob);
          };
          const NativeModule = WebAssembly.Module;
          window.decoderModuleCompiles = 0;
          WebAssembly.Module = new Proxy(NativeModule, { construct(target, args, newTarget) {
            if ((args[0]?.byteLength ?? args[0]?.length) === decoderBytes) window.decoderModuleCompiles++;
            return Reflect.construct(target, args, newTarget);
          } });
        }, report.artifacts[variant].decoderBytes ?? 0);
        await page.goto(origin);
        try {
          const timing = await page.evaluate(async ({ variant, format }) => {
            const start = performance.now();
            const sdk = await import(`/${variant}/filens.js`);
            const importMs = performance.now() - start;
            const wasmBlobsAfterImport = window.wasmBlobs;
            const decoderCompilesAfterImport = window.decoderModuleCompiles;
            const previewStart = performance.now();
            await new Promise((resolve, reject) => {
              const timer = setTimeout(() => reject(new Error('Preview timed out')), 60_000);
              window.viewer = sdk.createPreview('#host', { src: format.name.endsWith('.txt')
                ? new File([Uint8Array.fromBase64(format.bytes)], format.name)
                : new File([Uint8Array.fromBase64(format.bytes)], format.name),
                onRendered: () => { clearTimeout(timer); resolve(); },
                onError: error => { clearTimeout(timer); reject(error); } });
            });
            return { importMs, readyMs: performance.now() - previewStart,
              wasmBlobsAfterImport, wasmBlobsAfterPreview: window.wasmBlobs,
              decoderCompilesAfterImport, decoderCompilesAfterPreview: window.decoderModuleCompiles };
          }, { variant, format });
          assert.deepEqual(errors, []);
          const expectedWasmBlobs = variant === 'split' ? 0
            : format.name === 'color.heic' ? 2 : format.name === 'cube.stp' ? 1 : 0;
          assert.equal(timing.wasmBlobsAfterImport, 0, 'Module import must not restore WASM.');
          assert.equal(timing.wasmBlobsAfterPreview, expectedWasmBlobs,
            `${variant} ${format.name} should restore only required WASM assets.`);
          if (variant === 'singleSharedDecoder') assert.equal(timing.decoderCompilesAfterPreview, 1,
            'All resource groups must reuse one compiled LZMA decoder module.');
          for (const url of requests) {
            const relative = new URL(url).pathname.slice(`/${variant}/`.length);
            if (trial === 0 && /\.(?:m?js|css|wasm)$/.test(relative)) {
              const full = path.join(roots[variant], relative), bytes = await readFile(full);
              files.set(relative, files.get(relative) ?? { rawBytes: bytes.length, sha256: hash(bytes) });
            }
          }
          samples.push({ ...timing, moduleRequests: requests.filter(url => /\.(?:m?js|css|wasm)(?:\?|$)/.test(url)).length });
          await page.evaluate(() => window.viewer.destroy());
          assert.equal(await page.locator('#host').innerHTML(), '');
        } finally { await context.close(); }
      }
      cases[format.name] = { samples, medianImportMs: median(samples.map(sample => sample.importMs)),
        medianPreviewMs: median(samples.map(sample => sample.importMs + sample.readyMs)),
        medianDecoderCompilesAfterImport: median(samples.map(sample => sample.decoderCompilesAfterImport)),
        medianDecoderCompilesAfterPreview: median(samples.map(sample => sample.decoderCompilesAfterPreview)),
        medianModuleRequests: median(samples.map(sample => sample.moduleRequests)),
        files: Object.fromEntries([...files].sort().map(([file, metadata]) => [file, { ...metadata,
          brotliBytes: cache.get(path.join(roots[variant], file))?.brotli?.length ?? metadata.rawBytes }])),
        startupRawBytes: [...files.values()].reduce((sum, metadata) => sum + metadata.rawBytes, 0),
        startupBrotliBytes: [...files.keys()].reduce((sum, file) => sum + (cache.get(path.join(roots[variant], file))?.brotli?.length ?? files.get(file).rawBytes), 0) };
    }
    report.variants[variant] = { cases };
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
await (await import('node:fs/promises')).writeFile('docs/preview-entry-benchmark.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(report.variants).map(([name, variant]) => [name, {
  cases: Object.fromEntries(Object.entries(variant.cases).map(([file, row]) => [file,
    { importMs: row.medianImportMs, readyMs: row.medianPreviewMs, moduleRequests: row.medianModuleRequests,
      decoderCompiles: row.medianDecoderCompilesAfterPreview,
      rawBytes: row.startupRawBytes, brotliBytes: row.startupBrotliBytes }]))
}])), null, 2));
