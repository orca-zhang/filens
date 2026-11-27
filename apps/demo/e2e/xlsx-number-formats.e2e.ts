import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { createAccountingWorkbook } from '../../../packages/xlsx/test/fixtures/accounting-workbook.mjs';
import { createDbNumberWorkbook } from '../../../packages/xlsx/test/fixtures/db-number-workbook.mjs';
import { createExtendedLocaleWorkbook } from '../../../packages/xlsx/test/fixtures/extended-locale-workbook.mjs';
import { createNumberFormatWorkbook } from '../../../packages/xlsx/test/fixtures/number-format-workbook.mjs';
import { createSystemDateFormatWorkbook } from '../../../packages/xlsx/test/fixtures/system-date-format-workbook.mjs';

test('fits accounting symbols, repeated glyphs and reserved spacing to source widths', async ({ page }) => {
  await page.setViewportSize({ width: 1060, height: 780 });
  await page.goto('./?view=preview&lang=en');
  await page.getByLabel('Import files', { exact: true }).setInputFiles({ name: 'accounting.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(await createAccountingWorkbook()) });
  const grid = page.locator('.xlsxv-grid');
  const at = (row: number, col: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${col + 1}"]`);
  const slot = (row: number, col: number) => at(row, col).locator('.xlsxv-number-fill');
  const width = (row: number, col: number) => slot(row, col).evaluate(element => element.getBoundingClientRect().width);
  await expect(at(1, 1)).toHaveText('$1,234.50');
  await expect(at(2, 1)).toHaveText('$(1,234.50)');
  await expect(at(3, 1)).toHaveText('$-');
  expect(await width(1, 2) - await width(1, 1)).toBeCloseTo(84, 0);
  expect(await width(1, 1)).toBeGreaterThan(10);
  const amountRight = (row: number) => at(row, 1).evaluate(cell => {
    const node = Array.from(cell.querySelector('.xlsxv-number-layout')!.childNodes).find(item => item.textContent?.includes('1,234.50'))!;
    const range = cell.ownerDocument.createRange();
    range.selectNodeContents(node);
    range.setEnd(node, node.textContent!.indexOf('1,234.50') + '1,234.50'.length);
    return range.getBoundingClientRect().right;
  });
  expect(Math.abs(await amountRight(1) - await amountRight(2))).toBeLessThan(1);
  await expect(at(3, 1).locator('.xlsxv-number-pad')).toHaveCount(4);
  expect(await at(3, 1).locator('.xlsxv-number-pad').nth(1).evaluate(element => element.clientWidth)).toBeGreaterThan(6);
  await expect(at(4, 1)).toHaveText('Note');
  await expect(at(4, 1).locator('.xlsxv-number-fill')).toHaveCount(0);

  await expect(at(1, 3)).toHaveText('€12.30');
  await expect(at(1, 3)).toHaveCSS('color', 'rgb(255, 0, 0)');
  const glyphs = await slot(1, 3).evaluate(span => {
    const paint = getComputedStyle(span, '::after');
    return { image: paint.backgroundImage, count: parseFloat(paint.width) / parseFloat(paint.backgroundSize) };
  });
  expect(glyphs.image).toMatch(/^url\("data:image\/png;base64,/);
  expect(glyphs.count).toBeGreaterThan(3);
  expect(glyphs.count).toBeCloseTo(Math.round(glyphs.count), 2);
  await expect(at(1, 4)).toHaveText('ID Label');
  await expect(at(1, 4).getByText('Label', { exact: true })).toHaveCSS('color', 'rgb(0, 51, 153)');
  await expect(at(1, 5).locator('.xlsxv-number-layout > .xlsxv-conditional-icon')).toHaveCount(1);
  expect(await width(1, 5)).toBeLessThan(await width(1, 1));

  const merge = grid.locator('[data-merge-ref="A5"]');
  const fill = merge.locator('.xlsxv-number-fill');
  const mergedWidth = await fill.evaluate(span => span.getBoundingClientRect().width);
  expect(mergedWidth).toBeGreaterThan(6000);
  await expect(merge).toHaveAttribute('aria-colindex', '2');
  await grid.evaluate(element => { element.scrollLeft = 3200; });
  await expect(merge).not.toHaveAttribute('aria-colindex', '2');
  expect(await fill.evaluate(span => span.getBoundingClientRect().width)).toBeCloseTo(mergedWidth, 0);
  await expect(merge).toHaveText('12.30');
  await grid.evaluate(element => { element.scrollTop = element.scrollHeight; element.scrollLeft = element.scrollWidth; });
  const last = at(1048576, 16384);
  await expect(last).toHaveText('$2,469.00');
  await expect(last).toBeInViewport();
  expect(await width(1048576, 16384)).toBeGreaterThan(10);
  await page.getByRole('button', { name: 'Formulas', exact: true }).click();
  await expect(at(1, 1)).toHaveText('=2+3');
  await expect(slot(1, 1)).toHaveCount(0);
});

test('aligns decimal, fraction and scientific placeholders with the displayed digits', async ({ page }) => {
  await page.setViewportSize({ width: 1060, height: 780 });
  await page.goto('./?view=preview&lang=en');
  await page.getByLabel('Import files', { exact: true }).setInputFiles({ name: 'digit-placeholders.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(await createAccountingWorkbook()) });
  const grid = page.locator('.xlsxv-grid');
  const at = (row: number, col: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${col + 1}"]`);
  const position = (row: number, column: number, symbol: string) => at(row, column).evaluate((cell, character) => {
    const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const offset = node.textContent?.indexOf(character) ?? -1;
      if (offset < 0) continue;
      const range = document.createRange();
      range.setStart(node, offset);
      range.setEnd(node, offset + 1);
      return range.getBoundingClientRect().left - cell.getBoundingClientRect().left;
    }
    throw new Error(`Missing formatted character ${character}`);
  }, symbol);

  await expect(at(7, 1)).toHaveText('8.9');
  await expect(at(8, 1)).toHaveText('88.99');
  await expect(at(7, 1)).toHaveCSS('text-align', 'right');
  await expect(at(7, 3)).toHaveCSS('text-align', 'center');
  expect(Math.abs(await position(7, 1, '.') - await position(8, 1, '.'))).toBeLessThan(1);
  await expect(at(7, 2)).toHaveText('5 1/4');
  await expect(at(8, 2)).toHaveText('5 3/10');
  expect(Math.abs(await position(7, 2, '/') - await position(8, 2, '/'))).toBeLessThan(1);
  await expect(at(9, 2)).toHaveText('5');
  await expect(at(9, 2).locator('.xlsxv-number-pad')).toHaveCount(7);

  await expect(at(12, 1)).toHaveText('1.2 E+ 3');
  await expect(at(12, 1).locator('.xlsxv-number-pad')).toHaveCount(2);
  await expect(at(13, 1)).toHaveText('1.23E+10');
  expect(Math.abs(await position(12, 1, '.') - await position(13, 1, '.'))).toBeLessThan(1);
  expect(Math.abs(await position(12, 1, 'E') - await position(13, 1, 'E'))).toBeLessThan(1);
  await expect(at(12, 2)).toHaveText('100.00E+ 0');
  await expect(at(13, 2)).toHaveText('1.00E- 3');
  await expect(at(12, 3)).toHaveText('(1.2 e- 3)');
  await expect(at(12, 3)).toHaveCSS('color', 'rgb(0, 0, 255)');
  await expect(at(12, 4)).toHaveText('3.14E+ 0');
  await expect(at(12, 4).locator('.xlsxv-number-pad')).toHaveCount(1);
  await expect(at(12, 4)).toHaveCSS('color', 'rgb(0, 255, 0)');
  expect(await at(13, 3).textContent()).toBe('1.2 E+ 3');

  const merge = grid.locator('[data-merge-ref="A10"]');
  await expect(merge).toHaveText('5 1/4');
  await expect(merge.locator('.xlsxv-number-pad')).toHaveCount(4);
  await grid.evaluate(element => { element.scrollLeft = 3200; });
  await expect(merge).not.toHaveAttribute('aria-colindex', '2');
  await expect(merge.locator('.xlsxv-number-pad')).toHaveCount(4);
  const scientificMerge = grid.locator('[data-merge-ref="A14"]');
  await expect(scientificMerge).toHaveText('1.2 E+ 3');
  await expect(scientificMerge).not.toHaveAttribute('aria-colindex', '2');
  await expect(scientificMerge.locator('.xlsxv-number-pad')).toHaveCount(2);
  await grid.evaluate(element => { element.scrollTop = element.scrollHeight; element.scrollLeft = element.scrollWidth; });
  const far = at(1048576, 16383);
  await expect(far).toHaveText('88.9');
  await expect(far.locator('.xlsxv-number-pad')).toHaveCount(1);
  await expect(far).toBeInViewport();
  await expect(at(1048576, 16382)).toHaveText('1.2 E+ 4');
  await expect(at(1048576, 16382).locator('.xlsxv-number-pad')).toHaveCount(2);
  await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
});

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
  await expect(cell(1, 5)).toHaveCSS('color', 'rgb(255, 0, 0)');
  await expect(cell(1, 7)).toHaveText('ID 00123');
  await expect(cell(1, 9)).toHaveText('');
  await expect(cell(2, 2)).toHaveText('37.6%');
  await expect(cell(2, 2)).toHaveCSS('color', 'rgb(0, 255, 0)');
  await expect(cell(2, 8)).toHaveText('5.00');
  await expect(cell(2, 9)).toHaveText('jeudi 29 février 2024');
  await expect(cell(2, 10)).toHaveText('2024年3月 金曜日 午後 2:30');
  await expect(cell(2, 10)).toHaveCSS('color', 'rgb(255, 0, 255)');
  await expect(cell(2, 11)).toHaveCSS('color', 'rgb(21, 122, 110)');
  await expect(cell(2, 13)).toHaveCSS('color', 'rgb(102, 51, 153)');
  await expect(cell(2, 14)).toHaveText('ID Abcd');
  await expect(cell(2, 14).locator('span > span').nth(1)).toHaveCSS('color', 'rgb(0, 255, 255)');

  await grid.evaluate(grid => { grid.scrollTop = 26 * 1000; grid.scrollLeft = grid.scrollWidth / 2; });
  const merge = table.locator('[data-merge-ref="A500"]');
  await expect(merge).toHaveText('(1,234.50)');
  await expect(merge).toHaveCSS('color', 'rgb(255, 0, 0)');
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
  await expect(cell(2, 9)).toHaveText('jeudi 29 février 2024');
  await expect(cell(2, 10)).toHaveText('2024年3月 金曜日 午後 2:30');
  expect(await grid.evaluate(grid => [grid.scrollTop, grid.scrollLeft])).toEqual([0, 0]);
  expect(errors).toEqual([]);
});

test('renders the built-in date format in the existing XLSX data types sample', async ({ page }) => {
  await page.goto('./?view=preview');
  await page.getByLabel('导入文件', { exact: true })
    .setInputFiles(resolve('apps/demo/public/samples/rich-xlsx-data-types.xlsx'));
  await expect(page.locator('.xlsxv-table tr[aria-rowindex="5"] td[aria-colindex="3"]')).toHaveText('5/17/16');
});

test.describe('East Asian XLSX number formats', () => {
  test.use({ locale: 'zh-Hant-TW', viewport: { width: 1340, height: 780 } });

  test('formats values and TEXT across conditional styles and virtual windows', async ({ page }) => {
    await page.goto('./?view=preview&lang=en');
    await page.getByLabel('Import files', { exact: true }).setInputFiles({ name: 'east-asian-numbers.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(await createDbNumberWorkbook()) });
    const grid = page.locator('.xlsxv-grid');
    const at = (row: number, col: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${col + 1}"]`);
    await expect(at(1, 1)).toHaveText('壹佰贰拾');
    await expect(at(1, 2)).toHaveText('壹佰貳拾');
    await expect(at(1, 3)).toHaveText('240');
    await expect(at(1, 4)).toHaveText('二百四十');
    await expect(at(1, 5)).toHaveText('Q2 ０１２.３');
    await expect(at(1, 5).locator('.xlsxv-number-pad')).toHaveCount(2);
    await expect(at(1, 6)).toHaveText('百一');
    await expect(at(1, 6)).toHaveCSS('color', 'rgb(0, 0, 255)');
    await expect(at(1, 7)).toHaveText('120');
    await expect(at(2, 1)).toHaveText('平成十五年十二月十七日');
    await expect(at(2, 2)).toHaveText('０３時０８分');
    await expect(at(2, 3)).toHaveText('貳零貳肆年貳月貳拾玖日');
    await expect(at(2, 4)).toHaveText('平成１５年１２月１７日');
    await expect(at(2, 5)).toHaveText('37973');

    const merge = grid.locator('[data-merge-ref="A5"]');
    await expect(merge).toHaveAttribute('aria-colindex', '2');
    await grid.evaluate(element => { element.scrollLeft = 3200; });
    await expect(merge).not.toHaveAttribute('aria-colindex', '2');
    await expect(merge).toHaveText('일천일십이');
    const dateMerge = grid.locator('[data-merge-ref="A7"]');
    await expect(dateMerge).not.toHaveAttribute('aria-colindex', '2');
    await expect(dateMerge).toHaveText('이영이사년 이월 이십구일');
    await grid.evaluate(element => { element.scrollTop = element.scrollHeight; element.scrollLeft = element.scrollWidth; });
    await expect(at(1048576, 16383)).toHaveText('二〇二四年二月二十九日');
    await expect(at(1048576, 16383)).toHaveCSS('color', 'rgb(0, 0, 255)');
    await expect(at(1048576, 16384)).toHaveText('贰佰肆拾壹');
    await expect(at(1048576, 16384)).toBeInViewport();
    await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
  });
});

test.describe('XLSX extended locale formats', () => {
  test.use({ locale: 'en-GB', viewport: { width: 1340, height: 780 } });

  for (const date1904 of [false, true]) {
    test(`retains alternate calendars and formatCode16 through the final cell (1904: ${date1904})`, async ({ page }) => {
      await page.goto('./?view=preview&lang=en');
      await page.getByLabel('Import files', { exact: true }).setInputFiles({ name: 'extended-locale.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: Buffer.from(await createExtendedLocaleWorkbook(date1904)) });
      const grid = page.locator('.xlsxv-grid');
      const at = (row: number, col: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${col + 1}"]`);
      await expect(at(1, 1)).toHaveText('令和元年5月1日');
      await expect(at(1, 2)).toHaveText('๑๑-๐๒-๒๕๖๓');
      await expect(at(1, 3)).toHaveText('令和元');
      await expect(at(1, 4)).toHaveText('Thursday, 29 February 2024');
      await expect(at(1, 5)).toHaveText('14:30:45');
      await expect(at(1, 5)).toHaveCSS('color', 'rgb(0, 0, 255)');
      await expect(at(1, 6)).toHaveText('42.00');
      await expect(at(2, 1)).toHaveText('平成31年4月30日');
      await expect(at(2, 2)).toHaveText(date1904 ? '42411' : '43873');
      await expect(at(2, 3)).toHaveText('๑๑-๐๒-๒๕๖๓');
      const merge = grid.locator('[data-merge-ref="A5"]');
      await expect(merge).toHaveAttribute('aria-colindex', '2');
      await grid.evaluate(element => { element.scrollLeft = 3200; });
      await expect(merge).not.toHaveAttribute('aria-colindex', '2');
      await expect(merge).toHaveText('令和6年5月28日');
      await grid.evaluate(element => { element.scrollTop = element.scrollHeight; element.scrollLeft = element.scrollWidth; });
      await expect(at(1048576, 16383)).toHaveText('令和元年5月1日');
      await expect(at(1048576, 16384)).toHaveText('๒๙-๐๒-๒๕๖๗');
      await expect(at(1048576, 16384)).toBeInViewport();
    });
  }
});

for (const [locale, leapDay, clock, daylightClock, finalDate] of [
  ['en-US', 'Thursday, February 29, 2024', '2:30:45 PM', '2:30:45 AM', 'Friday, December 31, 9999'],
  ['en-GB', 'Thursday, 29 February 2024', '14:30:45', '02:30:45', 'Friday, 31 December 9999'],
]) {
  test.describe(`system date and time formats in ${locale}`, () => {
    test.use({ locale, timezoneId: 'America/New_York' });

    test('follows the browser locale across calculation and virtual windows', async ({ page }) => {
      await page.goto('./?view=preview&lang=zh');
      await page.getByLabel('导入文件', { exact: true }).setInputFiles({
        name: 'system-formats.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: Buffer.from(await createSystemDateFormatWorkbook()),
      });
      const grid = page.locator('.xlsxv-grid');
      const at = (row: number, col: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${col + 1}"]`);
      await expect(at(1, 2)).toHaveText(clock);
      await expect(at(1, 3)).toHaveText(leapDay);
      await expect(at(1, 4)).toHaveText(daylightClock);
      await expect(at(1, 4)).toHaveCSS('color', 'rgb(0, 0, 255)');
      await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight * 1000 / 1048576; grid.scrollLeft = 4400; });
      const anchor = grid.locator('[data-merge-ref="A5"]');
      await expect(anchor).toHaveText(leapDay);
      await expect(anchor).toBeInViewport();
      await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
      await expect(at(1048576, 16384)).toHaveText(finalDate);
      await expect(at(1048576, 16384)).toBeInViewport();
      await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
    });
  });
}
