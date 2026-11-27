import { expect, test } from '@playwright/test';
import { createConditionalFormattingWorkbook } from '../../../packages/xlsx/test/fixtures/conditional-formatting-workbook.mjs';
import { createRepeatedConditionalWorkbook } from '../../../packages/xlsx/test/fixtures/repeated-conditional-workbook.mjs';

test('paints repeated base and Office 2010 conditional rules through the final Excel cell', async ({ page }) => {
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({ name: 'repeated-conditions.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createRepeatedConditionalWorkbook(8000)) });
  const grid = page.locator('.xlsxv-grid');
  const at = (row: number, col: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${col + 1}"]`);
  await expect(at(1, 1)).toHaveCSS('background-color', 'rgb(255, 205, 210)');
  await expect(at(1, 1)).toHaveCSS('font-style', 'italic');
  await expect(at(1, 2)).toHaveCSS('font-weight', '700');
  await expect(at(1, 2)).toHaveCSS('font-style', 'normal');
  await expect(at(2, 1)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(at(1, 4)).toHaveCSS('background-color', 'rgb(204, 221, 255)');
  await expect(at(4, 4)).toHaveCSS('background-color', 'rgb(204, 221, 255)');
  await expect(at(1, 6)).toHaveCSS('font-style', 'normal');

  await grid.evaluate(element => { element.scrollTop = element.scrollHeight; element.scrollLeft = element.scrollWidth; });
  const final = at(1_048_576, 16_384);
  await expect(final).toHaveText('9.0');
  await expect(final).toHaveCSS('background-color', 'rgb(255, 205, 210)');
  await expect(final).toHaveCSS('text-decoration-line', 'line-through');
  await expect(final).toBeInViewport();
  await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
});

test('applies XLSX conditional rules through both axes without expanding the grid', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1100, height: 720 });
  await page.goto('./?view=preview');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({ name: 'conditional-formatting.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createConditionalFormattingWorkbook()) });
  const grid = page.locator('.xlsxv-grid');
  const at = (row: number, col: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${col + 1}"]`);
  await expect(at(1, 1)).toHaveText('12.00');
  await expect(at(1, 1)).toHaveCSS('background-color', 'rgb(255, 205, 210)');
  await expect(at(1, 1)).toHaveCSS('border-left-color', 'rgb(100, 116, 139)');
  await expect(at(1, 1)).toHaveCSS('border-bottom-width', '3px');
  await expect(at(2, 1)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(at(3, 1)).toHaveText('7.00');
  await expect(at(3, 1)).toHaveCSS('background-color', 'rgb(220, 252, 231)');
  await expect(at(3, 1)).toHaveCSS('font-style', 'italic');
  await expect(at(4, 1)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(at(5, 1)).toHaveText('4');
  await expect(at(5, 1)).toHaveCSS('font-style', 'normal');
  await expect(at(5, 1)).toHaveCSS('font-weight', '400');
  await expect(at(5, 1)).toHaveCSS('text-decoration-line', 'none');
  await expect(at(1, 2)).toHaveCSS('font-weight', '700');
  await expect(at(2, 2)).toHaveCSS('font-weight', '400');
  await expect(at(1, 3)).toHaveCSS('background-color', 'rgb(253, 230, 138)');
  await expect(at(1, 4)).toBeEmpty();
  await expect(at(1, 4)).toHaveCSS('background-color', 'rgb(241, 245, 249)');
  await expect(at(3, 5)).toHaveCSS('background-color', 'rgb(254, 215, 170)');
  await expect(at(1, 6).locator('span > span')).toHaveCSS('color', 'rgb(51, 102, 153)');
  await expect(at(1, 6).locator('span > span')).toHaveCSS('font-style', 'normal');
  await expect(at(1, 8)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(at(2, 8)).toHaveCSS('background-color', 'rgb(220, 252, 231)');
  await expect(at(1, 9)).toHaveCSS('background-color', 'rgb(253, 230, 138)');
  await expect(at(2, 9)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(at(2, 10)).toHaveCSS('background-color', 'rgb(220, 252, 231)');

  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight * 1000 / 1048576; grid.scrollLeft = 3400; });
  const merge = grid.locator('[data-merge-ref="A500"]');
  await expect(merge).toHaveText('12');
  await expect(merge).toHaveCSS('background-color', 'rgb(255, 205, 210)');
  await expect(merge).toBeInViewport();
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
  const last = at(1048576, 16384);
  await expect(last).toHaveText('22.00');
  await expect(last).toHaveCSS('background-color', 'rgb(255, 205, 210)');
  await expect(last).toHaveCSS('font-weight', '700');
  await expect(last).toHaveCSS('border-bottom-width', '3px');
  await expect(at(1048575, 16382)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(at(1048576, 16382)).toHaveCSS('background-color', 'rgb(220, 252, 231)');
  await expect(at(1048575, 16383)).toHaveCSS('background-color', 'rgb(253, 230, 138)');
  await expect(at(1048576, 16383)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(last).toBeInViewport();
  await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
  expect(await grid.locator('.xlsxv-cell').count()).toBeLessThanOrEqual(2400);

  await page.getByRole('button', { name: 'Numeric', exact: true }).click();
  await expect(at(1, 1)).toHaveCSS('background-color', 'rgb(255, 205, 210)');
  await expect(at(2, 1)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(2);
  expect(errors).toEqual([]);
});
