// Exercise the built assets, including the optional engine boundary.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import SevenZip from '7z-wasm';
import JSZip from 'jszip';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.resolve(root, process.env.FILENS_PREVIEW_TEST_DIR || 'packages/preview/dist');
const fixtures = path.join(root, 'packages/archive/test/fixtures');
const engine = await SevenZip({ print: () => {}, printErr: () => {} });
engine.FS.writeFile('notes.txt', Buffer.from('External multipart engine payload'));
engine.callMain(['a', '/bundle.7z', 'notes.txt', '-v80b', '-pvolume password', '-mhe=on', '-bd']);
const volumes = engine.FS.readdir('/').filter(name => name.startsWith('bundle.7z.')).sort().map(name => ({
  name, mimeType: 'application/octet-stream', buffer: Buffer.from(engine.FS.readFile(`/${name}`))
}));
const zip = new JSZip();
zip.file('plain.txt', 'Ordinary ZIP uses the shared reader');
const ordinary = { name: 'plain.zip', mimeType: 'application/zip', buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }) };
const asFiles = async names => Promise.all(names.map(async name => ({ name: path.basename(name), mimeType: 'application/octet-stream', buffer: await readFile(path.join(fixtures, name)) })));
const server = createServer(async (request, response) => {
  try {
    const file = path.resolve(assets, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
    if (!file.startsWith(assets + path.sep)) { response.writeHead(403).end(); return; }
    const type = /\.m?js$/.test(file) ? 'text/javascript' : file.endsWith('.wasm') ? 'application/wasm' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream';
    const bytes = await readFile(file);
    response.writeHead(200, { 'Content-Type': type });
    response.end(bytes);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
let checks = 0;
try {
  for (const mode of ['split', 'all-in-one']) {
    const context = await browser.newContext();
    const requests = [], errors = [];
    context.on('request', request => requests.push(request.url()));
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const archiveRequests = () => requests.filter(url => /\/(archive\/7zz\.wasm|assets\/archive-worker-)/.test(url));
    await page.goto(`${origin}/${mode}/index.html`);
    const picker = page.locator('#file');
    await picker.setInputFiles({ name: 'plain.txt', mimeType: 'text/plain', buffer: Buffer.from('Ordinary document stays independent') });
    await expect(page.locator('#preview')).toContainText('Ordinary document stays independent');
    await picker.setInputFiles(ordinary);
    await page.locator('tr.archivev-row').filter({ hasText: 'plain.txt' }).click();
    await expect(page.locator('.archivev-entry-preview')).toContainText('Ordinary ZIP uses the shared reader');
    assert.deepEqual(archiveRequests(), [], `${mode}: ordinary previews downloaded the optional engine`);
    checks++;

    await picker.setInputFiles(await asFiles(['rar5-encrypted-filenames.rar']));
    const password = page.locator('input[type=password]');
    await password.fill('wrong'); await password.press('Enter');
    await expect(page.getByRole('alert')).toBeVisible();
    await password.fill('password'); await password.press('Enter');
    await page.locator('tr.archivev-row').filter({ hasText: 'c.txt' }).click();
    await expect(page.locator('.archivev-entry-preview')).toContainText('This is from c.txt');
    assert.ok(archiveRequests().some(url => url.endsWith('/archive/7zz.wasm')));
    assert.ok(archiveRequests().some(url => url.includes('/assets/archive-worker-')));
    checks++;

    await picker.setInputFiles([...volumes].reverse());
    await password.fill('volume password'); await password.press('Enter');
    await page.locator('tr.archivev-row').filter({ hasText: 'notes.txt' }).click();
    await expect(page.locator('.archivev-entry-preview')).toContainText('External multipart engine payload');
    checks++;

    const rar = (await readdir(path.join(fixtures, 'multivolume'))).filter(name => name.startsWith('test_read_')).sort().reverse();
    await picker.setInputFiles(await asFiles(rar.map(name => `multivolume/${name}`)));
    await page.locator('tr.archivev-row').filter({ hasText: 'cebula.txt' }).click();
    await expect(page.locator('.archivev-entry-preview')).toContainText('Cebula');
    checks++;

    await picker.setInputFiles(await asFiles(['multivolume/classic.zip', 'multivolume/classic.z01']));
    await page.locator('tr.archivev-row').filter({ hasText: 'binary.dat' }).click();
    const downloading = page.waitForEvent('download');
    await page.locator('a.archivev-button[download]').click();
    const download = await downloading;
    const bytes = await readFile(await download.path());
    assert.equal(bytes.length, 70000);
    assert.ok(bytes.every((value, index) => value === index % 256));
    checks++;

    await picker.setInputFiles(volumes.filter((_, index) => index !== 1));
    await expect(page.locator('#source-error')).toContainText('bundle.7z.002');
    assert.equal(archiveRequests().filter(url => url.endsWith('/archive/7zz.wasm')).length, 1,
      `${mode}: archive operations must reuse the compiled module`);
    assert.deepEqual(errors, []);
    checks++;
    console.log(`${mode}: shared ZIP reader, external RAR/7z, encrypted and solid volumes, ZIP extraction and missing-volume checks passed`);
    await context.close();
  }
  console.log(`${checks} archive asset browser checks passed`);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
