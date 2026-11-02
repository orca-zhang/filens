// Compare two actual standalone builds, with the same browser/network settings.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { chromium, expect } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const builds = {
  before: path.resolve(root, process.env.FILENS_BENCH_BEFORE || 'tmp/preview-size-optimization/before'),
  after: path.resolve(root, process.env.FILENS_BENCH_AFTER || 'packages/preview/dist')
};
const iterations = Number(process.env.FILENS_BENCH_ITERATIONS || 5);
const observations = [], cache = new Map();
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    const [, build, ...parts] = url.pathname.split('/');
    assert.ok(builds[build]);
    const file = path.resolve(builds[build], ...parts);
    assert.ok(file.startsWith(builds[build] + path.sep));
    if (!cache.has(file)) cache.set(file, gzipSync(await readFile(file), { level: 9 }));
    const bytes = cache.get(file);
    response.writeHead(200, {
      'Content-Type': file.endsWith('.html') ? 'text/html' : /\.m?js$/.test(file) ? 'text/javascript' : file.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream',
      'Content-Encoding': 'gzip', 'Content-Length': bytes.length,
      'Cache-Control': 'public, max-age=3600'
    });
    response.end(bytes);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const fixtures = [
  ['legacy-doc', 'apps/demo/public/samples/legacy-project-workflow.doc'],
  ['raw-image', 'apps/demo/public/samples/raw/pentax-k-r.dng'],
  ['encrypted-rar', 'packages/archive/test/fixtures/rar5-encrypted-filenames.rar']
];
try {
  for (let iteration = 0; iteration < iterations; iteration++) {
    for (const build of iteration % 2 ? ['after', 'before'] : ['before', 'after']) {
      for (const mode of ['split', 'all-in-one']) for (const [fixture, file] of fixtures) {
        const context = await browser.newContext();
        try {
          const page = await context.newPage();
          const cdp = await context.newCDPSession(page);
          await cdp.send('Network.enable');
          await cdp.send('Network.emulateNetworkConditions', {
            offline: false, latency: 20, downloadThroughput: 4_000_000,
            uploadThroughput: 4_000_000
          });
          const errors = [], archiveRequests = [];
          page.on('pageerror', error => errors.push(error.message));
          context.on('request', request => { if (request.url().endsWith('/archive/7zz.wasm')) archiveRequests.push(request.url()); });
          const start = performance.now();
          await page.goto(`${origin}/${build}/${mode}/index.html`);
          await page.locator('#file').waitFor();
          const loaded = performance.now();
          await page.locator('#file').setInputFiles(path.join(root, file));
          const row = { iteration, build, mode, fixture, pageLoadMs: loaded - start };
          if (fixture === 'encrypted-rar') {
            const password = page.locator('input[type=password]');
            await password.waitFor();
            row.openMs = performance.now() - loaded;
            await password.fill('wrong');
            let tick = performance.now();
            await password.press('Enter');
            await expect(page.getByRole('alert')).toBeVisible();
            row.passwordRetryMs = performance.now() - tick;
            await password.fill('password');
            tick = performance.now();
            await password.press('Enter');
            await page.locator('tr.archivev-row').filter({ hasText: 'c.txt' }).waitFor();
            row.unlockMs = performance.now() - tick;
            tick = performance.now();
            await page.locator('tr.archivev-row').filter({ hasText: 'c.txt' }).click();
            await expect(page.locator('.archivev-entry-preview')).toContainText('This is from c.txt');
            row.extractMs = performance.now() - tick;
            row.wasmRequests = archiveRequests.length;
            if (build === 'after') assert.equal(row.wasmRequests, 1);
          } else {
            await page.waitForFunction(() => ['ready', 'error'].includes(document.body.dataset.state), null, { timeout: 30_000 });
            assert.equal(await page.evaluate(() => document.body.dataset.state), 'ready');
            row.openMs = performance.now() - loaded;
          }
          assert.deepEqual(errors, []);
          observations.push(row);
        } finally { await context.close(); }
      }
    }
    console.log(`Preview benchmark iteration ${iteration + 1}/${iterations} completed.`);
  }
  const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const summary = [];
  for (const mode of ['split', 'all-in-one']) for (const [fixture] of fixtures) {
    const row = { mode, fixture };
    for (const build of ['before', 'after']) {
      const runs = observations.filter(run => run.mode === mode && run.fixture === fixture && run.build === build);
      row[build] = Object.fromEntries(['pageLoadMs', 'openMs', 'passwordRetryMs', 'unlockMs', 'extractMs', 'wasmRequests']
        .filter(key => runs[0][key] !== undefined).map(key => [key, Math.round(median(runs.map(run => run[key])) * 10) / 10]));
    }
    summary.push(row);
  }
  const report = {
    date: new Date().toISOString(), platform: `${process.platform}-${process.arch}`,
    browser: browser.version(), iterations,
    scope: 'Actual previews, fresh browser context per case, gzip HTTP, 4 MB/s and 20 ms latency; normal HTTP caching retained within each case. Alternating before/after order. Median wall times include browser/UI scheduling. No claim for other devices or formats.',
    summary, observations
  };
  const output = path.resolve(root, process.env.FILENS_BENCH_REPORT || 'tmp/preview-size-optimization/preview-runtime-benchmark.json');
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Saved ${output}`);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
