import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import JSZip from 'jszip';
import { createClockFormulaWorkbook } from '../../../packages/xlsx/test/fixtures/clock-formula-workbook.mjs';
import { createDefinedNameWorkbook } from '../../../packages/xlsx/test/fixtures/defined-name-workbook.mjs';
import { createDateFormulaWorkbook } from '../../../packages/xlsx/test/fixtures/date-formula-workbook.mjs';
import { createFormulaWorkbook } from '../../../packages/xlsx/test/fixtures/formula-workbook.mjs';
import { createLookupFormulaWorkbook } from '../../../packages/xlsx/test/fixtures/lookup-formula-workbook.mjs';
import { createLocaleDateWorkbook } from '../../../packages/xlsx/test/fixtures/locale-date-workbook.mjs';
import { createNumericTextWorkbook } from '../../../packages/xlsx/test/fixtures/numeric-text-workbook.mjs';
import { createSharedFormulaWorkbook } from '../../../packages/xlsx/test/fixtures/shared-formula-workbook.mjs';
import { createStructuredReferenceWorkbook } from '../../../packages/xlsx/test/fixtures/structured-reference-workbook.mjs';
import { createSumProductWorkbook } from '../../../packages/xlsx/test/fixtures/sum-product-workbook.mjs';
import { createTextFormulaWorkbook } from '../../../packages/xlsx/test/fixtures/text-formula-workbook.mjs';

const mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

test('renders uncached SUMPRODUCT over sparse cross-sheet ranges through the final cell', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 730 });
  await page.goto('./?view=preview');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({
    name: 'sum-product.xlsx', mimeType, buffer: Buffer.from(await createSumProductWorkbook())
  });
  const grid = page.locator('.xlsxv-grid');
  const at = (row: number, col: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${col + 1}"]`);
  for (const [index, value] of ['60', '10', '13', '#VALUE!', '#N/A', '777', '#REF!'].entries()) {
    await expect(at(1, index + 1)).toHaveText(value);
  }
  await grid.evaluate(element => { element.scrollTop = element.scrollHeight; element.scrollLeft = element.scrollWidth; });
  const last = at(1048576, 16384);
  await expect(last).toHaveText(String(16_380 * 1_048_576 - 1));
  await expect(last).toBeInViewport();
  await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
});

test('evaluates Excel table references and saved filters through the final cell', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 730 });
  await page.goto('./?view=preview&lang=zh');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({
    name: 'structured-references.xlsx', mimeType, buffer: Buffer.from(await createStructuredReferenceWorkbook())
  });
  const grid = page.locator('.xlsxv-grid');
  const at = (row: number, col: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${col + 1}"]`);
  for (const [column, value] of ['44', '32', '5', 'Qty', '32', '29', '3', '2', '32'].entries()) {
    await expect(at(1, column + 1)).toHaveText(value);
  }
  await expect(at(2, 1)).toHaveText('North|Quiet|West|Last');
  await expect(at(2, 6)).toHaveText('=[@Qty]*[@Price]');
  await expect(at(2, 9)).toHaveText('999');
  await grid.evaluate(element => { element.scrollTop = element.scrollHeight; element.scrollLeft = element.scrollWidth; });
  await expect(at(1048576, 16384)).toHaveText('76');
  await expect(at(1048576, 16384)).toBeInViewport();
  await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
  await page.getByRole('button', { name: "Team's Ledger", exact: true }).click();
  await expect(at(3, 7)).toHaveText('10');
  await expect(at(5, 7)).toHaveText('8');
  await expect(grid.locator('tr[aria-rowindex="5"]')).toHaveCount(0);
  await grid.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(at(1048575, 7)).toHaveText('14');
  await expect(at(1048576, 7)).toHaveText('32');
});

