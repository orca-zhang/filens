import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { createPdfOutlineFixture, servePdfFixture } from '../../../packages/pdf/test/fixtures/range-source.mjs';

test('activates PDF page links and cancels replaced destination reads', async ({ page }) => {
  const { bytes, destinationOffset } = createPdfOutlineFixture({ pageLinks: true });
  const server = await servePdfFixture(bytes);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const requests = () => server.requests.filter(request => request.partial && request.begin <= destinationOffset && destinationOffset < request.end);
  const root = page.locator('.pdfv-preview');
  const slot = (index: number) => root.locator(`.pdfv-page-slot[data-page-index="${index}"]`);
  const state = () => page.evaluate(() => (window as any).linkedPdf.getState());
  const go = (index: number) => page.evaluate(index => (window as any).linkedPdf.goToPage(index), index);
  const relativeBox = (element: HTMLElement) => {
    const page = element.closest('.pdfv-page-slot')!.getBoundingClientRect(), rect = element.getBoundingClientRect();
    return [rect.x - page.x, rect.y - page.y, rect.width, rect.height].map(Math.round);
  };
  try {
    await page.goto('./');
    const moduleUrl = new URL(`@fs${resolve('packages/pdf/src/index.ts')}`, page.url()).href;
    await page.evaluate(async ({ moduleUrl, source }) => {
      const { PdfPreviewSession } = await import(/* @vite-ignore */ moduleUrl);
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;inset:0;width:800px;height:600px';
      document.body.replaceChildren(host);
      const session = new PdfPreviewSession(host, { fit: 'none' });
      Object.assign(window, { linkedPdf: session });
      await session.load(source, { descriptor: { source, name: 'page-links.pdf' } });
    }, { moduleUrl, source: server.url });

    const direct = slot(0).getByRole('button', { name: 'Jump to chapter' });
    const named = slot(0).getByRole('button', { name: 'Jump to rotated page' });
    const external = slot(0).getByRole('link', { name: 'Web reference' });
    await expect(direct.locator('span')).toHaveCount(2);
    expect(await direct.locator('span').first().evaluate(relativeBox)).toEqual([24, 40, 156, 20]);
    expect(await direct.locator('span').last().evaluate(relativeBox)).toEqual([24, 80, 96, 20]);
    expect(await direct.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(rect.left + 8, rect.top + 30));
    })).toBe(false);
    await expect(external).toHaveAttribute('href', 'https://example.com/spec');
    await expect(external).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(slot(0).locator('.pdfv-page-links > *')).toHaveCount(3);
    expect(requests()).toHaveLength(0);

    await direct.locator('span').last().click();
    await expect.poll(state).toMatchObject({ pageIndex: 5, scale: 1 });
    await expect(root).toBeFocused();
    await expect.poll(() => slot(5).evaluate(element => Math.round(
      element.closest('.pdfv-preview')!.getBoundingClientRect().top - element.getBoundingClientRect().top))).toBe(420);
    await expect(slot(0).locator('.pdfv-page-links')).toHaveCount(0);

    await go(0);
    server.pauseRanges(destinationOffset);
    await named.press('Enter');
    await expect.poll(() => requests()[0]?.bytesSent).toBe(0);
    await go(2);
    await expect.poll(() => requests()[0]?.cancelled).toBe(true);
    await expect.poll(state).toMatchObject({ pageIndex: 2 });

    server.resumeRanges();
    await go(0);
    await named.press('Enter');
    await expect.poll(state).toMatchObject({ pageIndex: 22, scale: 1 });
    const back = slot(22).getByRole('button', { name: 'Return to first page' });
    await expect(back).toBeInViewport();
    expect(await back.evaluate(relativeBox)).toEqual([740, 420, 100, 70]);
    await page.evaluate(() => (window as any).linkedPdf.setScale(1.25));
    await expect.poll(() => back.evaluate(relativeBox)).toEqual([925, 525, 125, 88]);
    await back.press('Enter');
    await expect.poll(state).toMatchObject({ pageIndex: 0, scale: 1.25 });
    await expect(root).toBeFocused();
    expect(requests()).toHaveLength(2);
    expect(errors).toEqual([]);
  } finally { await server.close(); }
});
