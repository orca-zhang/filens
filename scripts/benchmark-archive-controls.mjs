// Real archive sessions and DOM events against saved/current production JS.
// Both use the same current core, stylesheet, browser and input bytes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { strToU8, zipSync } from 'fflate';

const option = (name, fallback) => {
  const i = process.argv.indexOf(name);
  if (i < 0) return fallback;
  assert(process.argv[i + 1] && !process.argv[i + 1].startsWith('--'), `${name} requires a value`);
  return process.argv[i + 1];
};
const baseline = option('--baseline', 'tmp/shared-readers-baseline/archive-dist/index.js');
const output = option('--output', 'tmp/shared-readers-current/archive.json');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
await mkdir(path.dirname(output), { recursive: true });
const server = await createServer({ configFile: false, root: process.cwd(), logLevel: 'error',
  cacheDir: 'tmp/shared-readers-vite-cache', optimizeDeps: { include: ['fflate', 'utif'] },
  server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch();
const modules = { baseline, current: 'packages/archive/dist/index.js' };
const result = { date: '2026-11-04', cpu: os.cpus()[0].model, node: process.version, browser: browser.version(),
  warmupIterations: 2, measuredIterations: 7, keyboardEvents: 200,
  method: 'Real archive sessions loaded from production JS through Vite import resolution. Alternating old/current implementations, fresh session per iteration. Both share current core and CSS. Input creation, module loading, warmup, DOM/HTML validation and hashing are outside timings. Keyboard events include synchronous event handling and focus; filtering includes full synchronous result DOM rebuilds. No animation-frame or physical paint measurement.',
  artifacts: {}, cases: {} };
for (const file of [...Object.values(modules), 'packages/core/dist/index.js', 'packages/archive/dist/index.css', 'packages/archive/src/preview-driver.ts'])
  result.artifacts[file] = hash(await readFile(file));
const pages = {};
const errors = [];
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
try {
  for (const [name, module] of Object.entries(modules)) {
    const page = pages[name] = await browser.newPage({ viewport: { width: 1024, height: 768 }, locale: 'en-US', timezoneId: 'UTC' });
    page.on('pageerror', error => errors.push(error.message));
    await page.route(origin + '/', route => route.fulfill({ contentType: 'text/html', body:
      '<!doctype html><link rel="stylesheet" href="/packages/archive/dist/index.css"><div id="host" style="height:600px"></div>' }));
    await page.goto(origin);
    await page.evaluate(async module => { window.archiveLib = await import('/' + module); }, module);
  }
  for (const count of [200, 5000]) {
    const contents = {};
    for (let i = count - 1; i >= 0; i--) contents[`note-${String(i).padStart(6, '0')}.txt`] =
      [strToU8('x'.repeat(1 + i % 31)), { mtime: new Date(Date.UTC(2020, 0, 1 + i % 20)) }];
    const bytes = zipSync(contents, { level: 1 });
    const samples = { baseline: [], current: [] };
    let expected;
    for (const page of Object.values(pages)) await page.evaluate(bytes => { window.archiveBytes = new Uint8Array(bytes); }, [...bytes]);
    for (let iteration = 0; iteration < result.warmupIterations + result.measuredIterations; iteration++) {
      for (const name of iteration % 2 ? ['current', 'baseline'] : ['baseline', 'current']) {
        const row = await pages[name].evaluate(async keyboardEvents => {
          const host = document.getElementById('host'), source = window.archiveBytes;
          const session = new window.archiveLib.ArchivePreviewSession(host);
          const start = performance.now();
          await session.load(source, { descriptor: { source, name: 'controls.zip', extension: 'zip' } });
          const loadMs = performance.now() - start;
          const body = host.querySelector('tbody');
          body.rows[0].focus();
          host.getBoundingClientRect();
          const trail = [];
          const keyboardStart = performance.now();
          for (let i = 0; i < keyboardEvents; i++) {
            document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: i % 2 ? 'ArrowUp' : 'ArrowDown', bubbles: true, cancelable: true }));
            trail.push(document.activeElement.querySelector('.archivev-filename')?.textContent);
          }
          const keyboardMs = performance.now() - keyboardStart;
          const select = host.querySelector('select');
          select.value = 'size'; select.dispatchEvent(new Event('change'));
          const input = host.querySelector('input');
          const snapshots = [];
          const filterSamplesMs = [];
          for (const query of ['note-0000', 'note-00001', 'missing', 'note-0002']) {
            input.value = query;
            const filterStart = performance.now();
            input.dispatchEvent(new Event('input'));
            filterSamplesMs.push(performance.now() - filterStart);
            const names = [...body.rows].map(row => row.querySelector('.archivev-filename').textContent);
            const expected = session.getState().entries.filter(entry => entry.name.includes(query))
              .sort((a, b) => b.size - a.size || a.name.localeCompare(b.name)).map(entry => entry.name);
            if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error('Filtered result order differs');
            snapshots.push({ query, names, html: body.innerHTML });
          }
          const state = session.getState();
          session.destroy();
          if (host.childElementCount !== 0) throw new Error('Destroy left DOM');
          return { loadMs, keyboardMs, filterSamplesMs, trail, snapshots, state };
        }, result.keyboardEvents);
        const signature = hash(JSON.stringify({ trail: row.trail, snapshots: row.snapshots, state: row.state }));
        expected ??= signature;
        assert.equal(signature, expected, `${count}/${name}: complete state, focus or DOM differs`);
        assert.equal(row.trail.length, result.keyboardEvents);
        assert(row.trail.every((name, i) => name === `note-${i % 2 ? '000000' : '000001'}.txt`));
        if (iteration >= result.warmupIterations) samples[name].push({ loadMs: row.loadMs, keyboardMs: row.keyboardMs,
          filtersMs: row.filterSamplesMs.reduce((a, b) => a + b, 0), filterSamplesMs: row.filterSamplesMs });
      }
    }
    result.cases[count] = { files: count, archiveBytes: bytes.length, archiveSha256: hash(bytes), outputSha256: expected,
      timings: Object.fromEntries(Object.entries(samples).map(([name, values]) => [name, { samples: values,
        medians: Object.fromEntries(['loadMs', 'keyboardMs', 'filtersMs'].map(key => [key, median(values.map(row => row[key]))])) }])) };
  }
  assert.deepEqual(errors, []);
  result.errors = errors;
  await writeFile(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(Object.fromEntries(Object.entries(result.cases).map(([name, row]) =>
    [name, Object.fromEntries(Object.entries(row.timings).map(([name, values]) => [name, values.medians]))])), null, 2));
} finally {
  await Promise.allSettled(Object.values(pages).map(page => page.close()));
  await browser.close();
  await server.close();
}
