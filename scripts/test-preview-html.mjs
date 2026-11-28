// Exercise actual file:// HTML artifacts with the browser offline and the
// generating process already exited. No document conversion is mocked.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, firefox, webkit } from '@playwright/test';
import { unzipSync, zipSync } from 'fflate';
import SevenZip from '7z-wasm';
import { createNumbersMediaArchive } from '../packages/iwork/test/fixtures/numbers-archive.mjs';
import { createPdfFixture } from '../packages/pdf/test/fixtures/document.mjs';
import { createWorksheetBatchWorkbook } from '../packages/xlsx/test/fixtures/worksheet-batches.mjs';
import { createRepeatedConditionalWorkbook } from '../packages/xlsx/test/fixtures/repeated-conditional-workbook.mjs';
import { createSharedStringsWorkbook, sharedStringsLastValue } from '../packages/xlsx/test/fixtures/shared-strings.mjs';
import { createRegexWorkbook } from '../packages/xlsx/test/fixtures/array-selection-workbook.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.env.FILENS_AGENT_BINARY || path.join(root, 'dist/filens');
const assets = path.resolve(root, process.env.FILENS_PREVIEW_TEST_DIR || 'packages/preview/dist');
const browsers = (process.env.FILENS_HTML_TEST_BROWSERS || 'chromium').split(',');
const work = await mkdtemp(path.join(os.tmpdir(), 'filens-html-test-'));
const outputs = [];
const observations = [];
const sourceName = process.platform === 'win32' ? '中文 & name.txt' : '中文 <&" #.txt';
const source = path.join(work, sourceName);
const text = 'FILENS_OFFLINE_HTML_2026 中文\n<script>window.filensInjected = true</script>';
await writeFile(source, text);

function run(args, code = 0) {
  const result = spawnSync(binary, ['preview', ...args, '--no-open', '--json'], { cwd: root, encoding: 'utf8', timeout: 15000 });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, code, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}
function generate(file, args = [], assetDirectory = assets) {
  const result = run([file, '--assets', assetDirectory, ...args]);
  assert.equal(result.mode, 'html');
  assert.equal(result.transport, 'file');
  assert.equal(result.containsSource, true);
  assert.equal(result.stop, undefined);
  const localPath = process.platform === 'win32'
    ? result.path.replace(/^\\\\\?\\UNC\\/, '\\\\').replace(/^\\\\\?\\/, '')
    : result.path;
  assert.equal(fileURLToPath(result.url), localPath);
  outputs.push(result.path);
  return result;
}

async function enterPasswordWithRetry(page, value) {
  const field = page.locator('input[type=password]');
  await field.fill('wrong');
  await field.press('Enter');
  await page.getByRole('alert').waitFor();
  await field.fill(value);
  await field.press('Enter');
  await field.waitFor({ state: 'detached' });
}

async function verifyCompatibility(browser, file) {
  const child = spawn(binary, ['preview', file, '--assets', assets, '--mode', 'serve', '--no-open', '--json'], { cwd: root });
  const closed = new Promise(resolve => child.once('close', resolve));
  const context = await browser.newContext();
  try {
    const info = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Compatibility server startup timeout')), 10000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Compatibility server exited ${code}`)); });
      createInterface({ input: child.stdout }).once('line', line => { clearTimeout(timer); resolve(JSON.parse(line)); });
    });
    const page = await context.newPage();
    const external = [];
    await context.route('**/*', route => {
      const url = route.request().url();
      if (/^https?:/.test(url) && new URL(url).origin !== new URL(info.url).origin) {
        external.push(url); return route.abort();
      }
      return route.continue();
    });
    await page.goto(info.url);
    await page.waitForFunction(() => ['ready', 'error'].includes(document.body.dataset.state), null, { timeout: 30000 });
    assert.equal(await page.evaluate(() => document.body.dataset.state), 'ready');
    await page.locator('.archivev-row').filter({ has: page.getByText('c.txt', { exact: true }) }).click();
    await page.locator('.archivev-entry-preview').getByText('This is from c.txt', { exact: true }).waitFor();
    assert.deepEqual(external, []);
  } finally {
    await context.close();
    child.kill('SIGTERM');
    await closed;
  }
}

