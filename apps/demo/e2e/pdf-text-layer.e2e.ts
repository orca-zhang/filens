import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { createPdfFixture } from '../../../packages/pdf/test/fixtures/document.mjs';

test.use({ deviceScaleFactor: 2 });

for (const rotation of [0, 90, 180, 270]) test(`selects PDF text at rotation ${rotation} and keeps it aligned after zoom`, async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/pdf/src/index.ts')}`, page.url()).href;
  await page.evaluate(async ({ moduleUrl, bytes }) => {
    const { createPdfPreviewDriver } = await import(/* @vite-ignore */ moduleUrl);
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;width:800px;height:600px;background:white';
    document.body.replaceChildren(host);
    const session = createPdfPreviewDriver().createSession(host);
    (window as any).pdfTextTest = { session, host };
    const source = new Uint8Array(bytes);
    await session.load(source, { descriptor: { source, name: 'selectable.pdf' } });
  }, { moduleUrl, bytes: [...createPdfFixture(100, false, rotation)] });
  const text = page.locator('.pdfv-page-slot[data-page-index="0"] .pdfv-text-layer[data-rendered="true"] span').first();
  await expect(text).toHaveText('Document page 1');
  const before = await text.boundingBox();
  expect(before).not.toBeNull();
  const canvas = await page.locator('canvas[data-page-index="0"]').boundingBox();
  expect(before!.x).toBeGreaterThanOrEqual(canvas!.x);
  expect(before!.y).toBeGreaterThanOrEqual(canvas!.y);
  expect(before!.x + before!.width).toBeLessThanOrEqual(canvas!.x + canvas!.width + 1);
  expect(before!.y + before!.height).toBeLessThanOrEqual(canvas!.y + canvas!.height + 1);
  const box = before!;
  const start = rotation === 0 ? [box.x + 1, box.y + box.height / 2]
    : rotation === 90 ? [box.x + box.width / 2, box.y + 1]
    : rotation === 180 ? [box.x + box.width - 1, box.y + box.height / 2]
    : [box.x + box.width / 2, box.y + box.height - 1];
  const end = rotation === 0 ? [box.x + box.width - 1, start[1]]
    : rotation === 90 ? [start[0], box.y + box.height - 1]
    : rotation === 180 ? [box.x + 1, start[1]] : [start[0], box.y + 1];
  await page.mouse.move(start[0], start[1]);
  await page.mouse.down();
  await page.mouse.move(end[0], end[1], { steps: 10 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('Document page 1');
  await page.evaluate(() => (window as any).pdfTextTest.session.setScale(1.5));
  await expect.poll(async () => (await text.boundingBox())?.width ?? 0).toBeCloseTo(before!.width * 1.5, 0);
  await page.evaluate(() => (window as any).pdfTextTest.session.goToPage(50));
  await expect(page.locator('.pdfv-page-slot[data-page-index="50"] .pdfv-text-layer[data-rendered="true"]')).toHaveText('Document page 51');
  expect(await page.locator('.pdfv-text-layer').count()).toBeLessThanOrEqual(4);
  await expect(page.locator('.pdfv-page-slot[data-page-index="0"] .pdfv-text-layer')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).pdfTextTest.session.getState().warnings)).toEqual([]);
  await page.evaluate(() => (window as any).pdfTextTest.session.destroy());
  await expect(page.locator('.pdfv-text-layer')).toHaveCount(0);
  expect(errors).toEqual([]);
});