test('renders formatted labels and sparse joins through the last Excel cell', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 730 });
  await page.goto('./?view=preview&lang=zh');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({
    name: 'text-formulas.xlsx', mimeType, buffer: Buffer.from(await createTextFormulaWorkbook(true))
  });
  const grid = page.locator('.xlsxv-grid');
  const at = (row: number, col: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${col + 1}"]`);
  const firstRow = ['February 29, 2024', 'North · South · Far', 'R1C1|||R2C2', '=D3+1', '$1,234.57', '0'];
  for (const [column, value] of firstRow.entries()) await expect(at(1, column + 1)).toHaveText(value);
  await expect.poll(() => at(2, 1).textContent()).toBe('sku 04\n00321');
  await expect(at(2, 1)).toHaveCSS('white-space', 'pre-wrap');
  await expect(at(2, 2)).toHaveText('A|B|C|TRUE|0');
  await expect(at(2, 3)).toHaveText('#VALUE!');
  await expect.poll(() => at(2, 5).textContent()).toBe('4  17/50 ');
  await expect(at(2, 7)).toHaveText('a/b:c/d');
  await expect(at(3, 1)).toHaveText('alpha');
  await expect(at(3, 2)).toHaveText('Aurora');
  await expect(at(3, 3)).toHaveText('saved');
  await expect(at(4, 2)).toHaveText('missing');
  await expect(at(5, 2)).toHaveText('#DIV/0!');
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
  const last = at(1048576, 16384);
  await expect(last).toHaveText('North | South | Far | 12.50% | Deep');
  await expect(last).toBeInViewport();
  await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
});

for (const [locale, expected] of [['en-US', '2024-01-02'], ['en-GB', '2024-02-01']]) {
  test.describe(`regional date formulas in ${locale}`, () => {
    test.use({ locale, timezoneId: 'UTC' });

    test('uses the browser date order for uncached cross-sheet formulas', async ({ page }) => {
      await page.clock.setFixedTime(new Date('2024-12-31T23:59:55Z'));
      await page.setViewportSize({ width: 1280, height: 730 });
      await page.goto('./?view=preview&lang=zh');
      await page.getByLabel('导入文件', { exact: true }).setInputFiles({
        name: 'regional-dates.xlsx', mimeType, buffer: Buffer.from(await createLocaleDateWorkbook())
      });
      const grid = page.locator('.xlsxv-grid');
      const at = (row: number, col: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${col + 1}"]`);
      const firstRow = [expected, '16:30:00', '29', '2024-03-04', '2024-02-29 16:30:00', '2024-01-01'];
      for (const [column, value] of firstRow.entries()) await expect(at(1, column + 1)).toHaveText(value);
      await expect(at(2, 1)).toHaveText('2024-02-29');
      await expect(at(2, 2)).toHaveText('1');
      await page.clock.setFixedTime(new Date('2025-01-01T00:00:06Z'));
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await expect(at(2, 1)).toHaveText('#VALUE!');
      await expect(at(2, 2)).toHaveText('0');
      await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
      await expect(at(1048576, 16384)).toHaveText(expected);
      await expect(at(1048576, 16384)).toBeInViewport();
      await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
    });
  });
}

for (const [locale, numberValue, value] of [['en-US', '125', '1234'], ['de-DE', '1.25', '1.234']]) {
  test.describe(`numeric text formulas in ${locale}`, () => {
    test.use({ locale, timezoneId: 'UTC' });

    test('parses numeric text and formats uncached results through the final Excel cell', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 730 });
      await page.goto('./?view=preview&lang=zh');
      const grid = page.locator('.xlsxv-grid');
      const at = (row: number, col: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${col + 1}"]`);
      const green = 'rgb(220, 252, 231)';
      for (const date1904 of [false, true]) {
        await page.getByLabel('导入文件', { exact: true }).setInputFiles({
          name: `numeric-text-${date1904 ? 1904 : 1900}.xlsx`, mimeType,
          buffer: Buffer.from(await createNumericTextWorkbook(date1904))
        });
        const firstRow = ['2500.27', numberValue, value, '2024-02-29 12:00', '71', '#VALUE!', '0.0009'];
        for (const [index, text] of firstRow.entries()) await expect(at(1, index + 1)).toHaveText(text);
        await expect(at(2, 1)).toHaveText(date1904 ? '43889.5' : '45351.5');
        await expect(at(2, 2)).toHaveText('2500.27');
        await expect(at(3, 2)).toHaveText('3000');
        await expect(at(4, 2)).toHaveText('#N/A');
        await expect(at(2, 2)).toHaveCSS('background-color', green);
        await expect(at(3, 2)).toHaveCSS('background-color', green);
        await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
        const last = at(1048576, 16384);
        await expect(last).toHaveText('6500.29');
        await expect(last).toHaveCSS('background-color', green);
        await expect(last).toBeInViewport();
        await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
      }
    });
  });
}

