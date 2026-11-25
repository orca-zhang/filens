import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { createColumnWidthWorkbookFixture } from '../../../packages/xlsx/test/fixtures/workbook.mjs';

for (const general of [false, true]) {
  test(`preserves XLSX source column widths and merged coordinates through distant windows (general: ${general})`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('./?view=preview');
    await page.getByLabel('导入文件', { exact: true }).setInputFiles({ name: 'source-widths.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from(await createColumnWidthWorkbookFixture({ general })) });
    const grid = page.locator('.xlsxv-grid'), table = grid.locator('table');
    const heading = table.locator('[data-merge-ref="A1"]');
    await expect(heading).toHaveText('Merged heading');
    const digitWidth = Math.round((await table.locator('.xlsxv-col-header').first().boundingBox())!.width / 4);
    const firstWidths = [4, 28, 8.7109375, 12].map(width => Math.trunc((width + Math.trunc(128 / digitWidth) / 256) * digitWidth));
    for (let column = 0; column < 4; column++) {
      expect((await table.locator('.xlsxv-col-header').nth(column).boundingBox())!.width).toBeCloseTo(firstWidths[column], 0);
    }
    const firstTotal = firstWidths.reduce((sum, width) => sum + width, 0);
    expect((await heading.boundingBox())!.width).toBeCloseTo(firstTotal, 0);
    const defaultWidth = 10 * digitWidth, wideWidth = 255 * digitWidth;
    await grid.evaluate((grid, left) => { grid.scrollLeft = left; }, firstTotal + 26 * defaultWidth + wideWidth * .4);
    const wide = table.locator('.xlsxv-col-header[aria-colindex="32"]');
    await expect(wide).toBeInViewport();
    expect((await wide.boundingBox())!.width).toBeCloseTo(wideWidth, 0);
    await grid.evaluate(grid => { grid.scrollTop = 26 * 1000; });
    const merge = table.locator('[data-merge-ref="A500"]');
    await expect(merge).toHaveText('Tall merge'); await expect(merge).toBeInViewport();
    const total = firstTotal + 58 * defaultWidth + wideWidth + 20 * digitWidth;
    expect((await merge.locator('.xlsxv-merged-content').boundingBox())!.width).toBeCloseTo(total - 16, 0);
    await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
    const last = table.locator('tr[aria-rowindex="2001"] td[aria-colindex="65"]');
    await expect(last).toHaveText('15'); await expect(last).toBeInViewport();
    expect((await last.boundingBox())!.width).toBeCloseTo(20 * digitWidth, 0);
    const position = await grid.evaluate(grid => [grid.scrollTop, grid.scrollLeft]);
    await page.setViewportSize({ width: 900, height: 720 });
    expect(await grid.evaluate(grid => [grid.scrollTop, grid.scrollLeft])).toEqual(position);
    await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
    await expect(last).toBeInViewport();
    expect(await table.locator('.xlsxv-cell').count()).toBeLessThanOrEqual(2400);
    expect(errors).toEqual([]);
  });
}

test('reaches the final Excel cell with source column widths and offscreen formula references', async ({ page }) => {
  await page.goto('./?view=preview');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({ name: 'source-extreme.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createColumnWidthWorkbookFixture({ extreme: true })) });
  const grid = page.locator('.xlsxv-grid'), table = grid.locator('table');
  await expect(table).toHaveAttribute('aria-colcount', '16385');
  const digitWidth = Math.round((await table.locator('.xlsxv-col-header').first().boundingBox())!.width / 4);
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
  const last = table.locator('tr[aria-rowindex="1048577"] td[aria-colindex="16385"]');
  await expect(last).toHaveText('15'); await expect(last).toBeInViewport();
  expect((await last.boundingBox())!.width).toBeCloseTo(30 * digitWidth, 0);
  expect(await table.locator('.xlsxv-cell').count()).toBeLessThanOrEqual(2400);
  await expect(table.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollLeft = 0; });
  await expect(table.locator('tr[aria-rowindex="2"] td[aria-colindex="2"]')).toHaveText('7');
});

test('refreshes XLSX column metrics after font readiness without changing the logical reading column', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/xlsx/src/index.ts')}`, page.url()).href;
  await page.evaluate(async ({ moduleUrl, bytes }) => {
    const original = CanvasRenderingContext2D.prototype.measureText;
    (window as any).digitWidth = 7;
    CanvasRenderingContext2D.prototype.measureText = function (text: string) {
      return /^\d$/.test(text) && this.font.includes('Courier New') ? { width: (window as any).digitWidth } as TextMetrics : original.call(this, text);
    };
    const { createXlsxPreviewDriver } = await import(/* @vite-ignore */ moduleUrl);
    const host = document.createElement('div'); host.style.cssText = 'position:fixed;inset:0'; document.body.replaceChildren(host);
    const session = createXlsxPreviewDriver().createSession(host), source = new Uint8Array(bytes);
    await session.load(source, { descriptor: { source, extension: 'xlsx', name: 'source-widths.xlsx' } });
    (window as any).sourceWidths = session;
  }, { moduleUrl, bytes: [...await createColumnWidthWorkbookFixture()] });
  const grid = page.locator('.xlsxv-grid'), table = grid.locator('table');
  await grid.evaluate(grid => { grid.scrollTop = 26 * 1000; grid.scrollLeft = 3189; });
  const wide = table.locator('.xlsxv-col-header[aria-colindex="32"]');
  await expect(wide).toHaveCSS('width', '1785px'); await expect(wide).toBeInViewport();
  const top = await grid.evaluate(grid => grid.scrollTop);
  await page.evaluate(() => {
    (window as any).digitWidth = 10;
    const session = (window as any).sourceWidths;
    session.refreshFonts({ references: [...session.getFontReferences()], loaded: [], warnings: [], relayout: true });
  });
  await expect(wide).toHaveCSS('width', '2550px'); await expect(wide).toBeInViewport();
  const expectedLeft = 3127 + 1000 * 10 / 7;
  await expect.poll(async () => Math.abs(await grid.evaluate(grid => grid.scrollLeft) - expectedLeft)).toBeLessThanOrEqual(1);
  expect(await grid.evaluate(grid => grid.scrollTop)).toBe(top);
  await expect(table.locator('[data-merge-ref="A500"]')).toHaveText('Tall merge');
  await page.evaluate(() => (window as any).sourceWidths.destroy());
  await expect(page.locator('.xlsxv-grid')).toHaveCount(0);
  expect(errors).toEqual([]);
});
