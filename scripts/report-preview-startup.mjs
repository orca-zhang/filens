// Measure actual static JS requests when importing the standalone split entry.
// Optional --baseline points to an older preview dist containing both variants.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { chromium } from '@playwright/test';

const baselineIndex = process.argv.indexOf('--baseline');
const baseline = baselineIndex < 0 ? undefined : process.argv[baselineIndex + 1];
if (baselineIndex >= 0 && (!baseline || baseline.startsWith('--'))) throw new Error('--baseline requires a directory.');
const directories = { current: path.resolve('packages/preview/dist'), ...(baseline ? { baseline: path.resolve(baseline) } : {}) };
const sizes = bytes => ({ raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length, brotli: brotliCompressSync(bytes).length });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const browser = await chromium.launch();
const result = { node: process.version, browser: browser.version(), builds: {} };
try {
  for (const [name, directory] of Object.entries(directories)) {
    const page = await browser.newPage(), requested = new Set(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://localhost/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html>' });
      const file = path.resolve(directory, 'split', '.' + pathname);
      assert(file.startsWith(path.join(directory, 'split') + path.sep));
      if (pathname.endsWith('.js')) requested.add(file);
      await route.fulfill({ contentType: 'text/javascript', body: await readFile(file) });
    });
    await page.goto('http://localhost/');
    await page.evaluate(async () => { const lib = await import('/filens.js'); if (typeof lib.createPreview !== 'function') throw new Error('Missing preview entry.'); });
    assert.deepEqual(errors, []);
    assert(requested.size > 0);
    if (name === 'current') assert([...requested].every(file => !/\/(zip-encrypted|office-attachments|xml-compat|model-vrml|model-fbx|model-3ds)-/.test(file)), 'Optional codecs entered startup.');
    const startupFiles = {};
    for (const file of [...requested].sort()) {
      const bytes = await readFile(file);
      startupFiles[path.relative(directory, file)] = { ...sizes(bytes), sha256: hash(bytes) };
    }
    const sum = values => values.reduce((total, row) => Object.fromEntries(Object.keys(total).map(key => [key, total[key] + row[key]])), { raw: 0, gzip: 0, brotli: 0 });
    const allJs = [];
    for (const file of await readdir(path.join(directory, 'split'), { recursive: true })) {
      if (/\.m?js$/.test(file)) allJs.push(sizes(await readFile(path.join(directory, 'split', file))));
    }
    result.builds[name] = { startup: sum(Object.values(startupFiles)), startupFiles, splitAllJs: sum(allJs),
      allInOneJs: sizes(await readFile(path.join(directory, 'all-in-one/filens.js'))) };
    await page.close();
  }
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