test.describe('workbook clock rollover', () => {
  test.use({ timezoneId: 'America/New_York' });

  for (const date1904 of [false, true]) {
    test(`refreshes clock formulas and styles at local midnight (1904=${date1904})`, async ({ page }) => {
      await page.clock.install({ time: new Date('2024-01-02T04:59:38Z') });
      await page.setViewportSize({ width: 1290, height: 730 });
      await page.goto('./?view=preview');
      await page.getByLabel('导入文件', { exact: true }).setInputFiles({
        name: 'clock.xlsx', mimeType, buffer: Buffer.from(await createClockFormulaWorkbook(date1904))
      });
      const grid = page.locator('.xlsxv-grid');
      const at = (row: number, col: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${col + 1}"]`);
      const green = 'rgb(0, 128, 0)';
      await expect(at(1, 1)).toHaveText('2024-01-01');
      const initialTime = await at(1, 2).textContent();
      expect(initialTime).toMatch(/^2024-01-01 23:59:/);
      await expect(at(1, 5)).toHaveText('#DIV/0!');
      await expect(at(2, 1)).toHaveCSS('color', green);
      await expect(at(2, 2)).not.toHaveCSS('color', green);
      await expect(at(2, 4)).toHaveCSS('color', green);
      await expect(at(2, 5)).toHaveCSS('background-color', 'rgb(128, 128, 128)');
      await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
      await expect(at(1048576, 16383)).toHaveText('2024-01-01');
      await expect(at(1048576, 16384)).toHaveText(initialTime!);
      await page.clock.fastForward(30_000);
      await expect(at(1048576, 16383)).toHaveText('2024-01-02');
      await expect(at(1048576, 16384)).toHaveText(/^2024-01-02 00:00:/);
      await expect(at(1048576, 16384)).toBeInViewport();
      await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(100);

      await grid.evaluate(grid => { grid.scrollTop = grid.scrollLeft = 0; });
      await expect(at(1, 1)).toHaveText('2024-01-02');
      await expect(at(1, 3)).toHaveText('2024-01-03');
      await expect(at(1, 4)).toHaveText('2023-12-31');
      await expect(at(1, 5)).toHaveText('42');
      await expect(at(1, 6)).toHaveText('2023-12-31 06:00:00');
      await expect(at(2, 1)).not.toHaveCSS('color', green);
      await expect(at(2, 2)).toHaveCSS('color', green);
      await expect(at(2, 3)).toHaveCSS('color', green);
      await expect(at(2, 4)).not.toHaveCSS('color', green);
      await expect(at(2, 5)).toHaveCSS('background-color', 'rgb(0, 0, 0)');

      await page.clock.setSystemTime(new Date('2024-01-02T15:05:00Z'));
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await expect(at(1, 2)).toHaveText(/^2024-01-02 10:05:/);
      await page.clock.setSystemTime(new Date('2024-01-02T16:28:00Z'));
      await page.getByRole('button', { name: 'Clock Source', exact: true }).click();
      await page.getByRole('button', { name: 'Calendar', exact: true }).click();
      await expect(at(1, 2)).toHaveText(/^2024-01-02 11:28:/);
    });
  }

  test('uses the new day when a clock formula is first reached after midnight', async ({ page }) => {
    await page.clock.install({ time: new Date('2024-01-02T04:59:39Z') });
    await page.goto('./?view=preview');
    await page.getByLabel('导入文件', { exact: true }).setInputFiles({
      name: 'clock-offscreen.xlsx', mimeType, buffer: Buffer.from(await createClockFormulaWorkbook(false, { clockOffscreen: true }))
    });
    const grid = page.locator('.xlsxv-grid');
    await expect(grid.getByText('Static', { exact: true })).toBeVisible();
    await page.clock.fastForward(30_000);
    await expect(grid.getByText('Static', { exact: true })).toBeVisible();
    await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
    await expect(grid.locator('tr[aria-rowindex="1048577"] td[aria-colindex="16385"]')).toHaveText('2024-01-02');
  });
});

test('calculates dates and workdays in both workbook epochs through the final cells', async ({ page }) => {
  await page.goto('./?view=preview');
  await page.setViewportSize({ width: 1250, height: 730 });
  const grid = page.locator('.xlsxv-grid');
  const at = (row: number, col: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${col + 1}"]`);
  for (const date1904 of [false, true]) {
    await page.getByLabel('导入文件', { exact: true }).setInputFiles({
      name: date1904 ? 'calendar-1904.xlsx' : 'calendar-1900.xlsx', mimeType,
      buffer: Buffer.from(await createDateFormulaWorkbook(date1904))
    });
    const expected = ['2024-02-29', '2024-03-31', '4', '2024-02-29', '02:02:01', 'invalid'];
    for (const [index, value] of expected.entries()) await expect(at(1, index + 1)).toHaveText(value);
    await expect(at(1, 1)).toHaveCSS('color', 'rgb(0, 128, 0)');
    await expect(at(2, 1)).toHaveText(date1904 ? '0' : '1462');
    await expect(at(2, 2)).toHaveText(date1904 ? '6' : '7');
    const workingDays = ['3', '2024-03-05', '2024-02-29', '2', '2024-03-01', 'invalid weekend'];
    for (const [index, value] of workingDays.entries()) await expect(at(3, index + 1)).toHaveText(value);
    await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
    await expect(at(1048576, 16383)).toHaveText('2024-03-05');
    await expect(at(1048576, 16384)).toHaveText('2025-02-28 23:59:59');
    await expect(at(1048576, 16384)).toBeInViewport();
    await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
  }
});

test('evaluates uncached lookup formulas across named ranges and the final cell', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1330, height: 760 });
  await page.goto('./?view=preview');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({
    name: 'lookup.xlsx', mimeType, buffer: Buffer.from(await createLookupFormulaWorkbook())
  });
  const grid = page.locator('.xlsxv-grid');
  const at = (row: number, col: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${col + 1}"]`);
  for (const [index, value] of ['Pallet A', '20', '3', 'TRUE', '55', 'Tier B', '#N/A', 'none'].entries()) {
    await expect(at(1, index + 1)).toHaveText(value);
  }
  for (const [index, value] of ['#DIV/0!', '1048576', 'Tier B', 'Tier C', 'Middle', '777'].entries()) {
    await expect(at(2, index + 1)).toHaveText(value);
  }
  for (const [index, value] of ['TRUE', '=Rates!A1*2', '2', '75', '18', '=Rates!A1*2', '18'].entries()) {
    await expect(at(3, index + 1)).toHaveText(value);
  }
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
  await expect(at(1048576, 16384)).toHaveText('20.00');
  await expect(at(1048576, 16384)).toHaveCSS('color', 'rgb(0, 102, 68)');
  await expect(at(1048576, 16384)).toHaveCSS('font-weight', '700');
  await expect(at(1048576, 16384)).toBeInViewport();
  await page.getByRole('button', { name: "Team's Stock", exact: true }).click();
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; });
  await expect(at(1048576, 2)).toHaveText('20');
  expect(errors).toEqual([]);
});