try {
  const runtime = await (async () => {
    for (const candidate of [path.join(assets, 'all-in-one/filens.js'), path.join(assets, 'filens-all-in-one.js'),
      path.join(assets, '../all-in-one/filens.js'), path.join(assets, 'filens.js')]) {
      const found = await access(candidate).then(() => true, () => false);
      if (found) return candidate;
    }
    throw new Error('Missing all-in-one preview build');
  })();
  const runtimeDir = path.dirname(runtime);
  const worker = (await readdir(path.join(runtimeDir, 'assets'))).filter(name => /^archive-worker-.*\.js$/.test(name));
  assert.equal(worker.length, 1);
  const savedPath = path.join(work, '中文 # %.html');
  const saved = generate(source, ['--output', savedPath]);
  assert.equal(saved.temporary, false);
  const html = await readFile(savedPath, 'utf8');
  const embedded = JSON.parse(html.split('<script id="filens-source" type="application/json">')[1].split('</script>')[0]);
  assert.equal(embedded.name, sourceName);
  assert.equal(Buffer.from(embedded.data, 'base64').toString(), text);
  assert.ok(!html.includes('<!--FILENS_'));
  assert.match(html, /THIRD.PARTY|MIT License/);
  for (const [id, asset] of [['worker', `assets/${worker[0]}`], ['wasm', 'archive/7zz.wasm']]) {
    const data = html.split(`<script id="filens-archive-${id}" type="application/octet-stream">`)[1]?.split('</script>')[0];
    assert.ok(data, `Missing embedded archive ${id}`);
    assert.deepEqual(Buffer.from(data, 'base64'), await readFile(path.join(runtimeDir, asset)));
  }
  assert.equal(run([source, '--assets', assets, '--output', savedPath], 1).error.code, 'preview_failed');
  assert.equal(await readFile(savedPath, 'utf8'), html);
  assert.equal(run([source, '--assets', assets, '--output', source], 1).error.code, 'preview_failed');
  assert.equal(await readFile(source, 'utf8'), text);
  for (const options of [
    ['--mode', 'unknown'], ['--mode', 'html', '--port', '0'],
    ['--mode', 'serve', '--output', path.join(work, 'unused.html')],
    ['--assets', path.join(work, 'missing')]
  ]) assert.equal(run([source, ...options], 1).error.code, 'preview_failed');

  const fixtures = [
    'apps/demo/public/samples/filens-cosmic-atlas.pdf',
    'packages/converter-client/test/fixtures/password/encrypted.pdf',
    'apps/demo/public/samples/filens-aurora-guide.docx',
    'apps/demo/public/samples/filens-observatory.xlsx',
    'apps/demo/public/samples/filens-field-notes.pptx',
    'apps/demo/public/samples/legacy-project-workflow.doc',
    'apps/demo/public/samples/filens-weekend.key',
    'apps/demo/public/samples/a.pages',
    'apps/demo/public/samples/a.numbers',
    'apps/demo/public/samples/raw/pentax-k-r.dng',
    'apps/demo/public/samples/sample-nested-archives.zip',
    'packages/model3d/test/fixtures/occt/cube.stp',
    'examples/converter/fixtures/icons/sample.apk',
    'packages/converter-client/test/fixtures/password/agile.docx',
    'packages/converter-client/test/fixtures/password/agile.xlsx',
    'packages/converter-client/test/fixtures/password/agile.pptx'
  ];
  const largeSources = [path.join(work, 'chunked-preview.pdf'), path.join(work, 'chunked-workbook.xlsx'), path.join(work, 'conditional-groups.xlsx')];
  await Promise.all([
    writeFile(largeSources[0], createPdfFixture(600, false, 0, undefined, 20)),
    createWorksheetBatchWorkbook(45_000).then(bytes => writeFile(largeSources[1], bytes)),
    createRepeatedConditionalWorkbook(8000, { separateGroups: true, linkedBar: true, storeWorksheet: true })
      .then(bytes => writeFile(largeSources[2], bytes))
  ]);
  const [largePdf, largeWorkbook, conditionalWorkbook] = largeSources.map(file => generate(file));
  const sharedStringsSource = path.join(work, 'shared-strings.xlsx');
  await writeFile(sharedStringsSource, await createSharedStringsWorkbook());
  const sharedStringsWorkbook = generate(sharedStringsSource);
  const regexSource = path.join(work, 'regex.xlsx');
  await writeFile(regexSource, await createRegexWorkbook());
  const regexWorkbook = generate(regexSource);
  const regexHtml = await readFile(regexWorkbook.path, 'utf8');
  const regexData = regexHtml.split('<script id="filens-xlsx-regex" type="application/octet-stream">')[1]?.split('</script>')[0];
  assert.ok(regexData, 'Missing embedded XLSX regex engine');
  assert.deepEqual(Buffer.from(regexData, 'base64'), await readFile(path.join(runtimeDir, 'xlsx/pcre2.wasm')));
  for (const document of [largePdf, largeWorkbook]) {
    assert.match(await readFile(document.path, 'utf8'), /<script type="application\/octet-stream" class="filens-source-chunk">/);
  }
  const numbersSource = path.join(work, 'ranged-media.numbers');
  const numbers = Buffer.from(zipSync({
    ...unzipSync(await createNumbersMediaArchive(3 * 1024 * 1024)), 'Unused/tail.bin': new Uint8Array(128 * 1024)
  }, { level: 0 }));
  const laterImage = numbers.indexOf('numbers-large-image'), unusedImage = numbers.indexOf('numbers-unreferenced-image');
  assert(laterImage > 0 && unusedImage > laterImage);
  await writeFile(numbersSource, numbers);
  const largeNumbers = generate(numbersSource);
  const protectedSource = path.join(work, 'ranged-protected.numbers');
  await writeFile(protectedSource, zipSync({
    ...unzipSync(await readFile(path.join(root, 'packages/iwork/test/fixtures/password/encrypted-non-latin.numbers'))),
    'Unused/tail.bin': new Uint8Array(256 * 1024)
  }, { level: 0 }));
  const protectedNumbers = generate(protectedSource);
  const rarSource = path.join(root, 'packages/archive/test/fixtures/rar5-encrypted.rar');
  const rar = generate(rarSource);
  const partialAssets = path.join(work, 'runtime-without-archive-worker');
  await mkdir(path.join(partialAssets, 'archive'), { recursive: true });
  for (const [from, to] of [[runtime, 'filens.js'], [path.join(runtimeDir, 'THIRD-PARTY-NOTICES.txt'), 'THIRD-PARTY-NOTICES.txt'],
    [path.join(runtimeDir, 'archive/7zz.wasm'), 'archive/7zz.wasm']]) await copyFile(from, path.join(partialAssets, to));
  const missingEngine = generate(rarSource, [], partialAssets);
  const partialHtml = await readFile(missingEngine.path, 'utf8');
  assert.doesNotMatch(partialHtml, /<script id="filens-archive-(worker|wasm)"/);
  const engine = await SevenZip({ print: () => {}, printErr: () => {} });
  engine.FS.writeFile('notes.txt', Buffer.from('Nested offline archive content'));
  assert.equal(engine.callMain(['a', '/inner.7z', 'notes.txt', '-v80b', '-pnested secret', '-mhe=on', '-bd']), 0);
  const volumes = engine.FS.readdir('/').filter(name => name.startsWith('inner.7z.')).sort();
  assert.ok(volumes.length > 1);
  const nestedSource = path.join(work, 'nested-encrypted.zip');
  await writeFile(nestedSource, zipSync(Object.fromEntries(volumes.map(name => [name, engine.FS.readFile(`/${name}`)]))));
  const nestedArchive = generate(nestedSource);
  const documents = [saved, largePdf, largeWorkbook, conditionalWorkbook, sharedStringsWorkbook, regexWorkbook, largeNumbers, protectedNumbers,
    ...fixtures.map(file => generate(path.join(root, file))), rar, nestedArchive, missingEngine];
  // Artifacts remain usable after the source file disappears.
  await Promise.all([source, ...largeSources, sharedStringsSource, regexSource, numbersSource, protectedSource, nestedSource].map(file => rm(file)));

  for (const browserName of browsers) {
    const browserType = { chromium, firefox, webkit }[browserName];
    assert.ok(browserType, `Unknown browser: ${browserName}`);
    await access(browserType.executablePath());
    const browser = await browserType.launch({ headless: true });
    try {
      // WebKit's automation offline switch also disables file: navigation, even
      // for an empty local HTML. Block network routes there instead.
      const context = await browser.newContext({ offline: browserName !== 'webkit' });
      if (browserName === 'webkit') await context.route(/^https?:\/\//, route => route.abort());
      for (const document of documents) {
        const page = await context.newPage();
        if (document === largePdf) await page.setViewportSize({ width: 1000, height: 650 });
        const network = [], errors = [];
        const isPdf = document.source.name.endsWith('.pdf');
        const isEncryptedPdf = document.source.name === 'encrypted.pdf';
        page.on('request', request => { if (/^(https?|wss?):/.test(request.url())) network.push(request.url()); });
        page.on('pageerror', error => errors.push(error.message));
        try {
          if (isPdf) await page.addInitScript(() => {
            const results = window.pdfWorkerResults = { started: 0, documents: 0, stopped: 0 };
            window.Worker = new Proxy(Worker, {
              construct(target, [url, options]) {
                const worker = new target(url, options);
                if (options?.name !== 'FiLens PDF') return worker;
                results.started++;
                worker.addEventListener('message', ({ data }) => {
                  if (data?.action === 'GetDoc') results.documents++;
                });
                const terminate = worker.terminate.bind(worker);
                worker.terminate = () => { results.stopped++; terminate(); };
                return worker;
              }
            });
          });
          if (document === largeNumbers) await page.addInitScript(name => {
            const spans = new WeakMap(), reads = window.numbersFileReads = [];
            const slice = Blob.prototype.slice, read = FileReader.prototype.readAsArrayBuffer;
            Blob.prototype.slice = function (start, end, type) {
              const part = slice.call(this, start, end, type);
              if (this instanceof File && this.name === name) spans.set(part, [start, end]);
              return part;
            };
            FileReader.prototype.readAsArrayBuffer = function (blob) {
              if (spans.has(blob)) reads.push(spans.get(blob));
              return read.call(this, blob);
            };
          }, document.source.name);
          if ((document === largePdf || document === largeWorkbook) && browserName === 'firefox') {
            await page.addInitScript(() => Object.defineProperty(Uint8Array, 'fromBase64', { value: undefined }));
          }
          if (document === nestedArchive && browserName === 'webkit') await page.addInitScript(() => {
            const post = Worker.prototype.postMessage;
            Worker.prototype.postMessage = function (message, transfer) {
              if (message.wasmModule instanceof WebAssembly.Module && message.format === '7z') {
                window.refusedArchiveModuleClone = true;
                throw new DOMException('Archive module clone unavailable', 'DataCloneError');
              }
              return post.call(this, message, transfer);
            };
          });
          await page.goto(document.url);
          if (isEncryptedPdf) await enterPasswordWithRetry(page, 'test123');
          if (document === protectedNumbers) {
            const field = page.locator('input[type=password]');
            await field.waitFor();
            await field.fill('错误密码');
            await field.press('Enter');
            await page.getByRole('alert').waitFor();
            await field.fill('秘密');
            await field.press('Enter');
            await field.waitFor({ state: 'detached' });
            await page.getByText('Decryption', { exact: true }).first().waitFor();
          }
          if (document.source.name.startsWith('agile.')) {
            const password = page.locator('input[type=password]');
            await password.waitFor();
            await password.fill('wrong');
            await password.press('Enter');
            await page.getByRole('alert').waitFor();
            await password.fill(' filens 密码🔐 ');
            await password.press('Enter');
            await password.waitFor({ state: 'detached' });
            await page.waitForFunction(() => /Fixture (DOCX document|XLSX workbook|PPTX presentation slide)/.test(document.body.innerText));
          }
          await page.waitForFunction(() => ['ready', 'error'].includes(document.body.dataset.state), null, { timeout: 30000 });
          const state = await page.evaluate(() => ({ state: document.body.dataset.state, error: document.body.dataset.error, text: document.body.innerText, injected: window.filensInjected }));
          if (document === missingEngine) {
            assert.equal(state.state, 'error');
            assert.match(state.error, /separate archive engine files/);
            assert.deepEqual(network, []);
            assert.deepEqual(errors, []);
            await verifyCompatibility(browser, rarSource);
            observations.push({ browser: browserName, file: document.source.name, state: 'external-archive-engine-required', compatibilityMode: 'serve', compatibilityState: 'ready' });
            console.log(`${browserName}: HTML without the archive engine offers the tested HTTP fallback`);
            continue;
          }
          assert.equal(state.state, 'ready', `${browserName}: ${document.source.name}: ${state.error}`);
          assert.equal(state.injected, undefined);
          assert.deepEqual(network, [], `${document.source.name}: network requests`);
          assert.deepEqual(errors, [], `${document.source.name}: browser errors`);
          if (document === saved) {
            assert.match(state.text, /FILENS_OFFLINE_HTML_2026 中文/);
            assert.equal(await page.locator('#name').textContent(), sourceName);
            assert.equal(await page.getByRole('link', { name: 'GitHub' }).getAttribute('href'), 'https://github.com/orca-zhang/filens');
            assert.equal(await page.locator('#help').isVisible(), false);
            assert.equal(await page.locator('#filens-archive-worker, #filens-archive-wasm').count(), 2);
          }
          let archiveEngine;
          if (document === rar || document === nestedArchive) {
            const row = name => page.locator('.archivev-row').filter({ has: page.getByText(name, { exact: true }) });
            const entry = page.locator('.archivev-entry-preview');
            if (document === rar) {
              await row('c.txt').click();
              await entry.getByText('This is from c.txt', { exact: true }).waitFor();
              await page.getByRole('button', { name: 'Back to archive' }).click();
              await row('b.txt').click();
              await enterPasswordWithRetry(page, 'password');
              await entry.getByText('This is from b.txt', { exact: true }).waitFor();
              archiveEngine = { listed: true, openedEntry: 'b.txt', passwordRetry: true };
            } else {
              assert.equal(await page.locator('#filens-archive-worker, #filens-archive-wasm').count(), 2);
              await row(volumes[0]).click();
              await enterPasswordWithRetry(page, 'nested secret');
              await row('notes.txt').click();
              await entry.getByText('Nested offline archive content', { exact: true }).waitFor();
              const wasmUrlFallback = browserName === 'webkit';
              if (wasmUrlFallback) assert.equal(await page.evaluate(() => window.refusedArchiveModuleClone), true);
              archiveEngine = { nested: volumes[0], volumes: volumes.length, openedEntry: 'notes.txt', passwordRetry: true, wasmUrlFallback };
            }
            assert.equal(await page.locator('#filens-archive-worker, #filens-archive-wasm').count(), 0);
            assert.deepEqual(network, []);
            assert.deepEqual(errors, []);
          }
          if (document === largePdf) {
            assert.equal(await page.locator('.filens-source-chunk').count(), 0);
            const search = page.locator('.pdfv-search-controls');
            await search.locator('summary').click();
            const query = search.getByRole('searchbox');
            await query.fill('Document page');
            await query.press('Enter');
            await expect(search.locator('output')).toHaveText('1 / 600');
            await query.press('Shift+Enter');
            const lastPage = page.locator('.pdfv-page-slot[data-page-index="599"]');
            const active = lastPage.locator('mark.is-active');
            const canvas = lastPage.locator('canvas[data-rendered="true"]');
            await expect(active).toHaveText('Document page');
            const width = await canvas.evaluate(element => element.getBoundingClientRect().width);
            await page.setViewportSize({ width: 850, height: 520 });
            await expect.poll(async () => (await canvas.boundingBox())?.width ?? width).toBeLessThan(width);
            await expect(active).toHaveText('Document page');
            await query.fill('');
            await query.press('Enter');
            await page.locator('.pdfv-preview').evaluate(viewport => { viewport.scrollTop = 0; });
            await expect(page.locator('canvas[data-page-index="0"][data-rendered="true"]')).toBeInViewport();
            await page.locator('.pdfv-preview').evaluate(viewport => { viewport.scrollTop = viewport.scrollHeight; });
            await page.locator('canvas[data-page-index="599"][data-rendered="true"]').waitFor();
            await page.getByText('Document page 600', { exact: true }).waitFor({ state: 'attached' });
            await expect(page.locator('body')).toHaveAttribute('data-state', 'ready');
            assert.deepEqual(network, []);
            assert.deepEqual(errors, []);
          }
          if (document === largeWorkbook) {
            assert.equal(await page.locator('.filens-source-chunk').count(), 0);
            await page.locator('.xlsxv-grid').evaluate(viewport => {
              viewport.scrollTop = viewport.scrollHeight;
              viewport.scrollLeft = viewport.scrollWidth;
            });
            const final = page.locator('tr[aria-rowindex="1048577"] td[aria-colindex="16385"]');
            await final.getByText('45030.00', { exact: true }).waitFor();
            assert.deepEqual(network, []);
            assert.deepEqual(errors, []);
          }
          if (document === conditionalWorkbook) {
            const grid = page.locator('.xlsxv-grid');
            await grid.evaluate(element => { element.scrollTop = element.scrollHeight; element.scrollLeft = element.scrollWidth; });
            const last = grid.locator('tr[aria-rowindex="1048577"] td[aria-colindex="16385"]');
            await expect(last).toHaveText('9.0');
            await expect(last).toHaveCSS('background-color', 'rgb(255, 205, 210)');
            await expect(last.locator('.xlsxv-data-bar-fill')).toHaveCSS('background-color', 'rgb(0, 255, 0)');
            assert.deepEqual(network, []);
            assert.deepEqual(errors, []);
          }
          if (document === sharedStringsWorkbook) {
            const grid = page.locator('.xlsxv-grid');
            await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight * 5990 / 1048576; });
            await grid.locator('tr[aria-rowindex="6002"] td[aria-colindex="2"]').getByText(/^Catalog entry 6000:/).waitFor();
            await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
            const last = grid.locator('tr[aria-rowindex="1048577"] td[aria-colindex="16385"]');
            await last.locator('span > span').filter({ hasText: '星表' }).waitFor();
            assert.equal(await last.textContent(), sharedStringsLastValue);
            await page.getByRole('button', { name: 'Summary', exact: true }).click();
            await grid.locator('tr[aria-rowindex="2"] td[aria-colindex="3"]').getByText(String(sharedStringsLastValue.length), { exact: true }).waitFor();
            assert.deepEqual(network, []);
            assert.deepEqual(errors, []);
          }
          if (document === regexWorkbook) {
            const grid = page.locator('.xlsxv-grid');
            const cell = (row, column) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
            await expect(cell(1, 1)).toHaveText('TRUE');
            await expect(cell(1, 2)).toHaveText('a1 b! c3');
            await expect(cell(2, 1)).toHaveText('17');
            await expect(cell(2, 2)).toHaveText('42');
            await page.getByRole('button', { name: 'Large Spill', exact: true }).click();
            await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
            const final = cell(1_048_576, 16_384);
            await expect(final).toHaveText('ID');
            await expect(final).toHaveCSS('background-color', 'rgb(220, 252, 231)');
            assert.equal(await page.locator('#filens-xlsx-regex').count(), 0);
            assert.deepEqual(network, []);
            assert.deepEqual(errors, []);
          }
          if (document.source.name === 'filens-weekend.key') {
            const selector = '.iworkv-page-shell[data-page-index="0"]';
            const width = await page.locator(selector).evaluate(slide => slide.getBoundingClientRect().width);
            await page.setViewportSize({ width: 900, height: 760 });
            await page.waitForFunction(({ selector, width }) =>
              document.querySelector(selector)?.getBoundingClientRect().width < width, { selector, width });
            assert.equal(await page.locator('body').getAttribute('data-state'), 'ready');
            assert.deepEqual(errors, []);
          }
          let rangeReads;
          if (document === largeNumbers) {
            const picture = '.iworkv-numbers-objects img';
            const loaded = width => page.waitForFunction(({ picture, width }) =>
              document.querySelector(picture)?.naturalWidth === width, { picture, width });
            const reads = () => page.evaluate(() => window.numbersFileReads);
            const contains = (spans, offset) => spans.some(([start, end]) => start <= offset && offset < end);
            await loaded(32);
            const startup = await reads();
            const startupBytes = startup.reduce((sum, [start, end]) => sum + end - start, 0);
            assert(startupBytes > 0 && startupBytes < 100 * 1024);
            assert(!contains(startup, laterImage) && !contains(startup, unusedImage));
            await page.getByRole('button', { name: 'Pictures', exact: true }).click();
            await loaded(96);
            const selected = await reads();
            assert(contains(selected, laterImage) && !contains(selected, unusedImage));
            assert.deepEqual(network, []);
            assert.deepEqual(errors, []);
            rangeReads = { sourceBytes: numbers.length, startupBytes, laterMediaDeferred: true };
          }
          let pdfWorker;
          if (isPdf) {
            const stopped = isEncryptedPdf ? 2 : 0;
            await page.waitForFunction(stopped => window.pdfWorkerResults.stopped === stopped, stopped);
            pdfWorker = await page.evaluate(() => window.pdfWorkerResults);
            assert.deepEqual(pdfWorker, { started: stopped + 1, documents: 1, stopped });
          }
          observations.push({ browser: browserName, version: browser.version(), file: document.source.name, state: state.state, externalRequests: network.length, rangeReads, archiveEngine, pdfWorker,
            networkIsolation: browserName === 'webkit' ? 'HTTP(S) routes blocked; automation offline switch also blocks local files' : 'Browser offline mode' });
          console.log(`${browserName}: ${document.source.name} rendered offline from file://`);
        } finally { await page.close(); }
      }
      const fallback = await context.newPage();
      const fallbackErrors = [];
      fallback.on('pageerror', error => fallbackErrors.push(error.message));
      await fallback.setViewportSize({ width: 1000, height: 650 });
      await fallback.addInitScript(() => {
        window.Worker = new Proxy(Worker, {
          construct(target, [url, options]) {
            if (options?.name === 'FiLens PDF') {
              window.pdfWorkerBlocked = true;
              throw new DOMException('Local PDF worker blocked', 'SecurityError');
            }
            return new target(url, options);
          }
        });
      });
      await fallback.goto(largePdf.url);
      await fallback.waitForFunction(() => document.body.dataset.state === 'ready');
      await fallback.locator('canvas[data-page-index="0"][data-rendered="true"]').waitFor();
      assert.equal(await fallback.evaluate(() => window.pdfWorkerBlocked), true);
      await fallback.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await expect(fallback.locator('body')).toHaveAttribute('data-state', 'ready');
      assert.deepEqual(fallbackErrors, []);
      await fallback.close();
      // Missing capabilities produce visible fallback instructions, not a blank page.
      for (const feature of ['Worker', 'WebAssembly']) {
        const page = await context.newPage();
        await page.addInitScript(feature => Object.defineProperty(window, feature, { value: undefined, configurable: true }), feature);
        await page.goto(saved.url);
        await page.waitForFunction(() => document.body.dataset.state === 'error');
        assert.match(await page.locator('#status').textContent(), /WebAssembly.*Web Workers/);
        assert.match(await page.locator('#help').textContent(), /--mode serve/);
        await page.close();
      }
      await context.close();
      // Test the CSP separately with the browser online. A route would catch
      // egress if the policy failed, without sending any bytes to a remote host.
      const online = await browser.newContext();
      const attempted = [];
      await online.route('https://filens-egress.invalid/**', route => { attempted.push(route.request().url()); return route.abort(); });
      const page = await online.newPage();
      await page.goto(saved.url);
      await page.waitForFunction(() => document.body.dataset.state === 'ready');
      const blocked = await page.evaluate(async () => {
        const violation = new Promise(resolve => window.addEventListener('securitypolicyviolation', event => resolve(event.effectiveDirective), { once: true }));
        await fetch('https://filens-egress.invalid/upload', { method: 'POST', body: 'fixed-test-string' }).catch(() => {});
        return violation;
      });
      assert.equal(blocked, 'connect-src');
      assert.deepEqual(attempted, []);
      await online.close();
    } finally { await browser.close(); }
  }
  const reportPath = process.env.FILENS_HTML_TEST_REPORT || 'docs/preview-html-validation.json';
  await writeFile(path.resolve(root, reportPath), JSON.stringify({
    observedAt: new Date().toISOString(), platform: `${process.platform}-${process.arch}`,
    scope: 'Real embedded HTML opened via file:// after CLI exit. Chromium/Firefox use offline mode; WebKit uses blocked HTTP(S) routes because its automation offline switch also blocks local files. Readiness is checked; no pixel-fidelity claim or OS default-browser-launch validation.',
    checks: ['Default HTML mode starts no local HTTP server', 'Source removed before preview', 'Chunked PDF and XLSX reach the final page and formula, including the Firefox fallback without native Base64 decoding', 'An XLSX shared string table renders plain and rich text and recalculates its cross-sheet formula', 'PDF.js opens documents in an offline module worker and terminates workers from rejected password attempts', 'PDF uses its main-thread fallback when direct worker creation is blocked', 'Unicode/URL-delimiter paths and HTML-sensitive names', 'No overwrite of existing files', 'GitHub link', 'Embedded licenses', 'Wrong and correct Office and Numbers passwords', 'Visible errors for missing WASM/Worker support', 'Online CSP blocks outbound fetch before routing', 'Keynote, Pages and Numbers run offline in the tested WebKit browser', 'Numbers reads source ranges and defers offscreen sheet media', 'Embedded archive assets match the build and stay idle for plain text and ordinary ZIP listing', 'Offline RAR entry passwords and nested multipart 7z header passwords support retry', 'WebKit loads embedded WASM by URL when module cloning fails', 'An incomplete engine pair preserves the localhost compatibility fallback'],
    observations
  }, null, 2) + '\n');
  console.log(`${observations.length} HTML preview checks passed; saved ${reportPath}`);
} finally {
  for (const file of outputs) await rm(file, { force: true });
  await rm(work, { recursive: true, force: true });
}
