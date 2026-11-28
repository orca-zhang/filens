import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { createPdfFixture } from '../../../packages/pdf/test/fixtures/document.mjs';
import { createPdfOutlineFixture, servePdfFixture } from '../../../packages/pdf/test/fixtures/range-source.mjs';

test('reads PDF bookmarks on demand and cancels displaced outline and destination reads', async ({ page }) => {
  const { bytes, outlineOffset, destinationOffset } = createPdfOutlineFixture({ extraBookmarks: 104 });
  const server = await servePdfFixture(bytes);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const requests = (offset: number) => server.requests.filter(request => request.partial && request.begin <= offset && offset < request.end);
  const outline = page.locator('.pdfv-outline');
  const summary = outline.locator('summary');
  const root = page.locator('.pdfv-preview');
  const slot = (index: number) => root.locator(`.pdfv-page-slot[data-page-index="${index}"]`);
  const state = () => page.evaluate(() => (window as any).outlinePdf.getState());
  const position = (index: number) => slot(index).evaluate(element => {
    const root = element.closest('.pdfv-preview')!.getBoundingClientRect(), page = element.getBoundingClientRect();
    return { x: root.left - page.left, y: root.top - page.top };
  });
  try {
    await page.goto('./');
    const moduleUrl = new URL(`@fs${resolve('packages/pdf/src/index.ts')}`, page.url()).href;
    await page.evaluate(async ({ moduleUrl, source }) => {
      const { PdfPreviewSession } = await import(/* @vite-ignore */ moduleUrl);
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;inset:0;width:800px;height:600px';
      document.body.replaceChildren(host);
      const session = new PdfPreviewSession(host, { fit: 'none' });
      Object.assign(window, { outlinePdf: session });
      await session.load(source, { descriptor: { source, name: 'bookmarks.pdf' } });
    }, { moduleUrl, source: server.url });

    await expect(slot(0).locator('canvas[data-rendered="true"]')).toBeInViewport();
    expect(requests(outlineOffset)).toHaveLength(0);
    expect(requests(destinationOffset)).toHaveLength(0);
    server.pauseRanges(outlineOffset);
    await summary.click();
    await expect.poll(() => requests(outlineOffset)[0]?.bytesSent).toBe(0);
    await summary.press('Escape');
    await expect.poll(() => requests(outlineOffset)[0]?.cancelled).toBe(true);
    await expect(summary).toBeFocused();

    server.resumeRanges();
    await summary.press('Enter');
    const chapter = outline.getByRole('button', { name: 'Main chapter', exact: true });
    await expect(chapter).toBeVisible();
    await expect(outline.getByRole('link', { name: 'Online reference' })).toHaveAttribute('rel', 'noopener noreferrer');
    const lastBookmark = outline.getByRole('button', { name: 'Extra bookmark 104', exact: true });
    await expect(lastBookmark).toHaveCount(0);
    await outline.getByRole('button', { name: 'Show more' }).click();
    await expect(lastBookmark).toHaveCount(1);
    await expect(outline.getByRole('button', { name: 'Rotated subject' })).toHaveCount(0);
    await outline.getByRole('button', { name: 'Expand Main chapter' }).click();
    const subject = outline.getByRole('button', { name: 'Rotated subject' });
    await expect(subject).toBeVisible();
    await chapter.click();
    await expect.poll(state).toMatchObject({ pageIndex: 5, pageCount: 24, scale: 1 });
    await expect.poll(async () => Math.abs((await position(5)).y - 420)).toBeLessThan(2);
    await expect(root).toBeFocused();
    expect(requests(destinationOffset)).toHaveLength(0);

    server.pauseRanges(destinationOffset);
    await summary.click();
    await subject.click();
    await expect.poll(() => requests(destinationOffset)[0]?.bytesSent).toBe(0);
    await subject.press('Escape');
    await expect.poll(() => requests(destinationOffset)[0]?.cancelled).toBe(true);
    await expect.poll(state).toMatchObject({ pageIndex: 5 });
    server.resumeRanges();
    await summary.click();
    await subject.click();
    await expect.poll(state).toMatchObject({ pageIndex: 22, scale: 1 });
    await expect(slot(22).locator('canvas[data-rendered="true"]')).toBeInViewport();
    await expect.poll(async () => Math.abs((await position(22)).y - 400)).toBeLessThan(2);
    await expect.poll(async () => Math.abs((await position(22)).x - 700)).toBeLessThan(2);
    expect(requests(destinationOffset)).toHaveLength(2);

    await page.evaluate(async data => {
      const source = new Uint8Array(data);
      await (window as any).outlinePdf.load(source, { descriptor: { source, name: 'no-bookmarks.pdf' } });
    }, [...createPdfFixture(1)]);
    await summary.click();
    await expect(outline.getByRole('status')).toHaveText('No table of contents');
    await expect(chapter).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { await server.close(); }
});
