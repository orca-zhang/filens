import { expect, test } from '@playwright/test';
import { createRowHeightWorkbook } from '../../../packages/xlsx/test/fixtures/row-height-workbook.mjs';

test.use({ timezoneId: 'UTC' });

test('retains fractional row minima and measured wrapping across horizontal scroll and clock refresh', async ({ page }) => {
  const firstDay = new Date('2024-01-01T12:00:00Z'), secondDay = new Date('2024-01-02T12:00:00Z');
  await page.clock.setFixedTime(firstDay);
  await page.setViewportSize({ width: 1040, height: 830 });
  await page.goto('./?view=preview');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({ name: 'fractional-row-heights.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createRowHeightWorkbook({ fractional: true })) });
  const grid = page.locator('.xlsxv-grid');
  const row = (index: number) => grid.locator(`tbody tr[aria-rowindex="${index + 1}"]`);
  const height = (index: number) => row(index).evaluate(row => parseFloat(row.style.height));
  await expect.poll(() => height(3)).toBeGreaterThan(60);
  const wrapped = await height(3);
  await expect.poll(() => height(8)).toBeCloseTo(wrapped, 2);
  await expect.poll(() => height(1)).toBeCloseTo(15.5 * 4 / 3, 3);
  await expect.poll(() => height(10)).toBeCloseTo(15.5 * 4 / 3, 3);

  await page.setViewportSize({ width: 3000, height: 830 });
  await grid.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  const clock = row(7).locator('td[aria-colindex="16385"]');
  await expect.poll(() => grid.locator('.xlsxv-col-header').count()).toBeGreaterThan(20);
  await expect(clock).toHaveText('1');
  await expect(row(9).getByText('short', { exact: true })).toBeVisible();
  await expect(row(3).getByText('Sixth line', { exact: false })).toHaveCount(0);
  await expect.poll(() => height(3)).toBeCloseTo(wrapped, 3);
  await page.clock.setFixedTime(secondDay);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(clock).toHaveText('2');
  await expect.poll(() => height(3)).toBeCloseTo(wrapped, 3);
  await expect(row(9).getByText('Sixth line', { exact: false })).toBeVisible();
  await expect.poll(() => height(9)).toBeGreaterThan(60);
  await expect.poll(() => height(8)).toBeGreaterThan(wrapped + 40);

  await page.setViewportSize({ width: 1040, height: 830 });
  await grid.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  await expect(grid.locator('.xlsxv-col-header')).toHaveCount(20);
  await page.clock.setFixedTime(firstDay);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(clock).toHaveText('1');
  await expect(row(8).getByText('short', { exact: true })).toBeVisible();
  await expect(row(9).getByText('short', { exact: true })).toBeVisible();
  await expect.poll(() => height(8)).toBeCloseTo(wrapped, 2);
  await expect.poll(() => height(9)).toBeLessThan(30);
  await expect.poll(() => height(3)).toBeCloseTo(wrapped, 3);

  await grid.evaluate(element => { element.scrollTop = element.scrollHeight; });
  const last = row(1048576).locator('td[aria-colindex="16385"]');
  await expect(last).toHaveText('71');
  await expect(last).toBeInViewport();
  await expect.poll(() => height(1048575)).toBeCloseTo(15.5 * 4 / 3, 3);
  await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(100);

  await page.getByRole('button', { name: 'Compact', exact: true }).click();
  await page.clock.setFixedTime(firstDay);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(row(2).getByText('Sixth line', { exact: false })).toBeVisible();
  await expect.poll(() => height(2)).toBeGreaterThan(60);
  await page.clock.setFixedTime(secondDay);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(row(2).getByText('short', { exact: true })).toBeVisible();
  await expect.poll(() => height(2)).toBeLessThan(30);
});

test('preserves XLSX row heights, fixed cell clipping and sparse navigation', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1040, height: 1100 });
  await page.goto('./?view=preview');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({ name: 'row-heights.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createRowHeightWorkbook({ formula: true })) });
  const grid = page.locator('.xlsxv-grid');
  const row = (index: number) => grid.locator(`tr[aria-rowindex="${index + 1}"]`);
  const height = (index: number) => row(index).evaluate(row => row.getBoundingClientRect().height);
  const matchHeight = (index: number, expected: number) => expect.poll(async () => Math.abs(await height(index) - expected)).toBeLessThan(1);
  await expect(row(1).getByText('Default')).toBeVisible();
  await matchHeight(1, 20);
  await matchHeight(2, 8);
  await expect(row(2).locator('.xlsxv-fixed-clip')).toContainText('Sixth line');
  await expect.poll(() => height(3)).toBeGreaterThan(60);
  await matchHeight(4, 40);
  await expect(row(4).locator('.xlsxv-merged-clip')).toContainText('Sixth line');
  await matchHeight(5, 35);
  await expect(row(6)).toHaveCount(0);
  await matchHeight(7, 20);

  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
  const last = row(1048576).locator('td[aria-colindex="16385"]');
  await expect(last).toHaveText('71');
  await expect(last).toBeInViewport();
  await matchHeight(1048576, 44.33);
  await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(100);

  await page.getByRole('button', { name: 'Compact', exact: true }).click();
  await matchHeight(1, 4);
  await expect.poll(() => height(2)).toBeGreaterThan(60);
  await expect.poll(() => grid.locator('tbody tr[aria-rowindex]').count()).toBeGreaterThan(100);
  await expect(row(110)).toBeInViewport();
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; });
  await expect(row(2000).locator('td')).toHaveText('2');
  await expect(row(2000)).toBeInViewport();
  await matchHeight(2000, 4);

  await page.getByRole('button', { name: 'Expressions', exact: true }).click();
  await expect(grid.locator('.xlsxv-col-header[aria-colindex="2"]')).toHaveAttribute('style', /width: 196px/);
  await expect(grid.locator('.xlsxv-col-header[aria-colindex="3"]')).toHaveAttribute('style', /width: 224px/);
  const cell = (index: number, column: number) => row(index).locator(`td[aria-colindex="${column + 1}"]`);
  await expect(cell(1, 1)).toHaveText('7');
  await expect(cell(1, 2)).toHaveText('=A1*2');
  await expect(cell(1, 2).locator('.xlsxv-data-bar-hidden-value')).toHaveCount(0);
  await expect(cell(1, 3)).toHaveText('=A1*3');
  await expect(cell(2, 3)).toHaveText('=A2*3');
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
  await expect(cell(1048576, 16384)).toHaveText('=IF(A1,A1+1,0)');
  await expect(cell(1048576, 16384)).toBeInViewport();
  expect(errors).toEqual([]);
});

