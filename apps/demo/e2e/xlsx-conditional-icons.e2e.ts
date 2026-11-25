import { expect, test } from '@playwright/test';
import { createConditionalIconWorkbook } from '../../../packages/xlsx/test/fixtures/conditional-icon-workbook.mjs';

test('renders conditional icon sets and accessible values through both XLSX window axes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1100, height: 720 });
  await page.goto('./?view=preview');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({ name: 'conditional-icons.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(await createConditionalIconWorkbook()) });
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, col: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${col + 1}"]`);
  const icon = (row: number, col: number) => cell(row, col).getByRole('img');
  await expect(icon(4, 1)).toHaveAccessibleName('Red traffic light');
  await expect(icon(6, 1)).toHaveAccessibleName('Yellow traffic light');
  await expect(icon(5, 1)).toHaveAccessibleName('Green traffic light');
  await expect(icon(7, 1)).toHaveCount(0);
  await expect(icon(1, 2)).toHaveAccessibleName('Up arrow');
  await expect(icon(3, 2)).toHaveAccessibleName('Right arrow');
  await expect(cell(1, 2)).toHaveAccessibleName(/Up arrow.*0/);
  await expect(cell(1, 2).locator('.xlsxv-icon-hidden-value')).toHaveCSS('clip-path', 'inset(50%)');
  await expect(icon(1, 3)).toHaveCount(0);
  await expect(cell(1, 3)).toHaveAccessibleName('5');
  await expect(cell(1, 3).locator('.xlsxv-icon-hidden-value')).toHaveText('5');
  await expect(icon(2, 3)).toHaveAccessibleName('Star fill 1 of 2');
  await expect(icon(3, 3)).toHaveAccessibleName('Filled boxes 4 of 4');
  await expect(icon(4, 3)).toHaveAccessibleName('Green flag');
  await expect(cell(4, 3).locator('.xlsxv-icon-hidden-value')).toHaveCount(0);
  await expect(icon(5, 3)).toHaveAccessibleName('Up triangle');

  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight * 1040 / 1048576; grid.scrollLeft = 2800; });
  const merged = grid.locator('[data-merge-ref="F500"]');
  await expect(merged.getByRole('img', { name: 'Green flag' })).toBeInViewport();
  await expect(merged).toHaveAccessibleName(/Green flag.*42/);
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
  await expect(icon(1048576, 16384)).toHaveAccessibleName('Down arrow');
  await expect(icon(1048576, 16384)).toBeInViewport();
  await expect(cell(1048576, 16384)).toHaveAccessibleName(/Down arrow.*120/);
  await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
  expect(await grid.locator('.xlsxv-cell').count()).toBeLessThanOrEqual(2400);

  await grid.evaluate(grid => { grid.scrollLeft = 0; });
  await expect(icon(1048576, 1)).toHaveAccessibleName('Green traffic light');
  await page.getByRole('button', { name: 'Plain Values', exact: true }).click();
  await expect(icon(1, 1)).toHaveAccessibleName('Dark gray circle');
  await expect(icon(2, 1)).toHaveAccessibleName('Dark red circle');
  await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(2);
  expect(errors).toEqual([]);
});
