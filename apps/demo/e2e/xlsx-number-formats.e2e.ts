import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { createNumberFormatWorkbook } from '../../../packages/xlsx/test/fixtures/number-format-workbook.mjs';

test('preserves XLSX date, percent and number formats through virtual windows and file replacement', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./?view=preview');
  const input = page.getByLabel('导入文件', { exact: true });
  const open = async (date1904: boolean) => input.setInputFiles({
    name: date1904 ? 'formats-1904.xlsx' : 'formats-1900.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createNumberFormatWorkbook({ date1904, formulas: true }))
  });
  const grid = page.locator('.xlsxv-grid');
  const table = grid.locator('table');
  const cell = (row: number, col: number) => table.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${col + 1}"]`);

  await open(false);
  await expect(cell(1, 1)).toHaveText('1,234.50');
  await expect(cell(1, 2)).toHaveText('12.5%');
  await expect(cell(1, 3)).toHaveText('1900-02-29 12:00:00');
  await expect(cell(1, 4)).toHaveText('36:00:00');
  await expect(cell(1, 5)).toHaveText('(1,234.50)');
  await expect(cell(1, 7)).toHaveText('ID 00123');
  await expect(cell(1, 9)).toHaveText('');
  await expect(cell(2, 2)).toHaveText('37.6%');
  await expect(cell(2, 8)).toHaveText('5.00');

  await grid.evaluate(grid => { grid.scrollTop = 26 * 1000; grid.scrollLeft = grid.scrollWidth / 2; });
  const merge = table.locator('[data-merge-ref="A500"]');
  await expect(merge).toHaveText('(1,234.50)');
  await expect(merge).toBeInViewport();
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
  await expect(cell(2000, 64)).toHaveText('2,470.00');
  await expect(cell(2000, 64)).toBeInViewport();
  expect(await table.locator('.xlsxv-cell').count()).toBeLessThanOrEqual(2200);

  await open(true);
  await expect(cell(1, 3)).toHaveText('1904-03-01 12:00:00');
  await expect(cell(1, 4)).toHaveText('36:00:00');
  await expect(cell(2, 3)).toHaveText('2024-02-29 14:30:00');
  await expect(cell(2, 4)).toHaveText('=UNKNOWN(A1)');
  await expect(cell(2, 5)).toHaveText('#DIV/0!');
  expect(await grid.evaluate(grid => [grid.scrollTop, grid.scrollLeft])).toEqual([0, 0]);
  expect(errors).toEqual([]);
});

test('renders the built-in date format in the existing XLSX data types sample', async ({ page }) => {
  await page.goto('./?view=preview');
  await page.getByLabel('导入文件', { exact: true })
    .setInputFiles(resolve('apps/demo/public/samples/rich-xlsx-data-types.xlsx'));
  await expect(page.locator('.xlsxv-table tr[aria-rowindex="5"] td[aria-colindex="3"]')).toHaveText('5/17/16');
});
