import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const directory = path.resolve(process.argv[2] ?? 'packages/converter-client');
const output = process.argv[3];
const pkg = JSON.parse(await readFile(path.join(directory, 'package.json')));
const entry = pkg.exports['./format-detector'];
assert(entry?.import && entry?.types);
await readFile(path.join(directory, entry.types));
const { createAutoFormatDetector } = await import(pathToFileURL(path.join(directory, entry.import)));
const nodeDetector = await createAutoFormatDetector({
  scalar: () => readFile(path.join(directory, 'dist/converter-detect-scalar.wasm')),
  simd: () => readFile(path.join(directory, 'dist/converter-detect-simd.wasm'))
});
const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
const expected = nodeDetector.detect(new TextEncoder().encode(svg));
assert.equal(expected.format, 'svg');
const result = { node: process.version, entry, cases: {}, artifacts: {} };
for (const file of [entry.import, entry.types, 'dist/converter-detect-scalar.wasm', 'dist/converter-detect-simd.wasm']) {
  const bytes = await readFile(path.join(directory, file));
  result.artifacts[file] = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
const browser = await chromium.launch();
result.browser = browser.version();
try {
  for (const mode of ['simd', 'unsupported', 'http-failure', 'malformed-simd', 'scalar-http-failure']) {
    const page = await browser.newPage();
    const requests = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://localhost/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html>' });
      assert(pathname.startsWith('/nested/package/'));
      const relative = pathname.slice('/nested/package/'.length);
      const filename = path.resolve(directory, relative);
      assert(filename.startsWith(directory + path.sep));
      if (relative.endsWith('.wasm')) {
        requests.push(path.basename(relative));
        if (mode === 'http-failure' && relative.includes('-simd.')) return route.fulfill({ status: 503, body: 'Unavailable' });
        if (mode === 'malformed-simd' && relative.includes('-simd.')) return route.fulfill({ body: Buffer.from([1, 2, 3]) });
        if (mode === 'scalar-http-failure' && relative.includes('-scalar.')) return route.fulfill({ status: 404, body: 'Not found' });
      }
      return route.fulfill({ contentType: relative.endsWith('.wasm') ? 'application/wasm' : 'text/javascript', body: await readFile(filename) });
    });
    await page.goto('http://localhost/');
    await page.evaluate(async ({ entry, mode }) => {
      window.lib = await import('/nested/package/' + entry.replace(/^\.\//, ''));
      if (mode === 'unsupported' || mode === 'scalar-http-failure') WebAssembly.validate = () => false;
    }, { entry: entry.import, mode });
    assert.deepEqual(requests, [], `${mode}: importing the module fetched WASM`);
    const actual = await page.evaluate(async svg => {
      try {
        const detector = await window.lib.createAutoFormatDetector();
        return { implementation: detector.implementation, output: detector.detect(new TextEncoder().encode(svg)) };
      } catch (error) { return { error: error.message }; }
    }, svg);
    const expectedRequests = mode === 'simd' ? ['converter-detect-simd.wasm']
      : mode === 'unsupported' || mode === 'scalar-http-failure' ? ['converter-detect-scalar.wasm']
        : ['converter-detect-simd.wasm', 'converter-detect-scalar.wasm'];
    assert.deepEqual(requests, expectedRequests, mode);
    if (mode === 'scalar-http-failure') assert.match(actual.error, /HTTP 404/);
    else {
      assert.equal(actual.implementation, mode === 'simd' ? 'simd128' : 'scalar');
      assert.deepEqual(actual.output, expected);
    }
    assert.deepEqual(errors, []);
    result.cases[mode] = { requests, actual, errors };
    await page.close();
  }
} finally { await browser.close(); }
if (output) await writeFile(output, JSON.stringify(result, null, 2) + '\n');
console.log('PASS: packaged exports, actual WASM, nested URLs, lazy downloads and five browser fallback scenarios.');
