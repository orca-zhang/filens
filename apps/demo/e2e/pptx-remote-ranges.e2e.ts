import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { unzipSync, zipSync } from 'fflate';
import { serveZipFixture } from './zip-range-fixture';

const pptxType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const note = 'PPTX attachment opened on demand';
const slideText = 'Theme colors, placeholder inheritance and text runs.';
const firstSlide = (page: Page) => page.locator('.pptxv-slide').first();

async function rangedDeck(): Promise<Buffer> {
  const original = await readFile('packages/core/fixtures-text-theme.pptx');
  return Buffer.from(zipSync({
    'ppt/embeddings/range-note.txt': Buffer.from(note),
    'ppt/media/unused.bin': new Uint8Array(4 * 1024 * 1024),
    ...unzipSync(original),
    'ppt/media/padding.bin': new Uint8Array(128 * 1024),
  }, { level: 0 }));
}

test('shares the remote PPTX index between slides and lazy attachments', async ({ page }, testInfo) => {
  const bytes = await rangedDeck(), server = await serveZipFixture(bytes, 'pptx');
  try {
    const marker = bytes.indexOf(note);
    expect(marker).toBeGreaterThan(0);
    const openedNote = () => server.requests.some(request => request.begin <= marker && request.end > marker);
    await page.goto(`./?url=${encodeURIComponent(server.url)}&lang=en`);
    await expect(firstSlide(page)).toContainText(slideText);
    const attachments = page.locator('.filens-attachments');
    await expect(attachments).toBeVisible();
    expect(server.requests.filter(request => request.range === 'bytes=0-0')).toHaveLength(1);
    expect(server.requests.filter(request => request.begin > 0 && request.end === bytes.length)).toHaveLength(1);
    expect(openedNote()).toBe(false);
    const startupBytes = server.requests.reduce((total, request) => total + request.sent, 0);
    expect(startupBytes).toBeLessThan(bytes.length / 8);
    await testInfo.attach('PPTX startup transfer', { body: JSON.stringify({ startupBytes, fileBytes: bytes.length }), contentType: 'application/json' });

    await attachments.locator('summary').click();
    await attachments.getByRole('button', { name: 'range-note.txt', exact: true }).click();
    await expect(page.locator('.filens-attachment-preview')).toContainText(note);
    expect(openedNote()).toBe(true);
    expect(server.requests.every(request => request.range)).toBe(true);
    await page.getByRole('button', { name: 'Back to document', exact: true }).click();
    await expect(firstSlide(page)).toContainText(slideText);
  } finally { await server.close(); }
});

test('opens a local PPTX through Blob slices', async ({ page }) => {
  const bytes = await rangedDeck();
  await page.addInitScript(size => {
    const reads = { whole: 0, slicedBytes: 0 };
    Object.assign(window, { pptxSourceReads: reads });
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
  await page.locator('.wb-upload input[type=file]').setInputFiles({ name: 'sliced.pptx', mimeType: pptxType, buffer: bytes });
  await expect(firstSlide(page)).toContainText(slideText);
  await expect(page.locator('.filens-attachments')).toBeVisible();
  const reads = await page.evaluate(() => (window as Window & { pptxSourceReads?: { whole: number; slicedBytes: number } }).pptxSourceReads!);
  expect(reads.whole).toBe(0);
  expect(reads.slicedBytes).toBeGreaterThan(0);
  expect(reads.slicedBytes).toBeLessThan(bytes.length / 8);
});

test('cancels a pending PPTX slide range on source replacement', async ({ page }) => {
  const bytes = await rangedDeck(), server = await serveZipFixture(bytes, 'pptx');
  try {
    const marker = bytes.indexOf(slideText);
    expect(marker).toBeGreaterThan(0);
    server.pause(marker);
    const pending = () => server.requests.find(request => request.begin <= marker && request.end > marker);
    await page.goto(`./?url=${encodeURIComponent(server.url)}&lang=en`);
    await expect.poll(() => pending()?.sent).toBe(0);
    await page.getByRole('button', { name: 'CSV', exact: true }).click();
    await expect(page.locator('.xlsxv-grid')).toBeVisible();
    await expect.poll(() => pending()?.cancelled).toBe(true);
    await expect(page.locator('.pptxv-slide')).toHaveCount(0);
  } finally { await server.close(); }
});

test('uses a single full PPTX response when HTTP ranges are unavailable', async ({ page }) => {
  const bytes = await rangedDeck(), server = await serveZipFixture(bytes, 'pptx', false);
  try {
    await page.goto(`./?url=${encodeURIComponent(server.url)}&lang=en`);
    await expect(firstSlide(page)).toContainText(slideText);
    await expect(page.locator('.filens-attachments')).toBeVisible();
    expect(server.requests).toMatchObject([{ range: 'bytes=0-0', sent: bytes.length, cancelled: false }]);
  } finally { await server.close(); }
});

test('opens an encrypted remote PPTX through the Office converter after the range probe', async ({ page }) => {
  const bytes = await readFile('packages/converter-client/test/fixtures/password/agile.pptx');
  const server = await serveZipFixture(bytes, 'pptx');
  try {
    await page.goto(`./?url=${encodeURIComponent(server.url)}&lang=zh_CN`);
    const field = page.getByLabel('文档密码', { exact: true });
    await expect(field).toBeVisible();
    await field.fill('wrong'); await field.press('Enter');
    await expect(page.getByRole('alert')).toContainText('密码不正确，请重试。');
    await field.fill(' filens 密码🔐 '); await field.press('Enter');
    await expect(firstSlide(page)).toContainText('Fixture PPTX presentation slide');
    expect(server.requests).toMatchObject([{ range: 'bytes=0-0', sent: 1 }, { range: undefined, sent: bytes.length }]);
  } finally { await server.close(); }
});
