import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { expect, test, type Page } from '@playwright/test';
import { unzipSync, zipSync } from 'fflate';
import protobuf from 'protobufjs/light.js';
import { createModernNumbersArchive, createNumbersMediaArchive, frameIwa } from '../../../packages/iwork/test/fixtures/numbers-archive.mjs';
import { repackageIworkFixture } from '../../../packages/iwork/test/helpers';
import { serveZipFixture } from './zip-range-fixture';

async function padArchive(file: string): Promise<Buffer> {
  return Buffer.from(zipSync({
    'Unused/padding.bin': new Uint8Array(4 * 1024 * 1024),
    ...unzipSync(await readFile(file)),
    'Unused/tail.bin': new Uint8Array(128 * 1024),
  }, { level: 0 }));
}

const samples = { numbers: 'a.numbers', pages: 'a.pages', key: 'filens-weekend.key' } as const;
const fixture = (format: keyof typeof samples) => padArchive(`apps/demo/public/samples/${samples[format]}`);
const numbersGrid = (page: Page) => page.locator('.xlsxv-grid');
const openRemote = (page: Page, url: string, lang = 'en') => page.goto(`./?url=${encodeURIComponent(url)}&lang=${lang}`);
const selectSheet = (page: Page, name: string) =>
  page.locator('.xlsxv-sheet-tabs').getByRole('button', { name, exact: true }).click();

async function numbersMediaFixture() {
  const entries = unzipSync(await createNumbersMediaArchive(3 * 1024 * 1024));
  entries['Unused/tail.bin'] = new Uint8Array(128 * 1024);
  const bytes = Buffer.from(zipSync(entries, { level: 0 }));
  const offsets = ['numbers-first-image', 'numbers-large-image', 'numbers-blank-fill', 'numbers-unreferenced-image']
    .map(marker => bytes.indexOf(marker));
  for (const offset of offsets) expect(offset).toBeGreaterThan(0);
  const server = await serveZipFixture(bytes, 'numbers');
  const readsAt = (offset: number) => server.requests.filter(request => request.begin <= offset && request.end > offset);
  return { bytes, server, offsets, readsAt };
}

function entryStart(bytes: Buffer, name: string): number {
  const header = bytes.indexOf(name) - 30;
  expect(bytes.readUInt32LE(header)).toBe(0x04034b50);
  return header + 30 + bytes.readUInt16LE(header + 26) + bytes.readUInt16LE(header + 28);
}

for (const format of ['numbers', 'pages', 'key'] as const) {
  test(`opens ${format} entries in the worker over HTTP ranges`, async ({ page }, testInfo) => {
    const bytes = await fixture(format), server = await serveZipFixture(bytes, format);
    try {
      await openRemote(page, server.url);
      await expect(page.locator('.wb-status')).toHaveText('Preview ready');
      await expect(page.locator(format === 'numbers' ? '.xlsxv-grid' : '.iworkv-page-shell').first()).toBeVisible();
      expect(server.requests.filter(request => request.range === 'bytes=0-0')).toHaveLength(1);
      expect(server.requests.every(request => request.range)).toBe(true);
      const startupBytes = server.requests.reduce((total, request) => total + request.sent, 0);
      expect(startupBytes).toBeLessThan(bytes.length / 2);
      await testInfo.attach('iWork startup transfer', { body: JSON.stringify({ format, startupBytes, fileBytes: bytes.length }), contentType: 'application/json' });
      if (format === 'numbers') {
        const requests = server.requests.length;
        const tab = page.locator('.xlsxv-sheet-tabs').getByRole('button', { name: 'Google', exact: true });
        await tab.click();
        await expect(numbersGrid(page).getByText('useQueue', { exact: true }).first()).toBeVisible();
        expect(server.requests).toHaveLength(requests);
      }
    } finally { await server.close(); }
  });
}