test('bounds long wrapped XLSX rows and keeps the final row reachable', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2024-01-01T12:00:00Z'));
  await page.setViewportSize({ width: 1040, height: 940 });
  await page.goto('./?view=preview');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({ name: 'long-wrap.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createRowHeightWorkbook({ tall: true, fractional: true })) });
  const grid = page.locator('.xlsxv-grid');
  const row = (index: number) => grid.locator(`tbody tr[aria-rowindex="${index + 1}"]`);
  const cell = (index: number, column: number) => row(index).locator(`td[aria-colindex="${column + 1}"]`);
  const height = (index: number) => row(index).evaluate(row => parseFloat(getComputedStyle(row).height));
  await expect(cell(3, 1)).toContainText('Line 200');
  await expect.poll(() => height(2)).toBeCloseTo(8, 0);
  for (const index of [3, 10, 11]) {
    await expect.poll(() => height(index)).toBeGreaterThan(540);
    await expect.poll(() => height(index)).toBeLessThan(547);
  }
  await expect(cell(10, 1).locator('.xlsxv-merged-content')).toContainText('Line 200');
  await expect(cell(11, 1).locator('.xlsxv-center-across-content')).toContainText('Line 200');
  const clipped = await cell(3, 1).locator('.xlsxv-auto-row-clip').evaluate(element => ({
    height: element.clientHeight, content: element.scrollHeight, overflow: getComputedStyle(element).overflowY
  }));
  expect(clipped.overflow).toBe('hidden');
  expect(clipped.content).toBeGreaterThan(clipped.height);

  await grid.evaluate(element => { element.scrollTop = element.scrollHeight; element.scrollLeft = element.scrollWidth; });
  await expect(cell(1048575, 16384)).toContainText('Line 200');
  await expect.poll(() => height(1048575)).toBeGreaterThan(540);
  await expect.poll(() => height(1048575)).toBeLessThan(547);
  await expect(cell(1048576, 16384)).toHaveText('71');
  await expect(cell(1048576, 16384)).toBeInViewport();
  await page.clock.setFixedTime(new Date('2024-01-02T12:00:00Z'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(cell(1048575, 16384)).toHaveText('short');
  await expect.poll(() => height(1048575)).toBeLessThan(30);
  await expect(cell(1048576, 16384)).toBeInViewport();

  await page.getByRole('button', { name: 'Compact', exact: true }).click();
  await page.clock.setFixedTime(new Date('2024-01-01T12:00:00Z'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(cell(2, 1)).toContainText('Line 200');
  await expect.poll(() => height(2)).toBeLessThan(547);
  await page.clock.setFixedTime(new Date('2024-01-02T12:00:00Z'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(cell(2, 1)).toHaveText('short');
  await expect.poll(() => height(2)).toBeLessThan(30);
});
