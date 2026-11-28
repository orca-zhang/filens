import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { createPdfFixture } from '../../../packages/pdf/test/fixtures/document.mjs';
import { createPdfAnnotationRangeFixture, createPdfAttachmentRangeFixture, createPdfPageTreeRangeFixture, createPdfSearchRangeFixture } from '../../../packages/pdf/test/fixtures/range-source.mjs';

interface SliceRead { begin: number; end: number; held: boolean; aborted: boolean }
interface ReadProbe { whole: number; pauseAt: number; reads: SliceRead[] }

async function trackPdfReads(page: Page, name: string) {
  await page.addInitScript(name => {
    const probe: ReadProbe = { whole: 0, pauseAt: -1, reads: [] };
    Object.assign(window, { pdfReadProbe: probe });
    const spans = new WeakMap<Blob, { begin: number; end: number }>();
    const held = new WeakMap<FileReader, SliceRead>();
    const { arrayBuffer, slice } = Blob.prototype;
    const { readAsArrayBuffer, abort } = FileReader.prototype;
    Blob.prototype.arrayBuffer = function () {
      if (this instanceof File && this.name === name) probe.whole++;
      return arrayBuffer.call(this);
    };
    Blob.prototype.slice = function (begin = 0, end = this.size, type?: string) {
      const blob = slice.call(this, begin, end, type);
      if (this instanceof File && this.name === name) spans.set(blob, { begin, end });
      return blob;
    };
    FileReader.prototype.readAsArrayBuffer = function (blob) {
      const span = spans.get(blob);
      if (span) {
        const read = { ...span, held: span.begin <= probe.pauseAt && probe.pauseAt < span.end, aborted: false };
        probe.reads.push(read);
        if (read.held) { held.set(this, read); return; }
      }
      return readAsArrayBuffer.call(this, blob);
    };
    FileReader.prototype.abort = function () {
      const read = held.get(this);
      if (read) read.aborted = true;
      return abort.call(this);
    };
  }, name);
  return () => page.evaluate(() => (window as Window & { pdfReadProbe: ReadProbe }).pdfReadProbe);
}

const canvas = (page: Page, index: number) => page.locator(`canvas.pdfv-page[data-page-index="${index}"][data-rendered="true"]`);
const scrollToPage = (page: Page, index: number) => page.locator('.pdfv-preview').evaluate((viewport, index) => {
  viewport.scrollTop = viewport.scrollHeight * index / 600;
}, index);

test('releases a displaced PDF lookup of a page dictionary Blob slice', async ({ page }) => {
  const { bytes, offset } = createPdfPageTreeRangeFixture();
  const name = 'page-tree.pdf';
  const probe = await trackPdfReads(page, name);
  const go = (index: number) => page.locator('.pdfv-preview').evaluate((viewport, index) => {
    viewport.scrollTop = viewport.scrollHeight * index / 12;
  }, index);
  const pause = (at: number) => page.evaluate(at => { (window as Window & { pdfReadProbe: ReadProbe }).pdfReadProbe.pauseAt = at; }, at);
  await page.goto('./?view=preview&lang=en');
  await page.getByLabel('Import files', { exact: true }).setInputFiles({ name, mimeType: 'application/pdf', buffer: bytes });
  await expect(canvas(page, 0)).toBeInViewport();
  await pause(offset);
  await go(5);
  const reads = async () => (await probe()).reads.filter(read => read.begin <= offset && offset < read.end);
  await expect.poll(async () => (await reads())[0]).toMatchObject({ held: true, aborted: false });
  await expect(page.locator('.pdfv-page[data-page-index="5"]')).toHaveCount(0);
  await go(10);
  await expect(canvas(page, 10)).toBeInViewport();
  await expect.poll(async () => (await reads())[0]?.aborted).toBe(true);
  await pause(-1);
  await go(5);
  await expect(canvas(page, 5)).toBeInViewport();
  await expect(page.locator('.pdfv-page-slot[data-page-index="5"] .pdfv-text-layer[data-rendered="true"]')).toHaveText('Page 6');
  expect(await canvas(page, 5).evaluate(canvas => parseFloat(canvas.style.width) / parseFloat(canvas.style.height))).toBeCloseTo(2 / 3, 5);
  expect(await reads()).toHaveLength(2);
});

