import { expect, test } from '@playwright/test';
import { createLetWorkbook } from '../../../packages/xlsx/test/fixtures/let-workbook.mjs';

test('evaluates uncached LET bindings and sparse array formulas through the final Excel cell', async ({ page }) => {
  await page.setViewportSize({ width: 1370, height: 800 });
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({
    name: 'let.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createLetWorkbook())
  });
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, column: number) =>
    grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
  for (const [index, value] of ['26', '58', '13', '41', 'saved fallback', '4/5', '991'].entries()) {
    await expect(cell(1, index + 1)).toHaveText(value);
  }
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
  const final = cell(1_048_576, 16_384);
  await expect(final).toHaveText(String(16_380 * 1_048_576 + 24));
  await expect(final).toBeInViewport();
  await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
});
