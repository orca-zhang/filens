import { expect, test } from '@playwright/test';
import { createTextOverflowWorkbook } from '../../../packages/xlsx/test/fixtures/text-overflow-workbook.mjs';
import { countNearbyPixels } from './screenshot-pixels';

test('paints XLSX text into blank columns and keeps its source position across windows', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 900 });
  await page.goto('./?view=preview&lang=en');
  await page.getByLabel('Import files', { exact: true }).setInputFiles({ name: 'text-overflow.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createTextOverflowWorkbook()) });
  const grid = page.locator('.xlsxv-grid');
  const row = (index: number) => grid.locator(`tr[aria-rowindex="${index + 1}"]`);
  const cell = (r: number, c: number) => row(r).locator(`td[aria-colindex="${c + 1}"]`);
  const overflow = (r: number) => row(r).locator('.xlsxv-text-overflow');
  const box = async (target: ReturnType<typeof cell>) => {
    await expect(target).toBeVisible();
    return (await target.boundingBox())!;
  };
  await expect(overflow(1)).toHaveText(/^Wide text/);
  await expect(cell(1, 2)).toHaveCount(0);
  const edge = await box(overflow(1));
  expect(Math.abs(edge.x + edge.width - (await box(cell(1, 8))).x)).toBeLessThan(2);
  await expect(cell(1, 1)).toHaveCSS('border-right-color', 'rgba(0, 0, 0, 0)');
  await expect(cell(1, 7)).toHaveCSS('border-right-color', 'rgb(216, 222, 232)');
  const blank = await box(cell(1, 3));
  const ink = await overflow(1).locator('.xlsxv-overflow-value').evaluate((el, { x, width }) => {
    const range = document.createRange(), node = el.firstChild!;
    for (let index = 10; index < node.textContent!.length; index++) {
      range.setStart(node, index);
      range.setEnd(node, index + 1);
      const box = range.getBoundingClientRect();
      if (box.x > x + 6 && box.right < x + width - 6) return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }
  }, blank);
  expect(ink).toBeDefined();
  expect(await countNearbyPixels(page, ink!.x, ink!.y, [190, 24, 93], 38)).toBeGreaterThan(2);

  const leftLimit = await box(cell(2, 10)), rightAnchor = await box(cell(2, 17));
  const rightAligned = await box(overflow(2));
  expect(Math.abs(rightAligned.x - leftLimit.x - leftLimit.width)).toBeLessThan(2);
  expect(Math.abs(rightAligned.x + rightAligned.width - rightAnchor.x - rightAnchor.width)).toBeLessThan(2);
  const center = await box(cell(3, 8)), centered = await box(overflow(3).locator('.xlsxv-overflow-value'));
  expect(Math.abs(centered.x + centered.width / 2 - center.x - center.width / 2)).toBeLessThan(2);
  await expect(overflow(4)).toHaveCount(0);
  const mergeLimit = await box(overflow(5));
  expect(Math.abs(mergeLimit.x + mergeLimit.width - (await box(row(5).locator('[data-merge-ref="D5"]'))).x)).toBeLessThan(2);
  await expect(overflow(6).getByText(/^Wide text/)).toHaveCSS('font-weight', '700');
  await expect(cell(7, 1).locator('.xlsxv-shrink-text')).toHaveCount(1);
  for (const index of [7, 8, 9, 10, 12]) await expect(overflow(index)).toHaveCount(0);
  await expect(overflow(11)).toHaveText(/^Wide text/);

  const position = async (r: number) => {
    let x: number | null = null;
    await expect.poll(async () => {
      x = await grid.evaluate((element, index) => {
        const value = element.querySelector(`tr[aria-rowindex="${index + 1}"] .xlsxv-text-overflow .xlsxv-overflow-value`);
        return value && value.getBoundingClientRect().x - element.getBoundingClientRect().x + element.scrollLeft;
      }, r);
      return x;
    }).not.toBeNull();
    return x!;
  };
  const left = await position(13);
  const right = await position(14);
  await grid.evaluate(el => { el.scrollLeft = 2800; });
  await expect(row(13).locator('.xlsxv-column-spacer .xlsxv-text-overflow')).toHaveCount(1);
  await expect(row(14).locator('.xlsxv-column-spacer .xlsxv-text-overflow')).toHaveCount(1);
  expect(Math.abs(await position(13) - left)).toBeLessThan(2);
  expect(Math.abs(await position(14) - right)).toBeLessThan(2);
  await expect(cell(13, 1)).toHaveCount(0);
  expect(await row(13).locator('.xlsxv-cell').count()).toBeLessThan(32);
  await grid.evaluate(el => { el.scrollLeft = el.scrollWidth; el.scrollTop = el.scrollHeight; });
  await expect(cell(1048576, 16384).locator('.xlsxv-text-overflow')).toHaveText(/^Final/);
  await expect(cell(1048576, 16384)).toBeInViewport();

  await page.getByRole('button', { name: 'Trailing', exact: true }).click();
  await expect(overflow(1)).toHaveText('Text spans saved widths in blank columns');
  await expect(grid.locator('.xlsxv-col-header').nth(1)).toHaveText('C');
  await page.getByRole('button', { name: 'Formulas', exact: true }).click();
  await expect(cell(1, 1)).toHaveText(/^Wide text/);
  await expect(overflow(1)).toHaveCount(0);
});

