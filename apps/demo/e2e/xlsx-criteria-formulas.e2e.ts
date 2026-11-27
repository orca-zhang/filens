import { expect, test } from '@playwright/test';
import { createCriteriaFormulaWorkbook } from '../../../packages/xlsx/test/fixtures/criteria-formula-workbook.mjs';

test('evaluates uncached XLSX conditional aggregates across sparse sheets and windows', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1310, height: 800 });
  await page.goto('./?view=preview');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({ name: 'conditional-aggregates.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createCriteriaFormulaWorkbook()) });
  const grid = page.locator('.xlsxv-grid');
  const row = (index: number) => grid.locator(`tr[aria-rowindex="${index + 1}"]`);
  const cell = (index: number, column: number) => row(index).locator(`td[aria-colindex="${column + 1}"]`);
  for (const [index, value] of ['4', '33', '11', '9', '20', '1048568', '1', '21', '7'].entries()) {
    await expect(cell(1, index + 1)).toHaveText(value);
  }
  for (const [index, value] of ['1', 'bad', '#VALUE!', '#DIV/0!', '77', '#REF!', '1048572'].entries()) {
    await expect(cell(2, index + 1)).toHaveText(value);
  }
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
  const last = cell(1048576, 16384);
  await expect(last).toHaveText('46.00');
  await expect(last).toBeInViewport();
  await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
  expect(await grid.locator('.xlsxv-cell').count()).toBeLessThanOrEqual(2400);
  await page.getByRole('button', { name: "Team's Ledger", exact: true }).click();
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; });
  await expect(cell(1048576, 3)).toHaveText('20');
  expect(errors).toEqual([]);
});
