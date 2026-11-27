import { expect, test } from '@playwright/test';
import { createConditionalExtensionWorkbook } from '../../../packages/xlsx/test/fixtures/conditional-extension-workbook.mjs';
import { createConditionalVisualWorkbook } from '../../../packages/xlsx/test/fixtures/conditional-visual-workbook.mjs';

test('renders standalone Office 2010 rules with inline styles through the final Excel cell', async ({ page }) => {
  await page.setViewportSize({ width: 1150, height: 730 });
  await page.goto('./?view=preview');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({ name: 'conditional-extensions.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(await createConditionalExtensionWorkbook()) });
  const grid = page.locator('.xlsxv-grid');
  const at = (row: number, col: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${col + 1}"]`);
  await expect(at(1, 1)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(at(2, 1)).toHaveCSS('background-color', 'rgb(85, 85, 85)');
  await expect(at(1, 2)).toHaveText('15.00 units');
  await expect(at(1, 2)).toHaveCSS('color', 'rgb(0, 102, 68)');
  await expect(at(1, 2)).toHaveCSS('border-top-color', 'rgb(17, 34, 51)');
  await expect(at(1, 2)).toHaveCSS('font-weight', '700');
  await expect(at(1, 2)).toHaveCSS('font-style', 'normal');
  await expect(at(2, 2)).toHaveCSS('font-style', 'italic');
  await expect(at(3, 2)).toHaveText('8.00 units');
  await expect(at(2, 4)).toHaveCSS('background-color', 'rgb(255, 238, 221)');
  await expect(at(3, 5)).toHaveCSS('background-color', 'rgb(221, 255, 238)');
  await expect(at(2, 6)).toHaveCSS('background-color', 'rgb(204, 221, 255)');
  await expect(at(1, 8)).toHaveCSS('background-color', 'rgb(204, 255, 238)');
  await expect(at(2, 8)).toHaveCSS('background-color', 'rgb(255, 238, 204)');
  await expect(at(1, 9)).toHaveCSS('font-weight', '700');
  await expect(at(2, 9)).toHaveCSS('background-color', 'rgb(221, 204, 255)');
  await expect(at(1, 10)).toHaveText('#N/A');
  await expect(at(1, 10)).toHaveCSS('background-color', 'rgb(255, 204, 204)');
  await expect(at(1, 10)).toHaveCSS('font-weight', '700');
  await expect(at(1, 10)).toHaveCSS('color', 'rgb(153, 0, 153)');
  await expect(at(2, 10)).toHaveCSS('background-color', 'rgb(204, 255, 204)');
  await expect(at(2, 10)).toHaveCSS('font-weight', '400');
  await expect(at(3, 10)).toHaveText('#VALUE!');
  await expect(at(3, 10)).toHaveCSS('font-weight', '400');
  await grid.evaluate(element => { element.scrollTop = element.scrollHeight; element.scrollLeft = element.scrollWidth; });
  const last = at(1048576, 16384);
  await expect(last).toHaveText('40');
  await expect(last).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(last).toBeInViewport();
  await expect(at(1048576, 16383)).toHaveCSS('background-color', 'rgb(204, 255, 238)');
  await expect(at(1048576, 16382)).toHaveText('#DIV/0!');
  await expect(at(1048576, 16382)).toHaveCSS('font-weight', '700');
});

test('renders XLSX scales and signed data bars across sparse windows', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1100, height: 720 });
  await page.goto('./?view=preview');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({ name: 'conditional-visuals.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(await createConditionalVisualWorkbook()) });
  const grid = page.locator('.xlsxv-grid');
  const at = (row: number, col: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${col + 1}"]`);
  const fill = (row: number, col: number) => at(row, col).locator('.xlsxv-data-bar-fill');
  await expect(at(2, 1)).toHaveCSS('background-color', 'rgb(128, 0, 0)');
  await expect(at(4, 1)).toHaveCSS('background-color', 'rgb(255, 223, 223)');
  await expect(at(5, 1)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(at(2, 2)).toHaveAccessibleName('25');
  await expect(at(2, 2).locator('.xlsxv-data-bar-hidden-value')).toHaveCSS('opacity', '0');
  await expect(fill(2, 2)).toHaveCSS('background-image', /linear-gradient/);
  await expect(fill(2, 3)).toHaveCSS('background-color', 'rgb(170, 17, 34)');
  await expect(fill(2, 3)).toHaveCSS('border-left-color', 'rgb(102, 0, 17)');
  await expect(at(2, 3)).toHaveCSS('background-color', 'rgb(255, 255, 153)');
  await expect(fill(3, 3)).toHaveCount(0);
  await expect(at(3, 3).locator('.xlsxv-data-bar-axis')).toHaveCSS('border-left-color', 'rgb(51, 68, 85)');
  await expect(fill(4, 3)).toHaveCSS('background-color', 'rgb(0, 136, 102)');
  expect(await fill(1, 4).evaluate(fill => (fill as HTMLElement).style.left)).toBe('50%');

  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight * 1000 / 1048576; grid.scrollLeft = 3400; });
  const merge = grid.locator('[data-merge-ref="H500"]');
  await expect(merge.locator('.xlsxv-data-bar-fill')).toHaveCSS('background-image', /linear-gradient/);
  const geometry = await merge.locator('.xlsxv-data-bar-track').evaluate(track => ({
    width: track.getBoundingClientRect().width, offset: track.getBoundingClientRect().left - track.parentElement!.getBoundingClientRect().left
  }));
  expect(geometry.width).toBeGreaterThan(3000);
  expect(geometry.offset).toBeLessThan(-2000);

  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
  const last = at(1048576, 16384);
  await expect(last).toBeInViewport();
  await expect(last).toHaveAccessibleName('100');
  expect(await fill(1048576, 16384).evaluate(fill => (fill as HTMLElement).style.width)).toBe('80%');
  await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
  expect(await grid.locator('.xlsxv-cell').count()).toBeLessThanOrEqual(2400);
  await grid.evaluate(grid => { grid.scrollLeft = 0; });
  await expect(at(1048576, 1)).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await grid.evaluate(grid => { grid.scrollTop = 0; });
  await expect(at(2, 1)).toHaveCSS('background-color', 'rgb(128, 0, 0)');
  await page.getByRole('button', { name: 'Plain Values', exact: true }).click();
  await expect(at(1, 1)).toHaveCSS('background-color', 'rgb(17, 34, 51)');
  await expect(at(2, 1)).toHaveCSS('background-color', 'rgb(171, 205, 239)');
  expect(errors).toEqual([]);
});
