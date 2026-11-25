import { expect, test } from '@playwright/test';
import { createRichTextWorkbook } from '../../../packages/xlsx/test/fixtures/rich-text-workbook.mjs';

test('renders rich strings and their styles across sparse XLSX windows', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 720 });
  await page.goto('./?view=preview');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({
    name: 'rich-text.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createRichTextWorkbook())
  });
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, column: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
  const first = cell(1, 1), runs = first.locator('span > span');
  const raw = '  Before <b>中文</b>²';
  await expect(runs).toHaveCount(3);
  expect(await first.textContent()).toBe(raw);
  await expect(first.locator('b')).toHaveCount(0);
  await expect(runs.nth(0)).toHaveCSS('font-weight', '700');
  await expect(runs.nth(0)).toHaveCSS('text-decoration-line', 'underline line-through');
  await expect(runs.nth(1)).toHaveCSS('font-family', /Schedule Face/);
  await expect(runs.nth(1)).toHaveCSS('font-weight', '400');
  await expect(runs.nth(1)).toHaveCSS('font-style', 'normal');
  await expect(runs.nth(1)).toHaveCSS('font-size', '40px');
  await expect(runs.nth(1)).toHaveCSS('color', 'rgb(25, 51, 77)');
  await expect(runs.nth(1)).toHaveCSS('text-decoration-line', 'none');
  await expect(runs.nth(2)).toHaveCSS('vertical-align', 'super');
  await expect(runs.nth(2)).toHaveCSS('text-decoration-style', 'double');
  await expect.poll(() => first.evaluate(cell => cell.parentElement!.offsetHeight)).toBeGreaterThan(45);
  expect(await cell(1, 2).textContent()).toBe(`[${raw}]`);
  await expect(cell(1, 2).locator('span > span').nth(2)).toHaveCSS('font-size', '40px');
  await expect(cell(1, 3).locator('span')).toHaveCount(0);

  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight * 1000 / 1048576; grid.scrollLeft = 3400; });
  const merged = grid.locator('[data-merge-ref="A500"] .xlsxv-merged-content');
  await expect(merged.locator('span > span').nth(1)).toHaveCSS('font-size', '40px');
  await expect(merged).toHaveCSS('justify-content', 'center');
  expect(await merged.textContent()).toBe(raw);
  await expect(first).toHaveCount(0);

  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
  const last = cell(1048576, 16384);
  await expect(last).toBeInViewport();
  await expect(last.locator('span > span').nth(1)).toHaveCSS('font-size', '40px');
  await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(100);

  await page.getByRole('button', { name: 'Inline', exact: true }).click();
  await expect(cell(1, 2)).toHaveText('inline 2');
  await expect(cell(1, 2).locator('span > span').last()).toHaveCSS('vertical-align', 'sub');
  await expect(cell(1, 3)).toHaveText(String(raw.length));
});
