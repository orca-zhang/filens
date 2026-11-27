// Exercise the actual packaged mobile page and shared engines, with both bridge shapes.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync } from 'node:zlib';
import { chromium, expect, webkit } from '@playwright/test';
import { createRegexWorkbook } from '../packages/xlsx/test/fixtures/array-selection-workbook.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.join(root, 'sdk/ios/Sources/FilensPreview/Resources/filens');
const androidAssets = path.join(root, 'sdk/android/filens-preview/src/main/assets/filens');
const policy = (await readFile(path.join(assets, 'mobile.html'), 'utf8')).match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
for (const file of ['mobile.html', 'mobile.js', 'filens.js.br', 'archive/7zz.wasm.br', 'THIRD-PARTY-NOTICES.txt.br', 'LICENSE']) {
  assert.deepEqual(await readFile(path.join(assets, file)), await readFile(path.join(androidAssets, file)), `SDK assets differ: ${file}`);
}
// Every original engine/worker must survive packing, with no uncompressed duplicate.
let rawBytes = 0, storedBytes = 0;
async function verifyRuntime(relative = '') {
  const runtime = path.join(root, 'packages/preview/dist/mobile');
  for (const entry of await readdir(path.join(runtime, relative), { withFileTypes: true })) {
    const file = path.join(relative, entry.name);
    if (entry.isDirectory()) { await verifyRuntime(file); continue; }
    if (file === 'index.html') continue;
    const original = await readFile(path.join(runtime, file));
    if (file === 'THIRD-PARTY-NOTICES.txt') {
      for (const directory of [assets, androidAssets]) {
        const notices = brotliDecompressSync(await readFile(path.join(directory, `${file}.br`))).toString();
        assert.ok(notices.startsWith(original.toString()));
        assert.ok(notices.includes('Android Brotli decoder: org.brotli:dec:0.1.2'));
        assert.ok(notices.endsWith(await readFile(path.join(root, 'sdk/mobile/BROTLI-LICENSE.txt'), 'utf8')));
      }
      continue;
    }
    const compressed = /\.(?:m?js|wasm)$/.test(file);
    for (const directory of [assets, androidAssets]) {
      const stored = await readFile(path.join(directory, file + (compressed ? '.br' : '')));
      assert.deepEqual(compressed ? brotliDecompressSync(stored) : stored, original, `Changed SDK runtime: ${file}`);
      if (compressed) await assert.rejects(readFile(path.join(directory, file)), { code: 'ENOENT' });
      if (directory === assets) { rawBytes += original.length; storedBytes += stored.length; }
    }
  }
}
await verifyRuntime();
assert.deepEqual(brotliDecompressSync(await readFile(path.join(assets, 'converter-core.wasm.br'))),
  await readFile(path.join(root, 'wasm/converter-core/dist/converter-core-mobile.wasm')));
