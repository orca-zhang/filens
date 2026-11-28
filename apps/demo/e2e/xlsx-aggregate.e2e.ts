import { expect, test } from '@playwright/test';
import { createAggregateWorkbook, createFrequencyWorkbook, createLinearRegressionWorkbook, createPercentileWorkbook, createRankingWorkbook, createStatisticalFormulaWorkbook } from '../../../packages/xlsx/test/fixtures/aggregate-workbook.mjs';

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

test('recalculates XLSX standard deviation, variance and median across sparse sheets', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({
    name: 'statistical-formulas.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createStatisticalFormulaWorkbook())
  });
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, column: number) =>
    grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
  for (const [index, expected] of ['27.46391572', '26.05455814', '754.26666667', '678.84', '1320'].entries()) {
    await expect(cell(1, index + 1)).toHaveText(expected);
  }
  await expect.poll(async () => Number(await cell(2, 1).textContent())).toBeCloseTo(7 / 3, 12);
  await expect.poll(async () => Number(await cell(2, 2).textContent())).toBeCloseTo(14 / 9, 12);
  await expect(cell(2, 3)).toHaveText('3');
  await expect(cell(2, 5)).toHaveText('997');
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
  const final = cell(1_048_576, 16_384);
  await expect(final).toHaveText('29.46391572');
  await expect(final).toBeInViewport();
});

test('recalculates paired statistics and spills a forecast through the last XLSX cell', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({
    name: 'linear-regression.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createLinearRegressionWorkbook())
  });
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, column: number) =>
    grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
  for (const [index, expected] of ['2', '2', '18', '1', '9.33333333', '14'].entries()) {
    await expect(cell(1, index + 1)).toHaveText(expected);
  }
  await expect(cell(2, 1)).toHaveText('997');
  await expect(cell(2, 2)).toHaveText('14');
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
  await expect(cell(1_048_576, 16_382)).toHaveText('2');
  await expect(cell(1_048_576, 16_383)).toHaveText('20');
  const final = cell(1_048_576, 16_384);
  await expect(final).toHaveText('102');
  await expect(final).toHaveCSS('background-color', 'rgb(220, 252, 231)');
  await expect(final).toBeInViewport();
  await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
});

test('displays XLSX percentile and quartile results through the final spill cell', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({
    name: 'percentiles.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createPercentileWorkbook())
  });
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, column: number) =>
    grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
  for (const [row, values] of [['1.9', '1.5', '3.25', '1.25'], ['4', '2.5', '#NUM!', '997']].entries()) {
    for (const [column, value] of values.entries()) await expect(cell(row + 1, column + 1)).toHaveText(value);
  }
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
  for (const [index, value] of ['1', '2', '2', '4'].entries()) await expect(cell(1_048_576, 16_381 + index)).toHaveText(value);
  await expect(cell(1_048_576, 16_384)).toBeInViewport();
});

test('displays XLSX tied ranks, interpolated percent ranks and sparse spill errors', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({
    name: 'ranks.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createRankingWorkbook())
  });
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, column: number) =>
    grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
  for (const [row, values] of [['1', '1.5', '1', '0.5'], ['0.666', '0.6', '3', '#N/A', '997'], ['0.99999999']].entries()) {
    for (const [column, value] of values.entries()) await expect(cell(row + 1, column + 1)).toHaveText(value);
  }
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
  const ranks = ['8589934590.5', '#N/A', '17179869182.5', '17179869182.5'];
  for (const [index, rank] of ranks.entries()) await expect(cell(1_048_576, 16_381 + index)).toHaveText(rank);
  await expect(cell(1_048_576, 16_384)).toBeInViewport();
});

test('recalculates XLSX histograms and reads the overflow bin at the final grid cell', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({
    name: 'histogram.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createFrequencyWorkbook())
  });
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, column: number) =>
    grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
  for (const [index, expected] of ['0', '2', '0', '1', '1'].entries()) {
    await expect(cell(index + 1, 1)).toHaveText(expected);
  }
  await expect(cell(2, 2)).toHaveText('17179869176');
  await expect(cell(3, 2)).toHaveText('4');
  await expect(cell(4, 2)).toHaveText('997');
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
  await expect(cell(1_048_575, 16_384)).toHaveText('0');
  const final = cell(1_048_576, 16_384);
  await expect(final).toHaveText('1');
  await expect(final).toBeInViewport();
  await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
});
