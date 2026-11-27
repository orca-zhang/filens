import { expect, test } from '@playwright/test';
import { createRangeBookFixture } from '../../../packages/ebook/test/fixtures/range-books.mjs';
import { serveZipFixture } from './zip-range-fixture';

for (const { format, zip64 } of [
  { format: 'epub', zip64: false }, { format: 'cbz', zip64: false }, { format: 'cbz', zip64: true },
] as const) {
  const name = format.toUpperCase() + (zip64 ? ' (ZIP64)' : '');
  test(`opens remote ${name} by ranges and cancels an obsolete range on a page turn`, async ({ page }, testInfo) => {
    const bytes = await createRangeBookFixture(format, { zip64 });
    const server = await serveZipFixture(bytes, format);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(`./?url=${encodeURIComponent(server.url)}&lang=en`);
      const tabs = page.locator('.ebookv-chapter-tab');
      const frame = page.frameLocator('iframe.ebookv-frame');
      const image = frame.locator('img');
      const checkPage = async (index: number) => {
        if (format === 'epub') await expect(frame.locator('h1')).toHaveText(`Chapter ${index}`);
        else await expect(image).toHaveAttribute('alt', `Page ${index}`);
        await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth)).toBe(100);
      };
      await checkPage(1);
      await expect(tabs).toHaveCount(3);
      const startupBytes = server.requests.reduce((sum, request) => sum + request.sent, 0);
      expect(startupBytes).toBeLessThan(bytes.length / 8);
      expect(server.requests.every(request => request.range)).toBe(true);
      await testInfo.attach('Ebook startup transfer', { body: JSON.stringify({ startupBytes, fileBytes: bytes.length }), contentType: 'application/json' });
      const middle = bytes.indexOf('Artwork 2');
      expect(middle).toBeGreaterThanOrEqual(0);
      const middleRequest = () => server.requests.find(request => request.begin <= middle && request.end > middle);
      expect(middleRequest()).toBeUndefined();
      server.pause(middle);
      await tabs.nth(1).click();
      await expect.poll(() => middleRequest()?.sent).toBe(0);
      await checkPage(1);
      await tabs.nth(2).click();
      await checkPage(3);
      await expect.poll(() => middleRequest()?.cancelled).toBe(true);
      await expect(page.locator('.ebookv-stage')).toHaveAttribute('aria-busy', 'false');
      expect(errors).toEqual([]);
    } finally { await server.close(); }
  });
}

test('opens a remote book from an ordinary full HTTP response', async ({ page }) => {
  const bytes = await createRangeBookFixture('epub');
  const server = await serveZipFixture(bytes, 'epub', false);
  try {
    await page.goto(`./?url=${encodeURIComponent(server.url)}&lang=en`);
    await expect(page.frameLocator('iframe.ebookv-frame').locator('h1')).toHaveText('Chapter 1');
    expect(server.requests).toMatchObject([{ range: 'bytes=0-0', sent: bytes.length, cancelled: false }]);
  } finally { await server.close(); }
});