test('streams the large Numbers document entry once during automatic type detection', async ({ page }) => {
  const entries = unzipSync(await createModernNumbersArchive());
  const blocks = Array.from({ length: 36 }, (_, i) => {
    const payload = randomBytes(64 * 1024);
    // Unreferenced ArchiveInfo record with an unsupported message type.
    const info = protobuf.Writer.create().uint32(8).uint32(1000 + i)
      .uint32(18).fork().uint32(8).uint32(65_535).uint32(24).uint32(payload.length).ldelim().finish();
    return Buffer.concat([protobuf.Writer.create().uint32(info.length).finish(), info, payload]);
  });
  const document = Buffer.concat([frameIwa(blocks), entries['Index/Document.iwa']]);
  entries['Index/Document.iwa'] = document;
  entries['Unused/tail.bin'] = new Uint8Array(128 * 1024);
  const bytes = Buffer.from(zipSync(entries, { level: 0 })), server = await serveZipFixture(bytes, 'numbers');
  try {
    await openRemote(page, server.url);
    await expect(page.locator('.wb-status')).toHaveText('Preview ready');
    await expect(numbersGrid(page).getByText('Modern text', { exact: true })).toBeVisible();
    const start = entryStart(bytes, 'Index/Document.iwa'), end = start + document.length, rangeSize = 1024 * 1024;
    const documentReads = server.requests.filter(request => request.begin < end && request.end > start);
    expect(documentReads.map(({ begin, end }) => [begin, end])).toEqual([
      [start, start + rangeSize],
      [start + rangeSize, start + 2 * rangeSize],
      [start + 2 * rangeSize, end]
    ]);
  } finally { await server.close(); }
});

test('cancels a wrapped Numbers index range and loads outer media by sheet on reopen', async ({ page }) => {
  const document = await createNumbersMediaArchive(3 * 1024 * 1024);
  const wrapped = await repackageIworkFixture(document, 'Workbook.numbers', true);
  const bytes = Buffer.from(zipSync({ ...unzipSync(wrapped), 'Unused/tail.bin': new Uint8Array(128 * 1024) }, { level: 0 }));
  const index = entryStart(bytes, 'Workbook.numbers/Index.zip');
  const later = bytes.indexOf('numbers-large-image');
  expect(later).toBeGreaterThan(0);
  const server = await serveZipFixture(bytes, 'numbers');
  const readAt = (position: number) => server.requests.find(request => request.begin <= position && request.end > position);
  const picture = () => page.locator('.iworkv-numbers-objects img').first().evaluate((image: HTMLImageElement) => image.naturalWidth);
  server.pause(index);
  try {
    await openRemote(page, server.url);
    await expect.poll(() => readAt(index)?.sent).toBe(0);
    await page.getByRole('button', { name: 'CSV', exact: true }).click();
    await expect(page.locator('.xlsxv-table')).toBeVisible();
    await expect.poll(() => readAt(index)?.cancelled).toBe(true);
    server.resume();

    await openRemote(page, server.url);
    await expect(page.locator('.wb-status')).toHaveText('Preview ready');
    await expect.poll(picture).toBe(32);
    expect(readAt(later)).toBeUndefined();
    await selectSheet(page, 'Pictures');
    await expect.poll(picture).toBe(96);
    expect(readAt(later)?.sent).toBeGreaterThan(0);
    expect(server.requests.every(request => request.range)).toBe(true);
  } finally { await server.close(); }
});

