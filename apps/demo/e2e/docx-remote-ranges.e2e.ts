import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { unzipSync, zipSync } from 'fflate';
import { embeddedFontDocument } from '../../../packages/docx/test/fixtures/embedded-font-document';
import { createDistinctDocxImagesFixture } from '../../../packages/docx/test/fixtures/document.mjs';
import { serveZipFixture } from './zip-range-fixture';

const note = 'DOCX attachment opened on demand';
const heading = 'Chasing the light';
const firstPage = (page: Page) => page.locator('section.docx').first();
const openRemote = (page: Page, url: string, lang = 'en') => page.goto(`./?url=${encodeURIComponent(url)}&lang=${lang}`);

async function rangedDocument(): Promise<Buffer> {
  const original = await readFile('apps/demo/public/samples/filens-aurora-guide.docx');
  return Buffer.from(zipSync({
    'word/embeddings/range-note.txt': Buffer.from(note),
    'word/media/unused.bin': new Uint8Array(4 * 1024 * 1024),
    ...unzipSync(original),
    'word/media/tail.bin': new Uint8Array(128 * 1024),
  }, { level: 0 }));
}

test('shares a remote DOCX index between rendering and lazy attachments', async ({ page }, testInfo) => {
  const bytes = await rangedDocument(), server = await serveZipFixture(bytes, 'docx');
  try {
    const marker = bytes.indexOf(note);
    expect(marker).toBeGreaterThan(0);
    const openedNote = () => server.requests.some(request => request.begin <= marker && request.end > marker);
    await openRemote(page, server.url);
    await expect(firstPage(page)).toContainText(heading);
    await expect.poll(() => firstPage(page).locator('img').first().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    const attachments = page.locator('.filens-attachments');
    await expect(attachments).toBeVisible();
    expect(server.requests.filter(request => request.range === 'bytes=0-0')).toHaveLength(1);
    expect(server.requests.filter(request => request.begin > 0 && request.end === bytes.length)).toHaveLength(1);
    expect(openedNote()).toBe(false);
    const startupBytes = server.requests.reduce((total, request) => total + request.sent, 0);
    expect(startupBytes).toBeLessThan(bytes.length / 5);
    await testInfo.attach('DOCX startup transfer', { body: JSON.stringify({ startupBytes, fileBytes: bytes.length }), contentType: 'application/json' });

    await attachments.locator('summary').click();
    await attachments.getByRole('button', { name: 'range-note.txt', exact: true }).click();
    await expect(page.locator('.filens-attachment-preview')).toContainText(note);
    expect(openedNote()).toBe(true);
    expect(server.requests.every(request => request.range)).toBe(true);
    await page.getByRole('button', { name: 'Back to document', exact: true }).click();
    await expect(firstPage(page)).toContainText(heading);
  } finally { await server.close(); }
});

test('opens local DOCX documents using Blob slices', async ({ page }) => {
  const bytes = await rangedDocument();
  await page.addInitScript(size => {
    const reads = { whole: 0, slicedBytes: 0 };
    Object.assign(window, { docxSourceReads: reads });
    const { arrayBuffer, slice } = Blob.prototype;
    Blob.prototype.arrayBuffer = function () {
      if (this.size === size) reads.whole++;
      return arrayBuffer.call(this);
    };
    Blob.prototype.slice = function (...args: Parameters<Blob['slice']>) {
      const part = slice.apply(this, args);
      if (this.size === size) reads.slicedBytes += part.size;
      return part;
    };
  }, bytes.length);
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({
    name: 'sliced.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: bytes
  });
  await expect(firstPage(page)).toContainText(heading);
  await expect(page.locator('.filens-attachments')).toBeVisible();
  const reads = await page.evaluate(() => (window as Window & { docxSourceReads: { whole: number; slicedBytes: number } }).docxSourceReads);
  expect(reads.whole).toBe(0);
  expect(reads.slicedBytes).toBeGreaterThan(0);
  expect(reads.slicedBytes).toBeLessThan(bytes.length / 5);
});

test('cancels a pending DOCX part range on source replacement', async ({ page }) => {
  const bytes = await rangedDocument(), server = await serveZipFixture(bytes, 'docx');
  try {
    const marker = bytes.indexOf(heading);
    expect(marker).toBeGreaterThan(0);
    server.pause(marker);
    const pending = () => server.requests.find(request => request.begin <= marker && request.end > marker);
    await openRemote(page, server.url);
    await expect.poll(() => pending()?.sent).toBe(0);
    await page.getByRole('button', { name: 'CSV', exact: true }).click();
    await expect(page.locator('.xlsxv-grid')).toBeVisible();
    await expect.poll(() => pending()?.cancelled).toBe(true);
    await expect(firstPage(page)).toHaveCount(0);
  } finally { await server.close(); }
});

for (const replace of [false, true]) test(`bounds DOCX image range reads${replace ? ' during source replacement' : ' through completion'}`, async ({ page }) => {
  const count = 8, bytes = Buffer.from(createDistinctDocxImagesFixture(count));
  const offsets = Array.from({ length: count }, (_, i) => {
    const header = bytes.indexOf(`word/media/image-${i}.png`) - 30;
    expect(bytes.readUInt32LE(header)).toBe(0x04034b50);
    return header + 30 + bytes.readUInt16LE(header + 26) + bytes.readUInt16LE(header + 28);
  });
  const server = await serveZipFixture(bytes, 'docx');
  const reads = () => server.requests.filter(request => offsets.includes(request.begin));
  server.pause(...offsets);
  try {
    await openRemote(page, server.url);
    await expect.poll(() => reads().length).toBe(4);
    await expect(firstPage(page)).toContainText('Image 1');
    expect(reads().map(request => request.begin).sort((a, b) => a - b)).toEqual(offsets.slice(0, 4));
    expect(reads().every(request => request.sent === 0)).toBe(true);
    if (replace) {
      await page.getByRole('button', { name: 'CSV', exact: true }).click();
      await expect(page.locator('.xlsxv-grid')).toBeVisible();
      await expect.poll(() => reads().filter(request => request.cancelled).length).toBe(4);
      expect(reads()).toHaveLength(4);
      await expect(firstPage(page)).toHaveCount(0);
    } else {
      server.resume();
      await expect.poll(() => reads().length).toBe(count);
      const images = page.locator('section.docx img');
      await expect(images).toHaveCount(count + 1);
      await expect.poll(() => images.evaluateAll(items => items.map(image => (image as HTMLImageElement).naturalWidth)))
        .toEqual(Array(count + 1).fill(256));
      expect(await images.first().getAttribute('src')).toBe(await images.last().getAttribute('src'));
      expect(reads().map(request => request.begin).sort((a, b) => a - b)).toEqual(offsets);
    }
  } finally { await server.close(); }
});

test('reuses a full DOCX response when the server ignores ranges', async ({ page }) => {
  const bytes = await rangedDocument(), server = await serveZipFixture(bytes, 'docx', false);
  try {
    await openRemote(page, server.url);
    await expect(firstPage(page)).toContainText(heading);
    await expect(page.locator('.filens-attachments')).toBeVisible();
    expect(server.requests).toMatchObject([{ range: 'bytes=0-0', sent: bytes.length, cancelled: false }]);
  } finally { await server.close(); }
});

test('loads embedded fonts from the remote DOCX index', async ({ page }) => {
  const family = 'FiLens Range Test Face';
  const font = await readFile('node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf');
  const entries = unzipSync(await embeddedFontDocument([{ family, bytes: font }]));
  const bytes = Buffer.from(zipSync({
    'word/media/unused.bin': new Uint8Array(2 * 1024 * 1024),
    ...entries,
    'word/media/tail.bin': new Uint8Array(128 * 1024),
  }, { level: 0 }));
  const server = await serveZipFixture(bytes, 'docx');
  try {
    await page.goto('./');
    const moduleUrl = (path: string) => new URL(`@fs${resolve(path)}`, page.url()).href;
    await page.evaluate(async ({ core, docx, url }) => {
      const { createPreviewer } = await import(/* @vite-ignore */ core);
      const { createDocxPreviewDriver } = await import(/* @vite-ignore */ docx);
      const host = document.createElement('div'); document.body.replaceChildren(host);
      const viewer = createPreviewer(host, { drivers: [createDocxPreviewDriver()] });
      (window as any).rangeDocx = viewer;
      await viewer.preview(url);
    }, { core: moduleUrl('packages/core/src/index.ts'), docx: moduleUrl('packages/docx/src/index.ts'), url: server.url });
    await expect(firstPage(page)).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as any).rangeDocx.getState().fonts))
      .toContainEqual(expect.objectContaining({ fontFamily: family, source: 'embedded', status: 'available' }));
    expect(server.requests.every(request => request.range)).toBe(true);
    expect(server.requests.reduce((sum, request) => sum + request.sent, 0)).toBeLessThan(bytes.length / 3);
  } finally { await server.close(); }
});

test('opens a remote encrypted DOCX through the Office converter after format probing', async ({ page }) => {
  const bytes = await readFile('packages/converter-client/test/fixtures/password/agile.docx');
  const server = await serveZipFixture(bytes, 'docx');
  try {
    await openRemote(page, server.url, 'zh_CN');
    const field = page.getByLabel('文档密码', { exact: true });
    await expect(field).toBeVisible();
    await field.fill('wrong'); await field.press('Enter');
    await expect(page.getByRole('alert')).toContainText('密码不正确，请重试。');
    await field.fill(' filens 密码🔐 '); await field.press('Enter');
    await expect(firstPage(page)).toContainText('Fixture DOCX document');
    expect(server.requests).toMatchObject([{ range: 'bytes=0-0', sent: 1 }, { range: undefined, sent: bytes.length }]);
  } finally { await server.close(); }
});
