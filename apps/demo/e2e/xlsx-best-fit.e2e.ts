import { expect, test } from '@playwright/test';
import { createBestFitWorkbook } from '../../../packages/xlsx/test/fixtures/best-fit-workbook.mjs';

test.use({ timezoneId: 'UTC' });

for (const rtl of [false, true]) test(`grows XLSX best-fit numeric columns on demand (RTL=${rtl})`, async ({ page }) => {
  await page.clock.setFixedTime(new Date('2024-01-01T12:00:00Z'));
  await page.setViewportSize({ width: 1200, height: 760 });
  await page.goto('./?view=preview');
  const payload = {
    name: 'best-fit.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createBestFitWorkbook(rtl))
  };
  const picker = page.getByLabel('导入文件', { exact: true });
  await picker.setInputFiles(payload);
  const grid = page.locator('.xlsxv-grid');
  const header = (column: number) => grid.locator(`.xlsxv-col-header[aria-colindex="${column + 1}"]`);
  const cell = (row: number, column: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
  const width = (column: number) => header(column).evaluate(el => Number.parseFloat(el.style.width));
  const tick = async (day: number) => {
    await page.clock.setFixedTime(new Date(`2024-01-0${day}T12:00:00Z`));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  };
  await expect(cell(1, 1)).toContainText('€');
  await expect.poll(() => width(1)).toBeGreaterThan(130);
  const fits = await cell(1, 1).evaluate(el => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const style = getComputedStyle(el);
    return range.getBoundingClientRect().width + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) <= el.clientWidth + 1;
  });
  expect(fits).toBe(true);
  const initial = await width(3);
  expect(initial).toBeLessThan(90);
  expect(await width(2)).toBe(42);
  expect(await width(4)).toBe(42);
  expect(await width(5)).toBe(42);
  expect(await width(7)).toBe(42);
  await expect(cell(2, 9).locator('.xlsxv-data-bar-hidden-value')).toBeAttached();
  expect(await width(9)).toBe(42);
  const wrapHeight = () => cell(2, 3).evaluate(el => el.getBoundingClientRect().height);
  await expect.poll(wrapHeight).toBeGreaterThan(100);
  const wrapped = await wrapHeight();
  await tick(2);
  await expect(cell(1, 3)).toHaveText('€9,876,543,210,123.50');
  await expect.poll(() => width(3)).toBeGreaterThan(130);
  await expect.poll(wrapHeight).toBeLessThan(wrapped / 2);
  const grown = await width(3);
  await tick(3);
  await expect(cell(1, 3)).toHaveText('€2.00');
  expect(await width(3)).toBe(grown);

  const offsets = await grid.locator('.xlsxv-col-header').evaluateAll(headings => headings.slice(0, 10)
    .reduce((sum, heading) => sum + Number.parseFloat((heading as HTMLElement).style.width), 0));
  await grid.evaluate((el, { rtl, left }) => {
    el.scrollLeft = (rtl ? -1 : 1) * left;
  }, { rtl, left: offsets + 14 * 98 + 12 });
  await expect(header(23)).toBeAttached();
  const reading = () => grid.evaluate((el, rtl) => {
    const bounds = el.getBoundingClientRect();
    const pinned = el.querySelector('.xlsxv-col-header.xlsxv-frozen-column')?.getBoundingClientRect().width ?? 0;
    const x = rtl ? bounds.right - 48 - pinned - 2 : bounds.left + 48 + pinned + 2;
    const heading = [...el.querySelectorAll('.xlsxv-col-header:not(.xlsxv-frozen-column)')].find(header => {
      const box = header.getBoundingClientRect();
      return box.left <= x && x < box.right;
    })!;
    const box = heading.getBoundingClientRect();
    return { column: heading.getAttribute('aria-colindex'), inset: rtl ? box.right - x : x - box.left };
  }, rtl);
  const position = await reading();
  await grid.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(cell(1048576, 23)).toHaveText('€9,876,543,210,123.50');
  await expect.poll(() => width(23)).toBeGreaterThan(130);
  const moved = await reading();
  expect(moved.column).toBe(position.column);
  expect(Math.abs(moved.inset - position.inset)).toBeLessThan(1.1);
  await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(100);

  await grid.evaluate((el, rtl) => { el.scrollLeft = (rtl ? -1 : 1) * el.scrollWidth; }, rtl);
  await expect(cell(1048576, 16384)).toHaveText('9876543210123.5');
  await expect(cell(1048576, 16384)).toBeInViewport();
  await expect.poll(() => width(16384)).toBeGreaterThan(100);
  await expect.poll(() => grid.evaluate(el => el.scrollWidth - el.clientWidth - Math.abs(el.scrollLeft))).toBeLessThan(1.1);

  await page.getByRole('button', { name: 'Formula View', exact: true }).click();
  await expect(cell(1, 2)).toHaveText('=A1*2');
  expect(await width(1)).toBe(84);
  await page.getByRole('button', { name: 'Best Fit', exact: true }).click();
  await expect(cell(1, 3)).toHaveText('€2.00');
  expect(await width(3)).toBe(grown);
  await picker.setInputFiles({ ...payload, name: 'best-fit-reopened.xlsx' });
  await expect(cell(1, 3)).toHaveText('€2.00');
  await expect.poll(() => width(3)).toBeCloseTo(initial, 0);
});