test('repeats whole displayed values in Fill cells and across styled blanks', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 900 });
  await page.goto('./?view=preview&lang=en');
  await page.getByLabel('Import files', { exact: true }).setInputFiles({ name: 'fill-alignment.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createTextOverflowWorkbook()) });
  await page.getByRole('button', { name: 'Fill', exact: true }).click();
  const grid = page.locator('.xlsxv-grid');
  const row = (r: number) => grid.locator(`tr[aria-rowindex="${r + 1}"]`);
  const cell = (r: number, c: number) => row(r).locator(`td[aria-colindex="${c + 1}"]`);
  const patterns = (r: number) => row(r).locator('.xlsxv-fill-pattern');
  const bounds = async (target: ReturnType<typeof cell>) => {
    await expect(target).toBeVisible();
    return (await target.boundingBox())!;
  };
  await expect(patterns(1).first()).toHaveText('XY');
  await expect(patterns(1).nth(1)).toHaveAttribute('aria-hidden', 'true');
  await expect(cell(1, 1)).toHaveAccessibleName('XY');
  await expect(cell(1, 2)).toHaveCount(0);
  await expect(cell(1, 3)).toHaveText('');
  const neighbor = await bounds(cell(1, 3)), stop = await bounds(cell(1, 4));
  const first = await bounds(patterns(1).first()), last = await bounds(patterns(1).last());
  expect(last.x).toBeGreaterThan(neighbor.x);
  expect(last.x + last.width).toBeLessThan(stop.x - 6);
  expect(last.x + last.width + first.width).toBeGreaterThan(stop.x - 9);
  expect(await countNearbyPixels(page, last.x + last.width / 3, last.y + last.height / 2, [23, 32, 51], 38)).toBeGreaterThan(2);
  await expect(patterns(2).first()).toHaveText('1.20');
  await expect(patterns(2).last()).toHaveText('1.20');
  const numberLast = await bounds(patterns(2).last());
  expect(numberLast.x + numberLast.width).toBeLessThan((await bounds(cell(2, 4))).x - 6);
  await expect(patterns(3).nth(1).getByText('x')).toHaveCSS('color', 'rgb(153, 51, 85)');
  await expect(patterns(4)).toHaveCount(0);
  await expect(patterns(5)).toHaveCount(0);
  const overflow = await bounds(row(6).locator('.xlsxv-text-overflow'));
  expect(Math.abs(overflow.x - (await bounds(cell(6, 4))).x)).toBeLessThan(2);

  const source = await grid.evaluate(grid => grid.querySelector('tr[aria-rowindex="8"] .xlsxv-fill-pattern')!
    .getBoundingClientRect().left - grid.getBoundingClientRect().left);
  await grid.evaluate(el => { el.scrollLeft = 2800; });
  await expect(row(7).locator('.xlsxv-column-spacer .xlsxv-fill-pattern[aria-hidden=true]').first()).toHaveText('XY');
  await expect(row(8).locator('[data-merge-ref="A8"] .xlsxv-fill-pattern[aria-hidden=true]').first()).toHaveText('AB');
  await expect(cell(7, 1)).toHaveCount(0);
  const phase = await grid.evaluate((grid, source) => {
    const copy = grid.querySelector('tr[aria-rowindex="8"] .xlsxv-fill-pattern[aria-hidden=true]')!.getBoundingClientRect();
    return (copy.left - grid.getBoundingClientRect().left + grid.scrollLeft - source) / copy.width;
  }, source);
  expect(Math.abs(phase - Math.round(phase))).toBeLessThan(.1);
  expect(await patterns(7).count()).toBeLessThan(120);
  expect(await patterns(8).count()).toBeLessThan(120);
  await grid.evaluate(el => { el.scrollLeft = el.scrollWidth; el.scrollTop = el.scrollHeight; });
  await expect(patterns(1048576).first()).toHaveText('End');
  await expect(cell(1048576, 16384)).toBeInViewport();
  await page.getByRole('button', { name: 'Formulas', exact: true }).click();
  await expect(cell(1, 5)).toHaveText('="XY"');
  await expect(patterns(1)).toHaveCount(0);
});
