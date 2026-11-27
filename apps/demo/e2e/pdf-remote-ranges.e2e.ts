import { expect, test, type Page } from '@playwright/test';
import { createPdfFixture } from '../../../packages/pdf/test/fixtures/document.mjs';
import { servePdfFixture } from '../../../packages/pdf/test/fixtures/range-source.mjs';

const bytes = Buffer.from(createPdfFixture(600, false, 0, undefined, 20));
const canvas = (page: Page, index: number) => page.locator(`canvas.pdfv-page[data-page-index="${index}"][data-rendered="true"]`);
const scrollToPage = (page: Page, index: number) => page.locator('.pdfv-preview').evaluate((viewport, index) => {
  viewport.scrollTop = viewport.scrollHeight * index / 600;
}, index);

test('reads ranges from the remote PDF, fetches distant pages and cancels when replaced', async ({ page }, testInfo) => {
  const server = await servePdfFixture(bytes);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(`./?url=${encodeURIComponent(server.url)}&lang=zh`);
    await expect(canvas(page, 0)).toBeVisible();
    await expect(page.getByRole('note').getByRole('link')).toHaveAttribute('href', server.url);
    await expect.poll(() => server.requests[0]?.cancelled).toBe(true);
    expect(server.requests.filter(request => !request.partial)).toHaveLength(1);
    const startupBytes = server.requests.reduce((sum, request) => sum + request.bytesSent, 0);
    expect(startupBytes).toBeLessThan(bytes.length / 4);
    await testInfo.attach('PDF startup transfer', { body: JSON.stringify({ startupBytes, fileBytes: bytes.length,
      requests: server.requests }, null, 2), contentType: 'application/json' });

    const middle = bytes.indexOf('Document page 301');
    const middleRange = () => server.requests.find(request => request.partial && request.begin <= middle && request.end > middle);
    expect(middleRange()).toBeUndefined();
    await scrollToPage(page, 300);
    await expect(canvas(page, 300)).toBeVisible();
    expect(middleRange()).toBeDefined();

    server.pauseRanges();
    const before = server.requests.length;
    const pending = () => server.requests.slice(before).find(request => request.partial);
    await scrollToPage(page, 500);
    await expect.poll(() => pending()?.bytesSent).toBe(0);
    await scrollToPage(page, 0);
    await expect(canvas(page, 0)).toBeVisible();
    expect(pending()?.cancelled).toBe(false);
    await page.getByLabel('导入文件', { exact: true }).setInputFiles({
      name: 'replacement.txt', mimeType: 'text/plain', buffer: Buffer.from('Replacement is ready.'),
    });
    await expect.poll(() => pending()?.cancelled).toBe(true);
    await expect(page.locator('.wb-preview-stage')).toContainText('Replacement is ready.');
    await expect(canvas(page, 500)).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { await server.close(); }
});

test('opens a PDF from an HTTP server without range support', async ({ page }) => {
  const server = await servePdfFixture(bytes, { ranges: false });
  try {
    await page.goto(`./?url=${encodeURIComponent(server.url)}&lang=en`);
    await expect(canvas(page, 0)).toBeVisible();
    expect(server.requests).toMatchObject([{ partial: false, bytesSent: bytes.length, cancelled: false }]);
  } finally { await server.close(); }
});

test('loads distant pages and searches a large PDF across disjoint byte ranges', async ({ page }) => {
  const small = Buffer.from(createPdfFixture(8)).toString('latin1');
  const split = small.indexOf('\n8 0 obj\n') + 1;
  const xref = Number(/startxref\s+(\d+)/.exec(small)![1]);
  const unused = Number(/xref\n0 (\d+)/.exec(small)![1]);
  const paddingSize = 24 * 1024 * 1024;
  const padding = Buffer.concat([Buffer.from(`${unused} 0 obj\n<< /Length ${paddingSize} >>\nstream\n`),
    Buffer.alloc(paddingSize), Buffer.from('\nendstream\nendobj\n')]);
  const gap = padding.length;
  const tail = small.slice(xref).replace(/^(\d{10})( \d{5} n )$/gm, (_, offset, flag) =>
    String(Number(offset) + (Number(offset) >= split ? gap : 0)).padStart(10, '0') + flag)
    .replace(`xref\n0 ${unused}`, `xref\n0 ${unused + 1}`)
    .replace(`trailer\n<< /Size ${unused}`, `${String(split).padStart(10, '0')} 00000 n \ntrailer\n<< /Size ${unused + 1}`)
    .replace(/startxref\s+\d+/, `startxref\n${xref + gap}`);
  const large = Buffer.concat([Buffer.from(small.slice(0, split)), padding,
    Buffer.from(small.slice(split, xref) + tail)]);
  const server = await servePdfFixture(large);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(`./?url=${encodeURIComponent(server.url)}&lang=zh`);
    await expect(canvas(page, 0)).toBeVisible();
    await expect(page.locator('.pdfv-text-layer')).toContainText('Document page 1');
    await page.locator('.pdfv-search-controls summary').click();
    const input = page.getByRole('searchbox', { name: '在文档中查找', exact: true });
    await input.fill('Document page 8');
    await input.press('Enter');
    await expect(page.locator('.pdfv-search-controls output')).toHaveText('1 / 1');
    await expect(page.locator('.pdfv-search-match.is-active')).toHaveText('Document page 8');
    await expect(canvas(page, 7)).toBeVisible();
    expect(server.requests.some(request => request.partial && request.begin >= paddingSize)).toBe(true);
    expect(server.requests.reduce((total, request) => total + request.bytesSent, 0)).toBeLessThan(1024 * 1024);
    expect(errors).toEqual([]);
  } finally { await server.close(); }
});