test('releases a displaced PDF annotation appearance resource Blob slice', async ({ page }) => {
  const { bytes, offset } = createPdfAnnotationRangeFixture('resources');
  const name = 'annotations.pdf';
  const probe = await trackPdfReads(page, name);
  const go = (index: number) => page.locator('.pdfv-preview').evaluate((viewport, index) => {
    viewport.scrollTop = viewport.scrollHeight * index / 12;
  }, index);
  const pause = (at: number) => page.evaluate(at => { (window as Window & { pdfReadProbe: ReadProbe }).pdfReadProbe.pauseAt = at; }, at);
  await page.goto('./?view=preview&lang=en');
  await page.getByLabel('Import files', { exact: true }).setInputFiles({ name, mimeType: 'application/pdf', buffer: bytes });
  await expect(canvas(page, 0)).toBeInViewport();
  await pause(offset);
  await go(5);
  const reads = async () => (await probe()).reads.filter(read => read.begin <= offset && offset < read.end);
  await expect.poll(async () => (await reads())[0]).toMatchObject({ held: true, aborted: false });
  await expect(page.locator('canvas.pdfv-page[data-page-index="5"]:not([data-rendered])')).toBeInViewport();
  await go(10);
  await expect(canvas(page, 10)).toBeInViewport();
  await expect.poll(async () => (await reads())[0]?.aborted).toBe(true);
  await pause(-1);
  await go(5);
  await expect(canvas(page, 5)).toBeInViewport();
  expect(await canvas(page, 5).evaluate((canvas: HTMLCanvasElement) =>
    Array.from(canvas.getContext('2d')!.getImageData(canvas.width * .15, canvas.height * .25, 1, 1).data)))
    .toEqual([255, 0, 0, 255]);
  expect(await reads()).toHaveLength(2);
});

test('cancels a displaced PDF page Blob slice and reads the same page on return', async ({ page }) => {
  const { bytes, offset, match } = createPdfSearchRangeFixture();
  const name = 'displaced-page.pdf';
  const probe = await trackPdfReads(page, name);
  const go = (index: number) => page.locator('.pdfv-preview').evaluate((viewport, index) => {
    viewport.scrollTop = viewport.scrollHeight * index / 12;
  }, index);
  const pause = (at: number) => page.evaluate(at => { (window as Window & { pdfReadProbe: ReadProbe }).pdfReadProbe.pauseAt = at; }, at);
  await page.goto('./?view=preview&lang=en');
  await page.getByLabel('Import files', { exact: true }).setInputFiles({ name, mimeType: 'application/pdf', buffer: bytes });
  await expect(canvas(page, 0)).toBeInViewport();
  await pause(offset);
  await go(5);
  const reads = async () => (await probe()).reads.filter(read => read.begin <= offset && offset < read.end);
  await expect.poll(async () => (await reads())[0]).toMatchObject({ held: true, aborted: false });
  await go(10);
  await expect(canvas(page, 10)).toBeInViewport();
  await expect.poll(async () => (await reads())[0]?.aborted).toBe(true);
  await pause(-1);
  await go(5);
  await expect(canvas(page, 5)).toBeInViewport();
  await expect(page.locator('.pdfv-page-slot[data-page-index="5"] .pdfv-text-layer[data-rendered="true"]')).toHaveText(match);
  expect(await reads()).toHaveLength(2);
});

