import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync, brotliDecompressSync } from 'node:zlib';
import { chromium, expect } from '@playwright/test';
import { transform } from 'esbuild';

const directory = 'packages/preview/dist/all-in-one';
const code = await readFile(`${directory}/filens.js`), report = JSON.parse(await readFile(`${directory}/asset-packing.json`, 'utf8'));
const representations = { gzip: await readFile(`${directory}/filens.js.gz`), br: await readFile(`${directory}/filens.js.br`) };
assert.deepEqual(gunzipSync(representations.gzip), code);
assert.deepEqual(brotliDecompressSync(representations.br), code);
for (const [name, bytes] of Object.entries(representations)) {
  assert(bytes.length <= 4_000_000, `${name} exceeds 4 MB.`);
  const recorded = report.delivery[name === 'br' ? 'brotli' : name];
  assert.equal(bytes.length, recorded.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), recorded.sha256);
}
// Preserve ordinary downstream ES2020 builds: no top-level await or loader module.
await transform(code.toString(), { loader: 'js', target: 'es2020', format: 'esm' });
const baselineIndex = process.argv.indexOf('--baseline');
if (baselineIndex >= 0) representations.baseline = gzipSync(await readFile(process.argv[baselineIndex + 1]), { level: 9 });
const step = [...await readFile('packages/model3d/test/fixtures/occt/cube.stp')];
const csp = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; connect-src 'self' blob: data:; worker-src 'self' blob:; img-src 'self' blob: data:; font-src 'self' blob: data:";
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname.endsWith('/filens.js')) {
    const kind = url.pathname.split('/')[1], bytes = representations[kind];
    if (!bytes) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'content-type': 'text/javascript', 'content-encoding': kind === 'baseline' ? 'gzip' : kind,
      'content-length': bytes.length, 'cache-control': 'no-store' });
    response.end(bytes); return;
  }
  if (url.pathname === '/loader.js') {
    response.writeHead(200, { 'content-type': 'text/javascript' });
    response.end(`const start=performance.now();
      const {createPreview}=await import('/'+new URL(location.href).searchParams.get('kind')+'/filens.js');
      window.importMs=performance.now()-start;window.previewErrors=[];
      window.viewer=createPreview('#host',{src:new TextEncoder().encode('Compressed transport marker'),name:'initial.txt',
        onRendered:state=>{window.lastRendered=state},onError:error=>window.previewErrors.push(error.message)});`);
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': csp });
  response.end('<!doctype html><div id="host" style="width:800px;height:600px"></div><script type="module" src="/loader.js"></script>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch(), cases = [];
try {
  for (const kind of Object.keys(representations)) {
    const samples = [];
    for (let trial = 0; trial < 3; trial++) {
      const page = await browser.newPage(), errors = [], requests = [], violations = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (/Content Security Policy|Refused to/.test(message.text())) violations.push(message.text()); });
      await page.route('**/*', route => {
        const url = route.request().url();
        if (!url.startsWith(origin) && !/^(blob:|data:)/.test(url)) return route.abort();
        requests.push(url); return route.continue();
      });
      try {
        await page.goto(`${origin}/?kind=${kind}`);
        await expect(page.locator('#host')).toContainText('Compressed transport marker');
        samples.push(await page.evaluate(() => window.importMs));
        if (!trial) {
          await page.evaluate(bytes => window.viewer.update({ src: new Uint8Array(bytes), name: 'cube.stp' }), step);
          await expect.poll(() => page.evaluate(() => window.lastRendered?.title), { timeout: 30000 }).toBe('cube.stp');
          assert.equal(await page.evaluate(() => window.lastRendered.metadata.triangleCount), 12);
          assert.equal(requests.filter(url => /\/filens\.js$/.test(url)).length, 1);
          assert.deepEqual(await page.evaluate(() => window.previewErrors), []);
        }
        await page.evaluate(() => window.viewer.destroy());
        await expect(page.locator('#host')).toBeEmpty();
        assert.deepEqual(errors, []);
        assert.deepEqual(violations, []);
      } finally { await page.close(); }
    }
    cases.push({ encoding: kind, bytes: representations[kind].length, samplesMs: samples,
      medianImportMs: [...samples].sort((a, b) => a - b)[1], cspWithoutJsEval: true, textAndStep: true });
  }
  console.log(JSON.stringify({ browser: browser.version(), limit: 4_000_000, exactEncodings: true, es2020: true, cases }, null, 2));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
