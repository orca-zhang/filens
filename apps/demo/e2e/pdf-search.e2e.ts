import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { createPdfFixture } from '../../../packages/pdf/test/fixtures/document.mjs';

for (const rotation of [0, 90]) test(`searches all PDF pages at rotation ${rotation} and preserves highlights through zoom`, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/pdf/src/index.ts')}`, page.url()).href;
  const coreUrl = new URL(`@fs${resolve('packages/core/src/preview-runtime.ts')}`, page.url()).href;
  await page.evaluate(async ({ moduleUrl, coreUrl, bytes }) => {
    const { createPreviewer } = await import(/* @vite-ignore */ coreUrl);
    const { createPdfPreviewDriver } = await import(/* @vite-ignore */ moduleUrl);
    const host = document.createElement('div'); host.style.cssText = 'position:fixed;inset:0;width:800px;height:600px;background:white';
    document.body.replaceChildren(host);
    const session = createPreviewer(host, { drivers: [createPdfPreviewDriver()] });
    (window as any).pdfSearch = session;
    const source = new Uint8Array(bytes);
    await session.preview(source, { name: 'search.pdf', extension: 'pdf' });
    await session.find('PAGE 100');
  }, { moduleUrl, coreUrl, bytes: [...createPdfFixture(100, false, rotation)] });
  const active = page.locator('.pdfv-search-match.is-active');
  await expect(active).toHaveText('page 100');
  expect(await page.evaluate(() => (window as any).pdfSearch.getState().search)).toMatchObject({ total: 1, pagesScanned: 100, searching: false, truncated: false });
  expect(await page.locator('canvas').count()).toBeLessThanOrEqual(4);
  await page.evaluate(() => (window as any).pdfSearch.setScale(1.5));
  await expect(active).toHaveText('page 100');
  expect(await active.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(0);
  await expect(active).toBeInViewport({ ratio: 1 });
  await page.evaluate(async () => { await (window as any).pdfSearch.find('Document page'); (window as any).pdfSearch.findNext(true); });
  await expect(active).toHaveText('Document page');
  await expect(page.locator('.pdfv-page-slot[data-page-index="99"] .is-active')).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).pdfSearch.getState().search)).toMatchObject({ total: 100, activeIndex: 99 });
  await page.evaluate(() => (window as any).pdfSearch.findNext());
  await expect(page.locator('.pdfv-page-slot[data-page-index="0"] .is-active')).toHaveCount(1);
  await page.evaluate(async () => { await (window as any).pdfSearch.find(''); });
  await expect(active).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('highlights a phrase across actual PDF font-size runs and line breaks', async ({ page }) => {
  const source = createPdfFixture(1, false, 0, (_index: number, height: number) =>
    `1 1 1 rg BT /F1 24 Tf 40 ${height - 60} Td (Hello ) Tj /F1 18 Tf (world) Tj 0 -30 Td (search) Tj ET\n`);
  await page.goto('./?view=preview&lang=zh_CN');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({ name: 'split.pdf', mimeType: 'application/pdf', buffer: Buffer.from(source) });
  await expect(page.locator('.pdfv-text-layer[data-rendered="true"]')).toHaveCount(1);
  await page.locator('.pdfv-search-controls summary').click();
  const input = page.getByRole('searchbox', { name: '在文档中查找', exact: true });
  await input.fill('lo world'); await input.press('Enter');
  await expect(page.locator('.pdfv-search-controls output')).toHaveText('1 / 1');
  expect((await page.locator('.pdfv-search-match.is-active').allTextContents()).join('')).toBe('lo world');
  expect(await page.locator('.pdfv-search-match.is-active').count()).toBeGreaterThanOrEqual(2);
  await input.fill('world search'); await input.press('Enter');
  await expect(page.locator('.pdfv-search-controls output')).toHaveText('1 / 1');
  await expect.poll(async () => (await page.locator('.pdfv-search-match.is-active').allTextContents()).join('').replace(/\s/g, '')).toBe('worldsearch');
});

test('exposes localized find controls with keyboard navigation, clearing and source cleanup', async ({ page }) => {
  await page.goto('./?view=preview&lang=zh_CN');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({ name: 'search.pdf', mimeType: 'application/pdf', buffer: Buffer.from(createPdfFixture(100)) });
  await expect(page.locator('canvas.pdfv-page[data-rendered="true"]').first()).toBeVisible();
  await page.locator('.pdfv-preview').focus();
  await page.keyboard.press('Control+f');
  const input = page.getByRole('searchbox', { name: '在文档中查找', exact: true });
  await expect(input).toBeFocused();
  await input.fill('Document page'); await input.press('Enter');
  const output = page.locator('.pdfv-search-controls output');
  await expect(output).toHaveText('1 / 100');
  await page.getByRole('button', { name: '下一处匹配', exact: true }).click();
  await expect(output).toHaveText('2 / 100');
  await input.press('Shift+Enter'); await expect(output).toHaveText('1 / 100');
  await page.getByRole('button', { name: '上一处匹配', exact: true }).click();
  await expect(output).toHaveText('100 / 100');
  await expect(page.locator('.pdfv-page-slot[data-page-index="99"] .is-active')).toHaveCount(1);
  await input.fill('no match'); await input.fill('page 100');
  await expect(output).toHaveText('1 / 1');
  await page.getByRole('button', { name: 'Switch to English', exact: true }).click();
  const englishInput = page.getByRole('searchbox', { name: 'Find in document', exact: true });
  await expect(englishInput).toHaveValue('page 100');
  await expect(output).toHaveText('1 / 1');
  await expect(page.locator('.pdfv-search-match.is-active')).toHaveText('page 100');
  await englishInput.press('Escape');
  await expect(page.locator('.pdfv-search-controls')).not.toHaveAttribute('open');
  await expect(page.locator('.pdfv-search-match')).toHaveCount(0);
  await page.getByRole('button', { name: 'CSV', exact: true }).click();
  await expect(page.locator('.xlsxv-table')).toBeVisible();
  await expect(page.locator('.pdfv-search-controls')).toHaveCount(0);
});
