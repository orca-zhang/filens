import { expect, test } from '@playwright/test';
import { createConditionalStatisticsWorkbook } from '../../../packages/xlsx/test/fixtures/conditional-statistics-workbook.mjs';

test('applies range statistics before and after scrolling a sparse XLSX workbook', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1100, height: 720 });
  await page.goto('./?view=preview');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({ name: 'conditional-statistics.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createConditionalStatisticsWorkbook()) });
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, column: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
  const red = 'rgb(255, 205, 210)', orange = 'rgb(254, 215, 170)', green = 'rgb(220, 252, 231)';
  await expect(cell(1, 1)).toHaveCSS('background-color', orange);
  await expect(cell(1, 1)).toHaveCSS('font-weight', '700');
  await expect(cell(2, 1)).toHaveCSS('background-color', red);
  await expect(cell(3, 1)).toHaveCSS('background-color', red);
  await expect(cell(5, 2)).toHaveCSS('background-color', red);
  await expect(cell(2, 3)).toHaveCSS('font-style', 'italic');
  await expect(cell(2, 3)).toHaveCSS('font-weight', '700');
  await expect(cell(3, 4)).toHaveCSS('background-color', red);
  await expect(cell(5, 4)).toHaveCSS('background-color', green);
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
  const last = cell(1048576, 16384);
  await expect(last).toHaveText('50');
  await expect(last).toHaveCSS('background-color', red);
  await expect(last).toBeInViewport();
  expect(await grid.locator('.xlsxv-cell').count()).toBeLessThanOrEqual(2400);
  expect(errors).toEqual([]);
});
