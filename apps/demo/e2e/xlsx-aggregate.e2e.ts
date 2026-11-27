import { expect, test } from '@playwright/test';
import { createAggregateWorkbook } from '../../../packages/xlsx/test/fixtures/aggregate-workbook.mjs';

test('evaluates uncached AGGREGATE on a sparse XLSX workbook through the final grid cell', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({
    name: 'aggregate.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createAggregateWorkbook())
  });
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, column: number) =>
    grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
  for (const [index, value] of ['17', '8.5', '10', '40', '#DIV/0!', '997'].entries()) {
    await expect(cell(1, index + 1)).toHaveText(value);
  }
  await expect(cell(2, 2)).toHaveText(String(16_380 * 1_048_576));
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
  const final = cell(1_048_576, 16_384);
  await expect(final).toHaveText('20');
  await expect(final).toBeInViewport();
  await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
});