test('evaluates uncached cross-sheet formulas through Excel’s final cell', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./?view=preview');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({
    name: 'cross-sheet-formulas.xlsx', mimeType, buffer: Buffer.from(await createFormulaWorkbook())
  });
  const grid = page.locator('.xlsxv-grid'), table = grid.locator('table');
  const at = (row: number, col: number) => table.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${col + 1}"]`);
  await expect(at(1, 1)).toHaveText('10');
  await expect(at(1, 2)).toHaveText('15');
  await expect(at(1, 3)).toHaveText('7.5');
  await expect(at(1, 4)).toHaveText('total: 15');
  await expect(at(1, 5)).toHaveText('safe');
  await expect(at(2, 1)).toHaveText('=Input!B1');
  await expect(at(2, 3)).toHaveText('#N/A');
  await expect(at(2, 5)).toHaveText('5');
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
  await expect(at(1048576, 16384)).toHaveText('225.25');
  await expect(at(1048576, 16384)).toBeInViewport();
  await expect(table.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
  expect(await table.locator('.xlsxv-cell').count()).toBeLessThanOrEqual(2200);

  await page.getByRole('button', { name: 'Input', exact: true }).click();
  await expect(at(1, 1)).toHaveText('10');
  await expect(at(1, 2)).toHaveText('=Summary!A2');
  expect(await grid.evaluate(grid => [grid.scrollTop, grid.scrollLeft])).toEqual([0, 0]);
  await page.getByRole('button', { name: 'Summary', exact: true }).click();
  await expect(at(1, 4)).toHaveText('total: 15');
  expect(errors).toEqual([]);
});

