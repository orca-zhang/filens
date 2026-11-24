// Compare current-source builds with identical embedded resources.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';
import ts from 'typescript';
import { chromium } from '@playwright/test';
import { createPackedAssetReader, createGroupedPackedAssetReader } from '../packages/preview/src/packed-assets.mjs';

const directories = {
  before: process.argv[2] ?? 'tmp/lazy-workers/before/build',
  after: process.argv[3] ?? 'tmp/lazy-workers/after/build'
};
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const variants = {}, report = {
  observedAt: new Date().toISOString(), node: process.version,
  scope: 'Same current-source assets; only large-resource grouping and deferred worker setup change. Seven interleaved trials, fresh Chromium contexts per format and trial, native and forced fallback Base64. Localhost Brotli import includes transfer, decompression, parsing and initialization. Ready means onRendered, not screen paint. Each format starts cold; repeated PDF is checked separately outside timing.',
  csp: { textPdfHeif: 'JavaScript unsafe-eval forbidden', iwork: 'Existing protobuf fallback needs unsafe-eval in both builds; measured under the same relaxed script policy.' },
  variants: {}
};
for (const [name, directory] of Object.entries(directories)) {
  const code = await readFile(`${directory}/filens.js`, 'utf8');
  const packing = JSON.parse(await readFile(`${directory}/asset-packing.json`, 'utf8'));
  assert.equal(createHash('sha256').update(code).digest('hex'), packing.outputSha256);
  const ast = ts.createSourceFile('filens.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const initializer = ast.statements.flatMap(statement => ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : [])
    .find(declaration => declaration.name.getText(ast) === '__filensPackedAsset')?.initializer;
  assert(initializer && ts.isCallExpression(initializer) && initializer.arguments.length === 4);
  const args = initializer.arguments.slice(1).map(argument => JSON.parse(argument.getText(ast)));
  variants[name] = { br: await readFile(`${directory}/filens.js.br`), args };
  report.variants[name] = { directory, packing, firstResourceSamplesMs: [], allResourcesSamplesMs: [], browser: {} };
}
assert.deepEqual(report.variants.before.packing.assets, report.variants.after.packing.assets,
  'Every embedded worker/string/WASM must have identical bytes and order.');
const order = trial => trial % 2 ? ['after', 'before'] : ['before', 'after'];
for (let trial = -1; trial < 7; trial++) {
  for (const name of order(trial)) {
    const reader = createGroupedPackedAssetReader(createPackedAssetReader, ...variants[name].args), start = performance.now();
    reader(0);
    const first = performance.now() - start;
    const urls = [];
    for (const [index, asset] of report.variants[name].packing.assets.entries()) {
      const value = reader(index);
      if (asset.kind === 'wasm') urls.push(value);
    }
    const all = performance.now() - start;
    if (trial >= 0) {
      report.variants[name].firstResourceSamplesMs.push(first);
      report.variants[name].allResourcesSamplesMs.push(all);
    }
    for (const url of urls) URL.revokeObjectURL(url);
  }
}
const fixtures = [{ name: 'startup.txt', base64: Buffer.from('Worker startup 中文').toString('base64') }];
for (const [file, name] of [
  ['apps/demo/public/samples/filens-cosmic-atlas.pdf', 'atlas.pdf'],
  ['apps/demo/public/samples/a.pages', 'sample.pages'],
  ['packages/converter-client/test/fixtures/heif/420-srgb8-full.heic', 'color.heic']
]) fixtures.push({ name, base64: (await readFile(file)).toString('base64') });
const csp = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' blob: data:; worker-src 'self' blob:; style-src 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' blob: data:";
const server = createServer((request, response) => {
  const variant = variants[request.url.split('/')[1]];
  if (variant && request.url.endsWith('/filens.js')) {
    response.writeHead(200, { 'content-type': 'text/javascript', 'content-encoding': 'br', 'cache-control': 'no-store' });
    response.end(variant.br);
  } else if (request.url === '/' || request.url === '/iwork') {
    response.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': request.url === '/iwork'
      ? csp.replace("'wasm-unsafe-eval'", "'wasm-unsafe-eval' 'unsafe-eval'") : csp });
    response.end('<!doctype html><div id="host" style="width:800px;height:600px"></div>');
  } else response.writeHead(404).end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch();
try {
  report.browser = browser.version();
  for (const mode of ['native', 'fallback']) {
    for (let trial = 0; trial < 7; trial++) {
      for (const fixture of fixtures) {
        for (const name of order(trial)) {
          const context = await browser.newContext(), page = await context.newPage(), errors = [];
          page.on('pageerror', error => errors.push(error.message));
          page.on('console', message => { if (/Content Security Policy|Refused to/.test(message.text())) errors.push(message.text()); });
          await page.addInitScript(mode => {
            if (mode === 'fallback') Object.defineProperty(Uint8Array, 'fromBase64', { value: undefined, configurable: true });
            window.workerBlobs = [];
            window.Blob = new Proxy(Blob, {
              construct(target, args, newTarget) {
                const blob = Reflect.construct(target, args, newTarget);
                if (blob.type.startsWith('text/javascript')) window.workerBlobs.push(blob.size);
                return blob;
              }
            });
          }, mode);
          try {
            await page.goto(`http://127.0.0.1:${server.address().port}/${fixture.name.endsWith('.pages') ? 'iwork' : ''}`);
            await page.evaluate(async fixture => {
              window.input = new File([await (await fetch('data:application/octet-stream;base64,' + fixture.base64)).arrayBuffer()], fixture.name);
            }, fixture);
            const observed = await page.evaluate(async name => {
              const start = performance.now();
              window.sdk = await import(`/${name}/filens.js`);
              const importMs = performance.now() - start, blobsAfterImport = [...window.workerBlobs];
              window.renderCount = 0;
              window.openBenchmarkPreview = () => new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('Preview timed out')), 60_000);
                window.viewer = window.sdk.createPreview('#host', {
                  src: window.input,
                  onRendered: state => { clearTimeout(timer); window.renderCount++; window.state = state; resolve(); },
                  onError: error => { clearTimeout(timer); reject(new Error(error.message)); }
                });
              });
              await window.openBenchmarkPreview();
              return { importMs, readyMs: performance.now() - start, blobsAfterImport,
                blobsAfterReady: [...window.workerBlobs], title: window.state.title };
            }, name);
            if (fixture.name.endsWith('.pages')) assert.match(observed.title, /Representative Import Fixture/);
            else assert.equal(observed.title, fixture.name);
            if (name === 'after') {
              assert.deepEqual(observed.blobsAfterImport, [], 'Import must not create worker Blobs.');
              assert.equal(observed.blobsAfterReady.length, fixture.name.endsWith('.txt') ? 0 : 1,
                'A preview must restore only its own worker.');
            }
            const samples = report.variants[name].browser[mode] ??= {};
            (samples[fixture.name] ??= []).push(observed);
            if (!trial && fixture.name.endsWith('.pdf')) {
              const blobs = await page.evaluate(async () => {
                window.viewer.destroy();
                const count = window.workerBlobs.length;
                await window.openBenchmarkPreview();
                if (window.renderCount !== 2) throw new Error('PDF did not reopen');
                return { before: count, after: window.workerBlobs.length };
              });
              assert.equal(blobs.after, blobs.before, 'Repeated PDF must reuse the worker URL.');
            }
            await page.evaluate(() => window.viewer.destroy());
            assert.equal(await page.locator('#host').innerHTML(), '');
            assert.deepEqual(errors, []);
          } finally { await context.close(); }
        }
      }
    }
    console.log(`Completed ${mode}: seven cold trials per format and variant.`);
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
for (const variant of Object.values(report.variants)) {
  variant.firstResourceMedianMs = median(variant.firstResourceSamplesMs);
  variant.allResourcesMedianMs = median(variant.allResourcesSamplesMs);
  variant.browserMedians = Object.fromEntries(Object.entries(variant.browser).map(([mode, formats]) => [mode,
    Object.fromEntries(Object.entries(formats).map(([format, samples]) => [format, {
      importMs: median(samples.map(sample => sample.importMs)),
      readyMs: median(samples.map(sample => sample.readyMs)),
      previewMs: median(samples.map(sample => sample.readyMs - sample.importMs))
    }]))]));
}
await writeFile('docs/worker-startup-benchmark.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(report.variants).map(([name, variant]) => [name, {
  brotliBytes: variant.packing.delivery.brotli.bytes, firstResourceMs: variant.firstResourceMedianMs,
  allResourcesMs: variant.allResourcesMedianMs, browser: variant.browserMedians
}])), null, 2));
