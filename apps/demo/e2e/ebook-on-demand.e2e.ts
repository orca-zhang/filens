import { resolve } from 'node:path';
import JSZip from 'jszip';
import { expect, test } from '@playwright/test';
import { createBookFixture } from '../../../packages/ebook/test/fixtures/books.mjs';

test('keeps navigation responsive during a slow EPUB chapter and discards its late resources', async ({ page }) => {
  const zip = await JSZip.loadAsync(await createBookFixture(3, 2));
  for (let index = 1; index <= 3; index++) {
    const entry = zip.file(`OPS/chapter-${index}.xhtml`)!;
    zip.file(entry.name, (await entry.async('text')).replace('</body>', `<img src="image-${index}.svg"/>${index === 2 ? '<img src="waiting.svg"/>' : ''}</body>`));
    zip.file(`OPS/image-${index}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="64"><text x="1" y="20">${index}</text></svg>`);
  }
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/ebook/src/index.ts')}`, page.url()).href;
  await page.evaluate(async ({ moduleUrl, bytes }) => {
    const { createEbookPreviewDriver } = await import(/* @vite-ignore */ moduleUrl);
    const host = document.createElement('div'); host.style.cssText = 'position:fixed;inset:0;width:800px;height:600px';
    document.body.replaceChildren(host);
    const active = new Set<string>(), create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => { const url = create(blob); active.add(url); return url; };
    URL.revokeObjectURL = url => { active.delete(url); revoke(url); };
    const test = (window as any).lazyBook = { active, requests: 0 };
    test.session = createEbookPreviewDriver().createSession(host, { resourceResolver: () => {
      test.requests++; return new Promise(resolve => { test.finish = resolve; });
    } });
    const source = new Uint8Array(bytes);
    await test.session.load(source, { descriptor: { source, extension: 'epub' } });
  }, { moduleUrl, bytes: [...await zip.generateAsync({ type: 'uint8array' })] });
  const chapter = page.frameLocator('.ebookv-frame');
  await expect(chapter.locator('h1')).toHaveText('Chapter 1');
  await page.locator('.ebookv-chapter-tab').nth(1).click();
  await expect.poll(() => page.evaluate(() => (window as any).lazyBook.requests)).toBe(1);
  await expect(page.locator('.ebookv-stage')).toHaveAttribute('aria-busy', 'true');
  await expect(chapter.locator('h1')).toHaveText('Chapter 1');
  expect(await page.evaluate(() => (window as any).lazyBook.session.getState())).toMatchObject({ loading: false, chapterLoading: true });
  await page.locator('.ebookv-chapter-tab').nth(2).click();
  await expect(chapter.locator('h1')).toHaveText('Chapter 3');
  await expect(page.locator('.ebookv-stage')).toHaveAttribute('aria-busy', 'false');
  expect(await page.evaluate(() => (window as any).lazyBook.active.size)).toBe(1);
  await page.evaluate(() => (window as any).lazyBook.finish(new Blob(['<svg/>'], { type: 'image/svg+xml' })));
  await expect(chapter.locator('h1')).toHaveText('Chapter 3');
  expect(await page.evaluate(() => (window as any).lazyBook.active.size)).toBe(1);
  await page.evaluate(() => (window as any).lazyBook.session.destroy());
  expect(await page.evaluate(() => (window as any).lazyBook.active.size)).toBe(0);
  expect(errors).toEqual([]);
});