for (const file of ['converter-office.wasm', 'converter-postscript.wasm', 'converter-raster.wasm', 'converter-cad.wasm']) {
  await assert.rejects(readFile(path.join(assets, `${file}.br`)), { code: 'ENOENT' });
}
assert.ok(storedBytes < rawBytes, 'Stored runtime must be smaller than its decoded contents');
console.log(`Offline runtime: ${rawBytes} decoded bytes → ${storedBytes} stored bytes`);
const sources = new Map();
const compressedRequests = new Set();
const server = createServer(async (request, response) => {
  try {
    const [id, ...parts] = new URL(request.url, 'http://localhost').pathname.slice(1).split('/');
    const source = sources.get(id), relative = parts.join('/');
    response.setHeader('Content-Security-Policy', policy);
    if (!source || !relative || parts.some(part => part === '..' || part === '.')) { response.writeHead(404).end(); return; }
    if (relative === 'source.json') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ requestId: id, url: './document', name: source.name, locale: 'zh_CN', toolbar: true }));
      return;
    }
    let bytes;
    if (relative === 'document') bytes = source.bytes;
    else {
      try { bytes = await readFile(path.join(assets, relative)); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        const compressed = await readFile(path.join(assets, `${relative}.br`));
        compressedRequests.add(`${id}/${relative}`);
        // iOS sends Brotli over loopback; Android supplies a decoded asset stream.
        if (source.transport === 'br') { bytes = compressed; response.setHeader('Content-Encoding', 'br'); }
        else bytes = brotliDecompressSync(compressed);
      }
    }
    response.setHeader('Content-Type', relative === 'document' ? source.contentType ?? 'application/octet-stream'
      : /\.m?js$/.test(relative) ? 'text/javascript' : relative.endsWith('.html') ? 'text/html'
      : relative.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');
    if (relative === 'document' && request.headers.range) {
      const match = request.headers.range.match(/^bytes=(\d+)-(\d*)$/);
      if (!match || Number(match[1]) >= bytes.length) { response.writeHead(416).end(); return; }
      const start = Number(match[1]), end = Math.min(match[2] ? Number(match[2]) : bytes.length - 1, bytes.length - 1);
      response.setHeader('Content-Range', `bytes ${start}-${end}/${bytes.length}`);
      response.setHeader('Content-Length', end - start + 1);
      response.writeHead(206).end(bytes.subarray(start, end + 1)); return;
    }
    response.end(bytes);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const cases = [
  { name: '中文 <script>.txt', bytes: Buffer.from('FILENS_MOBILE_LOCAL 中文\n<script>window.injected = true</script>'), text: 'FILENS_MOBILE_LOCAL' },
  { name: 'table.csv', bytes: Buffer.from('name,value\nMOBILE_WASM_TABLE,42\n'), text: 'MOBILE_WASM_TABLE' },
  { name: 'regex.xlsx', bytes: Buffer.from(await createRegexWorkbook()) },
  { name: 'page.html', contentType: 'text/html', bytes: Buffer.from('<h1>FILENS_MOBILE_HTML</h1>'), frameText: 'FILENS_MOBILE_HTML' },
  ...[
    'apps/demo/public/samples/filens-aurora-guide.docx',
    'apps/demo/public/samples/filens-cosmic-atlas.pdf',
    'apps/demo/public/samples/filens-observatory.xlsx',
    'apps/demo/public/samples/a.pages',
    'apps/demo/public/samples/pepper-carrot.epub',
    'apps/demo/public/samples/sample-video.mp4',
    'examples/converter/fixtures/doc/sample.doc',
    'examples/converter/fixtures/design/sample.eps',
    'examples/converter/fixtures/graphics/sample.tiff',
    'examples/converter/fixtures/graphics/sample.dwg',
    'examples/converter/fixtures/graphics/sample.jxl',
    'packages/converter-client/test/fixtures/heif/420-srgb8-full.heic',
    'examples/converter/fixtures/icons/sample.apk',
    'packages/archive/test/fixtures/rar5-encrypted-filenames.rar'
  ].map(file => ({ name: path.basename(file), file }))
];
for (const source of cases) {
  if (source.file) source.bytes = await readFile(path.join(root, source.file));
  if (source.name.endsWith('.mp4')) source.contentType = 'video/mp4';
}
const selections = (process.env.FILENS_MOBILE_TEST_BROWSERS || 'chromium,webkit').split(',');
let checks = 0;
try {
  for (const name of selections) {
    assert.ok(['chromium', 'webkit'].includes(name), `Unknown browser: ${name}`);
    const browser = await ({ chromium, webkit })[name].launch({ headless: true });
    try {
      const context = await browser.newContext();
      const errors = [];
      await context.route('**/*', route => {
        const url = route.request().url();
        if (url.startsWith(origin + '/') || url.startsWith('blob:') || url.startsWith('data:')) return route.continue();
        errors.push(`External request: ${url}`); return route.abort();
      });
      await context.addInitScript(bridge => {
        window.filensEvents = [];
        const handler = { postMessage: value => window.filensEvents.push(JSON.parse(value)) };
        if (bridge === 'webkit') Object.defineProperty(window, 'webkit', { value: { messageHandlers: { filens: handler } } });
        else window.filensNative = handler;
      }, name);
      const page = await context.newPage();
      page.on('pageerror', error => {
        // WebKit may defer one resize notification while the iWork canvas fits.
        // This browser notification is not a thrown parser/worker error.
        if (error.message !== 'ResizeObserver loop completed with undelivered notifications.') errors.push(error.message);
      });
      page.on('console', message => { if (message.type() === 'error' && /Content Security Policy|Refused to/.test(message.text())) errors.push(message.text()); });
      for (const [index, source] of cases.entries()) {
        const id = `${name}-case-${index}`;
        sources.set(id, { ...source, transport: name === 'webkit' ? 'br' : 'decoded-stream' });
        await page.goto(`${origin}/${id}/mobile.html?requestId=${id}`);
        if (source.name.endsWith('.rar')) {
          const password = page.locator('input[type=password]');
          await password.fill('password'); await password.press('Enter');
        }
        await page.waitForFunction(() => window.filensEvents.some(event => event.type === 'rendered' || event.type === 'error'), null, { timeout: 45000 });
        const events = await page.evaluate(() => window.filensEvents);
        assert.equal(events.some(event => event.type === 'error'), false, `${name} ${source.name}: ${JSON.stringify(events)}; ${errors.join('\n')}`);
        assert.ok(events.some(event => event.type === 'rendered' && event.requestId === id));
        assert.ok(compressedRequests.has(`${id}/filens.js`), 'Mobile entry must load the Brotli-stored runtime');
        const hasRegex = source.name === 'regex.xlsx';
        assert.equal(compressedRequests.has(`${id}/xlsx/pcre2.wasm`), hasRegex);
        if (hasRegex) {
          const grid = page.locator('.xlsxv-grid');
          await expect(grid.locator('tr[aria-rowindex="2"] td[aria-colindex="2"]')).toHaveText('TRUE');
          await page.locator('.xlsxv-sheet-tabs').getByRole('button', { name: 'Large Spill', exact: true }).click();
          await grid.evaluate(root => { root.scrollTop = root.scrollHeight; root.scrollLeft = root.scrollWidth; });
          const final = grid.locator('tr[aria-rowindex="1048577"] td[aria-colindex="16385"]');
          await expect(final).toHaveText('ID');
          await expect(final).toHaveCSS('background-color', 'rgb(220, 252, 231)');
        }
        if (source.text) assert.ok((await page.locator('body').innerText()).includes(source.text));
        if (source.frameText) await page.frameLocator('iframe').getByText(source.frameText).waitFor();
        assert.equal(await page.evaluate(() => window.injected), undefined);
        if (source.name.endsWith('.rar')) {
          await page.locator('tr.archivev-row').filter({ hasText: 'c.txt' }).click();
          await page.locator('.archivev-entry-preview').getByText('This is from c.txt', { exact: false }).waitFor();
        }
        assert.deepEqual(errors, [], `${name} ${source.name}`);
        checks++;
        console.log(`${name}: ${source.name} rendered through the mobile bridge`);
      }
      sources.set('failure', { name: 'broken.filens-unsupported', bytes: Buffer.from('invalid input') });
      await page.goto(`${origin}/failure/mobile.html?requestId=failure`);
      await page.waitForFunction(() => window.filensEvents.some(event => event.type === 'error'));
      const error = await page.evaluate(() => window.filensEvents.find(event => event.type === 'error'));
      assert.equal(error.requestId, 'failure');
      assert.ok(error.error.code && error.error.message);
      checks++;
      await context.close();
    } finally { await browser.close(); }
  }
  console.log(`${checks} mobile runtime and bridge checks passed`);
} finally { await new Promise(resolve => server.close(resolve)); }
