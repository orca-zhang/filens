import { expect, test } from '@playwright/test';
import { createCenterAcrossWorkbook } from '../../../packages/xlsx/test/fixtures/center-across-workbook.mjs';

test('centers XLSX text over styled blanks while retaining cells and clipping virtual windows', async ({ page }) => {
  await page.setViewportSize({ width: 1220, height: 860 });
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({
    name: 'center-across.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createCenterAcrossWorkbook())
  });
  const grid = page.locator('.xlsxv-grid');
  const row = (r: number) => grid.locator(`tr[aria-rowindex="${r + 1}"]`);
  const cell = (r: number, c: number) => row(r).locator(`td[aria-colindex="${c + 1}"]`);
  const span = (r: number, c = 1) => cell(r, c).locator('.xlsxv-center-across-content');
  const width = (r: number, c: number) => cell(r, c).evaluate(el => el.getBoundingClientRect().width);
  const extent = (r: number) => span(r).evaluate(el => el.getBoundingClientRect().width);
  await expect(span(1)).toHaveText('Styled heading');
  await expect(span(1).getByText('heading')).toHaveCSS('color', 'rgb(153, 17, 85)');
  await expect(cell(1, 2)).toHaveCSS('background-color', 'rgb(209, 250, 229)');
  await expect(cell(1, 2)).toHaveText('');
  await expect(cell(1, 3)).toHaveCount(0);
  await expect(cell(1, 1)).not.toHaveAttribute('colspan', /.+/);
  const combined = await width(1, 1) + await width(1, 2) + await width(1, 4);
  expect(Math.abs(await extent(1) - combined)).toBeLessThan(1);
  await expect(span(1, 6)).toHaveText('Second');
  await expect(span(2)).toHaveText('Formula stop');
  expect(Math.abs(await extent(2) - await width(2, 1) - await width(2, 2))).toBeLessThan(1);
  await expect(span(3)).toHaveText('Merge stop');
  await expect(span(3).locator('..')).toHaveCSS('align-content', 'end');
  expect(Math.abs(await extent(3) - combined)).toBeLessThan(1);
  await expect(row(3).locator('[data-merge-ref="E3"]')).toHaveAttribute('colspan', '2');
  await expect(span(4)).toHaveCSS('white-space', 'pre-wrap');
  expect(await row(4).evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThan(30);
  await expect(span(5).locator('..')).toHaveCSS('align-content', 'end');
  expect(Math.abs(await row(5).evaluate(el => el.getBoundingClientRect().height) - 24)).toBeLessThan(1);
  await expect(span(6)).toHaveText('12,340.00');
  await expect(cell(6, 4)).toHaveText('3');
  expect(Math.abs(await extent(6) - await width(6, 1) - await width(6, 2))).toBeLessThan(1);
  await expect(span(8)).toHaveCount(0);

  const wide = row(7).locator('.xlsxv-center-across-content');
  const center = async () => {
    let center: number | undefined;
    await expect.poll(async () => center = await grid.evaluate(grid => {
      const el = grid.querySelector('tr[aria-rowindex="8"] .xlsxv-center-across-content');
      if (!el) return;
      const range = document.createRange();
      range.selectNodeContents(el);
      const text = range.getBoundingClientRect(), viewport = grid.getBoundingClientRect();
      return text.left + text.width / 2 - viewport.left;
    })).toBeDefined();
    return center!;
  };
  await expect(wide).toHaveText('Wide centered range');
  const sourceCenter = await center();
  expect(sourceCenter).toBeGreaterThan(2500);
  await grid.evaluate((el, x) => { el.scrollLeft = x - el.clientWidth / 2; }, sourceCenter);
  await expect(row(7).locator('.xlsxv-column-spacer .xlsxv-center-across-content')).toHaveText('Wide centered range');
  await expect(cell(7, 1)).toHaveCount(0);
  const scroll = await grid.evaluate(el => el.scrollLeft);
  expect(Math.abs(await center() + scroll - sourceCenter)).toBeLessThan(2);
  expect(await row(7).locator('.xlsxv-cell').count()).toBeLessThan(35);

  await grid.evaluate(el => { el.scrollLeft = el.scrollWidth; el.scrollTop = el.scrollHeight; });
  await expect(span(1048576, 16383)).toHaveText('Tail');
  await expect(cell(1048576, 16384)).toHaveCSS('background-color', 'rgb(209, 250, 229)');
  await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
});
