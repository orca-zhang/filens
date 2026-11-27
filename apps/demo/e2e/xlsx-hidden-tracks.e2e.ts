import { expect, test } from '@playwright/test';
import { createHiddenTracksWorkbook } from '../../../packages/xlsx/test/fixtures/hidden-tracks-workbook.mjs';

test('collapses XLSX hidden tracks while preserving source addresses and merge anchors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1080, height: 720 });
  await page.goto('./?view=preview');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({ name: 'hidden-tracks.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createHiddenTracksWorkbook()) });
  const grid = page.locator('.xlsxv-grid');
  const body = grid.locator('tbody tr[aria-rowindex]');
  const header = grid.locator('.xlsxv-col-header');
  const cell = (row: number, column: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
  await expect(body.locator('.xlsxv-row-header')).toHaveText(['3', '4', '1048576']);
  await expect(header).toHaveText(['A', 'C', 'E', 'XFC', 'XFD']);
  const merge = grid.locator('[data-merge-ref="B1"]');
  await expect(merge).toHaveText('8');
  await expect(merge).toHaveCSS('background-color', 'rgb(220, 252, 231)');
  await expect(merge).toHaveAttribute('rowspan', '2');
  await expect(merge).toHaveAttribute('colspan', '2');
  await expect(cell(1048576, 16384)).toHaveText('25');
  await expect(cell(1048576, 16384)).toBeInViewport();
  expect(await grid.evaluate(grid => Math.max(grid.scrollWidth - grid.clientWidth, grid.scrollHeight - grid.clientHeight))).toBeLessThanOrEqual(1);

  await page.getByRole('button', { name: 'Wide', exact: true }).click();
  await expect(cell(2, 1)).toHaveCount(0);
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
  await expect(cell(1048575, 16383)).toHaveText('110');
  await expect(cell(1048575, 16383)).toBeInViewport();
  await expect(cell(1048576, 16384)).toHaveCount(0);
  await expect(header.last()).toHaveText('XFC');
  await expect(body).toHaveCount(100);
  expect(await grid.locator('.xlsxv-cell').count()).toBeLessThanOrEqual(2500);

  await page.getByRole('button', { name: 'Empty', exact: true }).click();
  await expect(header).toHaveCount(0);
  await expect(body).toHaveCount(0);
  expect(errors).toEqual([]);
});
