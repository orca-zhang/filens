// Exercise the actual packaged mobile page and shared engines, with both bridge shapes.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.join(root, 'sdk/ios/Sources/FilensPreview/Resources/filens');
const androidAssets = path.join(root, 'sdk/android/filens-preview/src/main/assets/filens');
const policy = (await readFile(path.join(assets, 'mobile.html'), 'utf8')).match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
for (const file of ['mobile.html', 'mobile.js', 'filens.js', 'archive/7zz.wasm', 'THIRD-PARTY-NOTICES.txt', 'LICENSE']) {
  assert.deepEqual(await readFile(path.join(assets, file)), await readFile(path.join(androidAssets, file)), `SDK assets differ: ${file}`);
}
const sources = new Map();
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
    const bytes = relative === 'document' ? source.bytes : await readFile(path.join(assets, relative));
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
  { name: 'page.html', contentType: 'text/html', bytes: Buffer.from('<h1>FILENS_MOBILE_HTML</h1>'), frameText: 'FILENS_MOBILE_HTML' },
  ...[
    'apps/demo/public/samples/filens-aurora-guide.docx',
    'apps/demo/public/samples/filens-cosmic-atlas.pdf',
    'apps/demo/public/samples/a.pages',
    'apps/demo/public/samples/pepper-carrot.epub',
    'apps/demo/public/samples/sample-video.mp4',
    'examples/go-wazero-converter/fixtures/icons/sample.apk',
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
        const id = `case-${index}`; sources.set(id, source);
        await page.goto(`${origin}/${id}/mobile.html?requestId=${id}`);
        if (source.name.endsWith('.rar')) {
          const password = page.locator('input[type=password]');
          await password.fill('password'); await password.press('Enter');
        }
        await page.waitForFunction(() => window.filensEvents.some(event => event.type === 'rendered' || event.type === 'error'), null, { timeout: 45000 });
        const events = await page.evaluate(() => window.filensEvents);
        assert.equal(events.some(event => event.type === 'error'), false, `${name} ${source.name}: ${JSON.stringify(events)}; ${errors.join('\n')}`);
        assert.ok(events.some(event => event.type === 'rendered' && event.requestId === id));
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
