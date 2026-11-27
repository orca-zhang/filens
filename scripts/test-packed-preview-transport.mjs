import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync, brotliDecompressSync } from 'node:zlib';
import { chromium, expect } from '@playwright/test';
import { transform } from 'esbuild';
import { createRegexWorkbook } from '../packages/xlsx/test/fixtures/array-selection-workbook.mjs';

const directoryIndex = process.argv.indexOf('--directory');
const directory = directoryIndex < 0 ? 'packages/preview/dist/all-in-one' : process.argv[directoryIndex + 1];
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
const regexWorkbook = Buffer.from(await createRegexWorkbook()).toString('base64');
const regexEngine = await readFile(`${directory}/xlsx/pcre2.wasm`);
const fixtures = await Promise.all([
  ['apps/demo/public/samples/filens-cosmic-atlas.pdf', 'atlas.pdf'],
  ['apps/demo/public/samples/legacy-project-workflow.doc', 'legacy.doc'],
  ['apps/demo/public/samples/a.pages', 'sample.pages'],
  ['apps/demo/public/samples/a.numbers', 'sample.numbers'],
  ['apps/demo/public/samples/filens-weekend.key', 'weekend.key'],
  ['packages/converter-client/test/fixtures/heif/420-srgb8-full.heic', 'color.heic'],
  ['apps/demo/public/samples/raw/pentax-k-r.dng', 'camera.dng'],
  ['apps/demo/public/samples/filens-cosmic-atlas.pdf', 'atlas-again.pdf']
].map(async ([file, name]) => ({ name, base64: (await readFile(file)).toString('base64') })));
const isIwork = fixture => /\.(pages|numbers|key)$/.test(fixture.name);
const csp = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; connect-src 'self' blob: data:; worker-src 'self' blob:; img-src 'self' blob: data:; font-src 'self' blob: data:";
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (/^\/(gzip|br)\/xlsx\/pcre2\.wasm$/.test(url.pathname)) {
    response.writeHead(200, { 'content-type': 'application/wasm' });
    response.end(regexEngine); return;
  }
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
  // Existing protobuf fallback code in iWork needs dynamic functions. Keep the
  // other formats under the stronger policy, and test iWork separately.
  response.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': url.searchParams.has('iwork')
    ? csp.replace("'wasm-unsafe-eval'", "'wasm-unsafe-eval' 'unsafe-eval'") : csp });
  response.end('<!doctype html><div id="host" style="width:800px;height:600px"></div><script type="module" src="/loader.js"></script>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch(), cases = [];
try {
  for (const kind of process.argv.includes('--offline-only') ? [] : Object.keys(representations)) {
    const samples = [];
    for (let trial = 0; trial < 3; trial++) {
      const page = await browser.newPage(), errors = [], requests = [], violations = [];
      await page.addInitScript(() => {
        window.wasmBlobs = 0; window.workerBlobs = 0;
        window.Blob = new Proxy(Blob, {
          construct(target, args, newTarget) {
            const blob = Reflect.construct(target, args, newTarget);
            if (blob.type.startsWith('text/javascript')) window.workerBlobs++;
            return blob;
          }
        });
        const original = URL.createObjectURL;
        URL.createObjectURL = blob => { if (blob.type === 'application/wasm') window.wasmBlobs++; return original(blob); };
      });
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
        if (report.groups && kind !== 'baseline') assert.equal(await page.evaluate(() => window.wasmBlobs), 0, 'Text must not restore WASM.');
        if (report.groups?.length > 2 && kind !== 'baseline') assert.equal(await page.evaluate(() => window.workerBlobs), 0, 'Text must not create workers.');
        samples.push(await page.evaluate(() => window.importMs));
        if (!trial) {
          await page.evaluate(bytes => window.viewer.update({ src: new Uint8Array(bytes), name: 'cube.stp' }), step);
          await expect.poll(() => page.evaluate(() => window.lastRendered?.title), { timeout: 30000 }).toBe('cube.stp');
          assert.equal(await page.evaluate(() => window.lastRendered.metadata.triangleCount), 12);
          for (const fixture of fixtures.filter(fixture => !isIwork(fixture))) {
            await page.evaluate(({ base64, name }) => window.viewer.update({ src: Uint8Array.fromBase64(base64), name }), fixture);
            await expect.poll(() => page.evaluate(() => window.lastRendered?.title), { timeout: 60_000 }).toBe(fixture.name);
          }
          const regexRequests = () => requests.filter(url => url.endsWith('/xlsx/pcre2.wasm'));
          assert.equal(regexRequests().length, 0);
          if (kind !== 'baseline') {
            await page.evaluate(base64 => window.viewer.update({ src: Uint8Array.fromBase64(base64), name: 'regex.xlsx' }), regexWorkbook);
            await expect(page.locator('.xlsxv-grid tr[aria-rowindex="2"] td[aria-colindex="2"]')).toHaveText('TRUE');
            assert.equal(regexRequests().length, 1);
          }
          assert.equal(requests.filter(url => /\/filens\.js$/.test(url)).length, 1);
          assert.deepEqual(await page.evaluate(() => window.previewErrors), []);
          await page.evaluate(() => window.viewer.destroy());
          await page.goto(`${origin}/?kind=${kind}&iwork=1`);
          await expect(page.locator('#host')).toContainText('Compressed transport marker');
          for (const fixture of fixtures.filter(isIwork)) {
            await page.evaluate(({ base64, name }) => {
              window.lastRendered = null; window.viewer.update({ src: Uint8Array.fromBase64(base64), name });
            }, fixture);
            await page.waitForFunction(() => window.lastRendered || window.previewErrors.length, null, { timeout: 60_000 });
            assert.deepEqual(await page.evaluate(() => window.previewErrors), [], fixture.name);
            assert(await page.locator('#host').innerText(), `${fixture.name} must render content.`);
          }
          assert.deepEqual(await page.evaluate(() => window.previewErrors), []);
        }
        await page.evaluate(() => window.viewer.destroy());
        await expect(page.locator('#host')).toBeEmpty();
        assert.deepEqual(errors, []);
        assert.deepEqual(violations, []);
      } finally { await page.close(); }
    }
    cases.push({ encoding: kind, bytes: representations[kind].length, samplesMs: samples,
      medianImportMs: [...samples].sort((a, b) => a - b)[1], cspWithoutJsEval: true,
      formats: ['text', 'step', ...fixtures.map(fixture => fixture.name)], deferredWasm: Boolean(report.groups) });
  }
  const offlineDirectory = await mkdtemp(path.join(tmpdir(), 'filens-packed-offline-'));
  const context = await browser.newContext({ offline: true });
  try {
    const html = path.join(offlineDirectory, 'preview.html');
    await writeFile(html, `<!doctype html><div id="host" style="width:800px;height:600px"></div><script type="module">
      const bytes=Uint8Array.from(atob('${code.toString('base64')}'),character=>character.charCodeAt(0));
      window.runtimeUrl=URL.createObjectURL(new Blob([bytes],{type:'text/javascript'}));
      const {createPreview}=await import(window.runtimeUrl);
      window.previewErrors=[];
      window.viewer=createPreview('#host',{src:new File(['Offline grouped assets'],'offline.txt'),
        onRendered:state=>window.lastRendered=state,onError:error=>window.previewErrors.push(error.message)});
      </script>`);
    const page = await context.newPage(), network = [], errors = [];
    await page.addInitScript(() => {
      const workers = window.localPdfWorkers = { started: 0, stopped: 0 };
      window.Worker = new Proxy(Worker, {
        construct(Worker, args) {
          const worker = new Worker(...args);
          if (args[1]?.name !== 'FiLens PDF') return worker;
          workers.started++;
          const terminate = worker.terminate.bind(worker);
          worker.terminate = () => { workers.stopped++; terminate(); };
          return worker;
        }
      });
    });
    page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(html).href);
    await expect(page.locator('#host')).toContainText('Offline grouped assets');
    for (const fixture of [{ name: 'cube.stp', base64: Buffer.from(step).toString('base64') }, ...fixtures]) {
      await page.evaluate(({ base64, name }) => {
        window.lastRendered = null; window.viewer.update({ src: Uint8Array.fromBase64(base64), name });
      }, fixture);
      await page.waitForFunction(() => window.lastRendered || window.previewErrors.length, null, { timeout: 60_000 });
      assert.deepEqual(await page.evaluate(() => window.previewErrors), [], fixture.name);
      if (!isIwork(fixture)) assert.equal(await page.evaluate(() => window.lastRendered.title), fixture.name);
      if (fixture.name === 'cube.stp') assert.equal(await page.evaluate(() => window.lastRendered.metadata.triangleCount), 12);
    }
    assert.deepEqual(network, []);
    assert.deepEqual(errors, []);
    assert.deepEqual(await page.evaluate(() => window.previewErrors), []);
    await expect.poll(() => page.evaluate(() => window.localPdfWorkers)).toEqual({ started: 2, stopped: 1 });
    await page.evaluate(() => { window.viewer.destroy(); URL.revokeObjectURL(window.runtimeUrl); });
    await expect(page.locator('#host')).toBeEmpty();
    await expect.poll(() => page.evaluate(() => window.localPdfWorkers)).toEqual({ started: 2, stopped: 2 });
  } finally { await context.close(); await rm(offlineDirectory, { recursive: true }); }
  console.log(JSON.stringify({ browser: browser.version(), limit: 4_000_000, exactEncodings: true, es2020: true,
    offlineFileHtml: true, iworkCsp: 'Existing protobuf fallback requires unsafe-eval; tested separately from strict-CSP formats.', cases }, null, 2));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