test('loads Numbers media by sheet and shares an in-flight image across sheet requests', async ({ page }, testInfo) => {
  const { bytes, server, offsets: [first, later, blank, unused], readsAt } = await numbersMediaFixture();
  const pictureWidth = () => page.locator('.iworkv-numbers-objects img').first().evaluate((image: HTMLImageElement) => image.naturalWidth);
  server.pause(later);
  try {
    await openRemote(page, server.url);
    await expect(page.locator('.wb-status')).toHaveText('Preview ready');
    await expect.poll(pictureWidth).toBe(32);
    expect(readsAt(first)).toHaveLength(1);
    for (const offset of [later, blank, unused]) expect(readsAt(offset)).toHaveLength(0);
    const startupBytes = server.requests.reduce((sum, request) => sum + request.sent, 0);
    expect(startupBytes).toBeLessThan(100 * 1024);
    await testInfo.attach('Numbers media transfer', { body: JSON.stringify({ startupBytes, fileBytes: bytes.length }), contentType: 'application/json' });

    await selectSheet(page, 'Pictures');
    await expect.poll(() => readsAt(later)[0]?.sent).toBe(0);
    await selectSheet(page, 'Shared picture');
    server.resume();
    await expect.poll(pictureWidth).toBe(96);
    await selectSheet(page, 'Pictures');
    await expect.poll(() => numbersGrid(page).locator('td .pptxv-fill-image').first().evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(48);
    expect(readsAt(later)).toHaveLength(1);
    expect(readsAt(blank)).toHaveLength(1);
    expect(readsAt(unused)).toHaveLength(0);

    const completed = server.requests.length;
    await selectSheet(page, 'Start');
    await expect.poll(pictureWidth).toBe(32);
    await selectSheet(page, 'Shared picture');
    await expect.poll(pictureWidth).toBe(96);
    expect(server.requests).toHaveLength(completed);
  } finally { await server.close(); }
});

test('cancels a pending Numbers media range when replacing the workbook', async ({ page }) => {
  const { server, offsets: [, later], readsAt } = await numbersMediaFixture();
  try {
    server.pause(later);
    await openRemote(page, server.url);
    await expect(page.locator('.wb-status')).toHaveText('Preview ready');
    await selectSheet(page, 'Pictures');
    await expect.poll(() => readsAt(later)[0]?.sent).toBe(0);
    await page.getByRole('button', { name: 'CSV', exact: true }).click();
    await expect(page.locator('.xlsxv-table')).toBeVisible();
    await expect.poll(() => readsAt(later)[0]?.cancelled).toBe(true);
    await expect(page.locator('.iworkv-numbers-stage')).toHaveCount(0);
  } finally { await server.close(); }
});

test('sends a large Numbers upload to the worker as a Blob', async ({ page }) => {
  const bytes = await fixture('numbers');
  await page.addInitScript(size => {
    const reads = { whole: 0, workerBlobs: 0 };
    Object.assign(window, { iworkSourceReads: reads });
    const arrayBuffer = Blob.prototype.arrayBuffer, postMessage = Worker.prototype.postMessage;
    Blob.prototype.arrayBuffer = function () {
      if (this.size === size) reads.whole++;
      return arrayBuffer.call(this);
    };
    Worker.prototype.postMessage = function (message, options) {
      if (message.kind === 'document' && message.source instanceof Blob && message.source.size === size) reads.workerBlobs++;
      Reflect.apply(postMessage, this, [message, options]);
    };
  }, bytes.length);
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({ name: 'ranged.numbers', mimeType: 'application/vnd.apple.numbers', buffer: bytes });
  await expect(numbersGrid(page)).toBeVisible();
  expect(await page.evaluate(() => (window as any).iworkSourceReads)).toEqual({ whole: 0, workerBlobs: 1 });
});

test('reuses the full response when an iWork server ignores the range probe', async ({ page }) => {
  const bytes = await fixture('numbers'), server = await serveZipFixture(bytes, 'numbers', false);
  try {
    await openRemote(page, server.url);
    await expect(numbersGrid(page)).toBeVisible();
    expect(server.requests).toMatchObject([{ range: 'bytes=0-0', sent: bytes.length, cancelled: false }]);
  } finally { await server.close(); }
});

test('cancels a pending worker range when replacing a remote iWork source', async ({ page }) => {
  const bytes = await fixture('numbers'), server = await serveZipFixture(bytes, 'numbers');
  try {
    const start = entryStart(bytes, 'Index/Document.iwa');
    server.pause(start);
    const pending = () => server.requests.find(request => request.begin <= start && request.end > start);
    await openRemote(page, server.url);
    await expect.poll(() => pending()?.sent).toBe(0);
    await page.getByRole('button', { name: 'CSV', exact: true }).click();
    await expect(page.locator('.xlsxv-table')).toBeVisible();
    await expect.poll(() => pending()?.cancelled).toBe(true);
    await expect(page.locator('.iworkv-numbers-stage')).toHaveCount(0);
  } finally { await server.close(); }
});

test('unlocks a range-loaded iWork package after a Unicode password retry', async ({ page }) => {
  const bytes = await padArchive('packages/iwork/test/fixtures/password/encrypted-non-latin.numbers');
  const server = await serveZipFixture(bytes, 'numbers');
  try {
    await openRemote(page, server.url, 'zh_CN');
    const field = page.getByLabel('文档密码', { exact: true });
    await expect(field).toBeVisible();
    await field.fill('错误密码'); await field.press('Enter');
    await expect(page.getByRole('alert')).toContainText('密码不正确，请重试。');
    await field.fill('秘密'); await field.press('Enter');
    await expect(numbersGrid(page)).toContainText('Decryption');
    expect(server.requests.filter(request => request.range === 'bytes=0-0')).toHaveLength(3);
    expect(server.requests.every(request => request.range)).toBe(true);
    expect(server.requests.reduce((total, request) => total + request.sent, 0)).toBeLessThan(bytes.length / 2);
  } finally { await server.close(); }
});

test('reports remote iWork HTTP errors from the worker', async ({ page }) => {
  const server = createServer((_request, response) => response.writeHead(404, { 'Access-Control-Allow-Origin': '*' }).end());
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const { port } = server.address() as { port: number };
    await openRemote(page, `http://127.0.0.1:${port}/missing.pages?token=hidden`);
    await expect(page.getByRole('alert')).toContainText('Failed to load missing.pages: HTTP 404');
    await expect(page.locator('.wb-status')).toHaveText('Preview failed');
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