test('calculates CONCAT in the shipped formula sample after removing its cached values', async ({ page }) => {
  const zip = await JSZip.loadAsync(await readFile('apps/demo/public/samples/rich-xlsx-formulas.xlsx'));
  const path = 'xl/worksheets/sheet1.xml';
  const xml = await zip.file(path)!.async('string');
  const cached = /(<f>_xlfn\.CONCAT[^<]*<\/f>)<v>someone@example\.com<\/v>/g;
  expect([...xml.matchAll(cached)]).toHaveLength(2);
  zip.file(path, xml.replace(cached, '$1'));
  await page.goto('./?view=preview');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({
    name: 'uncached-formulas.xlsx', mimeType, buffer: await zip.generateAsync({ type: 'nodebuffer' })
  });
  await expect(page.locator('.xlsxv-cell[aria-colindex="2"]').filter({ hasText: 'someone@example.com' })).toHaveCount(2);
});

test('calculates shared formula followers in both axes while preserving cached values', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 900, height: 720 });
  await page.goto('./?view=preview');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({
    name: 'shared-formulas.xlsx', mimeType, buffer: Buffer.from(await createSharedFormulaWorkbook())
  });
  const grid = page.locator('.xlsxv-grid'), table = grid.locator('table');
  const at = (row: number, col: number) => table.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${col + 1}"]`);
  await expect(at(2, 4)).toHaveText('57');
  await expect(at(2, 5)).toHaveText('90');
  await expect(at(2, 6)).toHaveText('76');
  await expect(at(3, 4)).toHaveText('99');
  await expect(at(3, 5)).toBeEmpty();
  await expect(at(3, 7)).toHaveText('=UNKNOWN(A3,"A2")');
  await expect(at(3, 10)).toHaveText('42');
  await expect(at(4, 4)).toHaveText('75');

  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
  await expect(at(1048576, 16384)).toHaveText('12.00');
  await expect(at(1048576, 16384)).toBeInViewport();
  await expect(table.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
  expect(await table.locator('.xlsxv-cell').count()).toBeLessThanOrEqual(2200);

  await page.getByRole('button', { name: 'Rates 2026', exact: true }).click();
  await expect(at(2, 3)).toHaveText('14');
  await page.getByRole('button', { name: 'Summary', exact: true }).click();
  await expect(at(4, 4)).toHaveText('75');
  expect(await grid.evaluate(grid => [grid.scrollTop, grid.scrollLeft])).toEqual([0, 0]);
  expect(errors).toEqual([]);
});

test('resolves XLSX defined names in both scopes and through Excel’s final cell', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1100, height: 720 });
  await page.goto('./?view=preview');
  const input = page.getByLabel('导入文件', { exact: true });
  const source = { name: 'defined-names.xlsx', mimeType, buffer: Buffer.from(await createDefinedNameWorkbook()) };
  await input.setInputFiles(source);
  const grid = page.locator('.xlsxv-grid');
  const at = (row: number, col: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${col + 1}"]`);
  await expect(at(1, 2)).toHaveText('5');
  await expect(at(1, 3)).toHaveText('24');
  await expect(at(1, 4)).toHaveText('21');
  await expect(at(1, 7)).toHaveText('99');
  await expect(at(2, 4)).toHaveText('31');
  await expect(at(3, 3)).toHaveText('12');
  await expect(at(3, 6)).toHaveText('21');
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
  await expect(at(1048576, 16384)).toHaveText('67.50');
  await expect(at(1048576, 16384)).toBeInViewport();
  await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
  await page.getByRole('button', { name: "Rates O'Brien", exact: true }).click();
  await expect(at(1, 4)).toHaveText('3');
  await expect(at(1, 5)).toHaveText('2.5');
  await input.setInputFiles(source);
  await expect(page.getByRole('button', { name: 'Summary', exact: true })).toHaveClass(/is-active/);
  await expect(at(1, 3)).toHaveText('24');
  expect(errors).toEqual([]);
});
