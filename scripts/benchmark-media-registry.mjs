// Browser media URL creation only: excludes imports, fixture creation and hashing.
// Build core first; --baseline points to a saved pre-change core dist directory.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { build } from 'vite';

const baselineIndex = process.argv.indexOf('--baseline');
const baseline = baselineIndex < 0 ? undefined : process.argv[baselineIndex + 1];
if (baselineIndex >= 0 && (!baseline || baseline.startsWith('--'))) throw new Error('--baseline requires a directory.');
const entries = { current: path.resolve('packages/core/dist/index.js'), ...(baseline ? { baseline: path.resolve(baseline, 'index.js') } : {}) };
const directory = await mkdtemp(path.join(os.tmpdir(), 'filens-media-registry-'));
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
    nativeBase64: await page.evaluate(() => typeof Uint8Array.prototype.toBase64 === 'function'),
    warmupIterations: 2, measuredIterations: 7, bindings: {}, cases: {} };
  for (const [name, file] of Object.entries(entries)) result.bindings[name] = createHash('sha256').update(await readFile(file)).digest('hex');
  for (const [mode, mediaBytes, mediaCount] of [
    ['blob', 4 * 1024 * 1024, 8], ['base64', 1024 * 1024, 4], ['base64-fallback', 1024 * 1024, 4]
  ]) {
    const samples = Object.fromEntries(Object.keys(entries).map(name => [name, []]));
    let outputHash;
    for (let iteration = 0; iteration < result.warmupIterations + result.measuredIterations; iteration++) {
      const order = Object.keys(entries);
      if (iteration % 2) order.reverse();
      for (const name of order) {
        const row = await page.evaluate(async ({ name, mode, mediaBytes, mediaCount }) => {
          const media = {};
          // Include a non-zero offset so the benchmark also checks view boundaries.
          for (let index = 0; index < mediaCount; index++) {
            const data = Uint8Array.from({ length: mediaBytes + 7 }, (_, offset) => (index + offset) % 256).subarray(3, mediaBytes + 3);
            media[index] = { id: String(index), path: `${index}.bin`, contentType: 'application/octet-stream', data };
          }
          const registry = new window.engines[name].MediaRegistry({ media });
          const create = URL.createObjectURL;
          const native = Object.getOwnPropertyDescriptor(Uint8Array.prototype, 'toBase64');
          if (mode.startsWith('base64')) URL.createObjectURL = undefined;
          if (mode === 'base64-fallback') Reflect.deleteProperty(Uint8Array.prototype, 'toBase64');
          try {
            const start = performance.now();
            const urls = Object.keys(media).map(id => registry.getUrl(id));
            const elapsedMs = performance.now() - start;
            const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
            const hashes = [];
            for (let index = 0; index < urls.length; index++) {
              if (registry.getUrl(String(index)) !== urls[index]) throw new Error('Media URL cache changed.');
              const response = await fetch(urls[index]);
              const bytes = await response.arrayBuffer();
              const hash = await digest(bytes);
              if (bytes.byteLength !== mediaBytes || hash !== await digest(media[index].data)) throw new Error('Media bytes changed.');
              if (response.headers.get('Content-Type') !== 'application/octet-stream') throw new Error('Media MIME type changed.');
              hashes.push(hash);
            }
            return { elapsedMs, hashes };
          } finally {
            registry.destroy(); URL.createObjectURL = create;
            if (native) Object.defineProperty(Uint8Array.prototype, 'toBase64', native);
          }
        }, { name, mode, mediaBytes, mediaCount });
        outputHash ??= row.hashes;
        assert.deepEqual(row.hashes, outputHash);
        if (iteration >= result.warmupIterations) samples[name].push(row.elapsedMs);
      }
    }
    const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    result.cases[mode] = { mediaBytes, mediaCount, outputSha256: outputHash,
      timings: Object.fromEntries(Object.entries(samples).map(([name, values]) => [name, { medianMs: median(values), samplesMs: values }])) };
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (browser) await browser.close();
  await rm(directory, { recursive: true, force: true });
}
