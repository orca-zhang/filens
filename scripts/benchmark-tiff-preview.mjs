// Complete TIFF media-to-PNG URL generation in Chromium, excluding imports and hashing.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { build } from 'vite';
import { createMultipageTiff } from '../packages/core/test/fixtures/multipage-tiff.mjs';

const baselineIndex = process.argv.indexOf('--baseline');
const baseline = baselineIndex < 0 ? undefined : process.argv[baselineIndex + 1];
if (baselineIndex >= 0 && (!baseline || baseline.startsWith('--'))) throw new Error('--baseline requires a core dist directory.');
const entries = { current: path.resolve('packages/core/dist/index.js'), ...(baseline ? { baseline: path.resolve(baseline, 'index.js') } : {}) };
const directory = await mkdtemp(path.join(os.tmpdir(), 'filens-tiff-preview-'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
let browser;
try {
  await build({ configFile: false, logLevel: 'silent', build: {
    outDir: directory, lib: { entry: entries, formats: ['es'], fileName: (_format, name) => `${name}.js` }
  } });
  browser = await chromium.launch();
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('http://localhost/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html>' });
    const file = path.resolve(directory, '.' + pathname);
    assert(file.startsWith(directory + path.sep));
    await route.fulfill({ contentType: pathname.endsWith('.js') ? 'text/javascript' : 'text/css', body: await readFile(file) });
  });
  await page.goto('http://localhost/');
  await page.evaluate(async names => {
    window.engines = Object.fromEntries(await Promise.all(names.map(async name => [name, await import(`/${name}.js`)])));
  }, Object.keys(entries));
  const result = { node: process.version, cpu: os.cpus()[0].model, browser: browser.version(),
    warmupIterations: 2, measuredIterations: 7, bindings: {}, cases: {} };
  for (const [name, file] of Object.entries(entries)) result.bindings[name] = hash(await readFile(file));
  for (const pageCount of [1, 16]) {
    const fixture = createMultipageTiff(pageCount), expected = hash(fixture.firstPage);
    await page.evaluate(bytes => { window.tiff = new Uint8Array(bytes); }, [...fixture.bytes]);
    const samples = Object.fromEntries(Object.keys(entries).map(name => [name, []]));
    for (let iteration = 0; iteration < result.warmupIterations + result.measuredIterations; iteration++) {
      const order = Object.keys(entries); if (iteration % 2) order.reverse();
      for (const name of order) {
        const row = await page.evaluate(async name => {
          const registry = new window.engines[name].MediaRegistry({ media: { image: { data: window.tiff, contentType: 'image/tiff' } } });
          try {
            const start = performance.now(); const url = registry.getUrl('image'); const elapsedMs = performance.now() - start;
            if (!url.startsWith('data:image/png;')) throw new Error('TIFF PNG conversion failed.');
            if (registry.getUrl('image') !== url) throw new Error('TIFF cache changed.');
            const bitmap = await createImageBitmap(await (await fetch(url)).blob());
            try {
              const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
              const context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0);
              const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
              const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', pixels))].map(value => value.toString(16).padStart(2, '0')).join('');
              return { elapsedMs, width: bitmap.width, height: bitmap.height, digest };
            } finally { bitmap.close(); }
          } finally { registry.destroy(); }
        }, name);
        assert.equal(row.width, fixture.width); assert.equal(row.height, fixture.height); assert.equal(row.digest, expected);
        if (iteration >= result.warmupIterations) samples[name].push(row.elapsedMs);
      }
    }
    const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    result.cases[`${pageCount}-page`] = { pageCount, width: fixture.width, height: fixture.height,
      inputBytes: fixture.bytes.length, inputSha256: hash(fixture.bytes), rgbaSha256: expected,
      timings: Object.fromEntries(Object.entries(samples).map(([name, values]) => [name, { medianMs: median(values), samplesMs: values }])) };
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (browser) await browser.close();
  await rm(directory, { recursive: true, force: true });
}