test('cancels a held PDF search Blob slice and can search the same page again', async ({ page }) => {
  const { bytes, offset, match } = createPdfSearchRangeFixture();
  const name = 'sliced-search.pdf';
  const probe = await trackPdfReads(page, name);
  const errors: Error[] = [];
  page.on('pageerror', error => errors.push(error));
  await page.goto('./?view=preview&lang=en');
  await page.getByLabel('Import files', { exact: true }).setInputFiles({ name, mimeType: 'application/pdf', buffer: bytes });
  await expect(canvas(page, 0)).toBeVisible();
  const pause = (at: number) => page.evaluate(at => { (window as Window & { pdfReadProbe: ReadProbe }).pdfReadProbe.pauseAt = at; }, at);
  await pause(offset);
  await page.locator('.pdfv-search-controls summary').click();
  const search = page.getByRole('searchbox', { name: 'Find in document', exact: true });
  await search.fill('missing phrase');
  await search.press('Enter');
  const held = async () => (await probe()).reads.find(read => read.held);
  await expect.poll(async () => (await held())?.aborted).toBe(false);
  await search.clear();
  await expect.poll(async () => (await held())?.aborted).toBe(true);
  await expect(canvas(page, 0)).toBeVisible();
  await pause(-1);
  await search.fill(match);
  await search.press('Enter');
  await expect(page.locator('.pdfv-page-slot[data-page-index="5"] .pdfv-search-match.is-active')).toHaveText(match);
  const reads = await probe();
  expect(reads.whole).toBe(0);
  expect(reads.reads.filter(read => read.begin <= offset && offset < read.end)).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('reads a large PDF upload by slices and aborts a held distant page read on replacement', async ({ page }, testInfo) => {
  const bytes = Buffer.from(createPdfFixture(600, false, 0, undefined, 20));
  const name = 'sliced.pdf';
  const probe = await trackPdfReads(page, name);
  const errors: Error[] = [];
  page.on('pageerror', error => errors.push(error));
  await page.goto('./?view=preview&lang=en');
  const upload = page.getByLabel('Import files', { exact: true });
  await upload.setInputFiles({ name, mimeType: 'application/pdf', buffer: bytes });
  await expect(canvas(page, 0)).toBeVisible();
  const startup = await probe(), startupBytes = startup.reads.reduce((sum, read) => sum + read.end - read.begin, 0);
  expect(startup.whole).toBe(0);
  expect(startupBytes).toBeGreaterThan(0);
  expect(startupBytes).toBeLessThan(bytes.length / 4);
  await testInfo.attach('PDF startup reads', { body: JSON.stringify({ startupBytes, fileBytes: bytes.length }), contentType: 'application/json' });

  const middle = bytes.indexOf('Document page 301');
  const far = bytes.indexOf('Document page 501');
  expect(middle).toBeGreaterThan(0);
  expect(far).toBeGreaterThan(middle);
  const includes = (read: SliceRead, offset: number) => read.begin <= offset && read.end > offset;
  expect(startup.reads.some(read => includes(read, middle))).toBe(false);
  await scrollToPage(page, 300);
  await expect(canvas(page, 300)).toBeVisible();
  expect((await probe()).reads.some(read => includes(read, middle))).toBe(true);

  expect((await probe()).reads.some(read => includes(read, far))).toBe(false);
  await page.evaluate(far => { (window as Window & { pdfReadProbe: ReadProbe }).pdfReadProbe.pauseAt = far; }, far);
  await scrollToPage(page, 500);
  await expect.poll(async () => (await probe()).reads.find(read => read.held)?.aborted).toBe(false);
  await upload.setInputFiles({ name: 'replacement.txt', mimeType: 'text/plain', buffer: Buffer.from('Replacement is ready.') });
  await expect(page.locator('.wb-preview-stage')).toContainText('Replacement is ready.');
  await expect.poll(async () => (await probe()).reads.find(read => read.held)?.aborted).toBe(true);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('cancels a local PDF attachment slice and lets the same attachment reopen', async ({ page }) => {
  const { bytes, payloadOffset } = createPdfAttachmentRangeFixture();
  const name = 'sliced-attachment.pdf';
  const probe = await trackPdfReads(page, name);
  const errors: Error[] = [];
  page.on('pageerror', error => errors.push(error));
  await page.goto('./?view=preview&lang=en');
  await page.getByLabel('Import files', { exact: true }).setInputFiles({ name, mimeType: 'application/pdf', buffer: bytes });
  await expect(canvas(page, 0)).toBeVisible();
  await page.locator('.filens-attachments summary').click();
  const large = page.getByRole('button', { name: 'large.bin', exact: true });
  await expect(large).toBeVisible();
  const held = async () => (await probe()).reads.filter(read => read.held);
  await page.evaluate(offset => { (window as Window & { pdfReadProbe: ReadProbe }).pdfReadProbe.pauseAt = offset; }, payloadOffset);
  await large.click();
  await expect.poll(async () => (await held())[0]?.aborted).toBe(false);
  await page.getByRole('button', { name: 'Back to document', exact: true }).click();
  await expect.poll(async () => (await held())[0]?.aborted).toBe(true);
  await expect(canvas(page, 0)).toBeVisible();
  await page.evaluate(() => { (window as Window & { pdfReadProbe: ReadProbe }).pdfReadProbe.pauseAt = -1; });
  const [attachment] = await Promise.all([page.waitForEvent('download'),
    page.locator('.filens-attachments li').filter({ hasText: 'large.bin' }).getByRole('button', { name: 'Download attachment' }).click()]);
  const downloaded = await readFile((await attachment.path())!);
  expect(downloaded).toEqual(bytes.subarray(payloadOffset - downloaded.length / 2, payloadOffset + downloaded.length / 2));
  expect((await probe()).whole).toBe(0);
  expect(errors).toEqual([]);
});

test('uses local PDF ranges for a password-protected file after retrying the password', async ({ page }) => {
  const fixture = (await readFile('packages/converter-client/test/fixtures/password/encrypted.pdf')).toString('latin1');
  const xref = Number(/startxref\s+(\d+)/.exec(fixture)![1]);
  expect(fixture.slice(xref, xref + 4)).toBe('xref');
  const padding = '% unused PDF comment\n'.repeat(16_384);
  const bytes = Buffer.from(fixture.slice(0, xref) + padding + fixture.slice(xref).replace(/startxref\s+\d+/, `startxref\n${xref + padding.length}`), 'latin1');
  const name = 'sliced-protected.pdf';
  const probe = await trackPdfReads(page, name);
  await page.goto('./?view=preview&lang=zh_CN');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({ name, mimeType: 'application/pdf', buffer: bytes });
  const field = page.getByLabel('文档密码', { exact: true });
  await expect(field).toBeVisible();
  await field.fill('wrong');
  await field.press('Enter');
  await expect(page.getByRole('alert')).toContainText('密码不正确，请重试。');
  await field.fill('test123');
  await field.press('Enter');
  await expect(canvas(page, 0)).toBeVisible();
  await expect(field).toHaveCount(0);
  const reads = await probe();
  expect(reads.whole).toBe(0);
  expect(reads.reads.length).toBeGreaterThan(0);
});
