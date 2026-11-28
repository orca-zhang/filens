import { expect, test, type Locator } from '@playwright/test';
import { createReadingOrderWorkbook } from '../../../packages/xlsx/test/fixtures/reading-order-workbook.mjs';

async function runBox(target: Locator, run: string) {
  return target.evaluate((element, value) => {
    const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const start = node.textContent!.indexOf(value);
      if (start === -1) continue;
      const range = element.ownerDocument.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + value.length);
      const { left, right, top, bottom } = range.getBoundingClientRect();
      return { left, right, top, bottom };
    }
    throw new Error(`Missing text run ${value}`);
  }, run);
}

test('keeps XLSX reading order and physical alignment through clipped and windowed text', async ({ page }) => {
  await page.setViewportSize({ width: 1160, height: 860 });
  await page.goto('./?view=preview&lang=en');
  await page.getByLabel('Import files', { exact: true }).setInputFiles({ name: 'reading-order.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createReadingOrderWorkbook()) });
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, column: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
  const a1 = cell(1, 1), c1 = cell(1, 3);
  for (const target of [a1, cell(1, 2)]) {
    await expect(target).toHaveCSS('direction', 'rtl');
    expect((await runBox(target, 'English text')).right).toBeLessThan((await runBox(target, 'نص عربي')).left);
  }
  await expect(c1).toHaveCSS('direction', 'ltr');
  expect((await runBox(c1, 'نص عربي')).right).toBeLessThan((await runBox(c1, 'English text')).left);
  const right = (await c1.boundingBox())!;
  expect(right.x + right.width - (await runBox(c1, 'English text')).right).toBeLessThan(10);
  const d1 = cell(1, 4);
  const latin = await runBox(d1, 'Latin');
  const punctuation = await runBox(d1, '!');
  expect(punctuation.right).toBeLessThan(latin.left);
  expect(punctuation.left - (await d1.boundingBox())!.x).toBeLessThan(10);
  await expect(d1).toHaveCSS('text-align', 'left');

  for (const target of [cell(2, 1), cell(2, 2)]) await expect(target).toHaveCSS('direction', 'ltr');
  for (const target of [cell(2, 3), cell(2, 4)]) await expect(target).toHaveCSS('direction', 'rtl');
  const rich = cell(3, 1), prefixed = cell(3, 2), formula = cell(3, 3);
  await expect(rich.getByText('Latin!', { exact: true })).toHaveCSS('font-weight', '700');
  expect((await runBox(rich, 'Latin')).right).toBeLessThan((await runBox(rich, 'שלום')).left);
  await expect(prefixed).toHaveText('Prefix שלום / Latin!');
  await expect(prefixed).toHaveCSS('direction', 'ltr');
  await expect(formula).toHaveText('שלום / Latin!');
  expect((await runBox(formula, 'Latin')).right).toBeLessThan((await runBox(formula, 'שלום')).left);
  const fixed = cell(3, 4).locator('.xlsxv-fixed-clip');
  await expect(fixed).toHaveCSS('text-align', 'right');
  const clip = (await fixed.boundingBox())!;
  expect(clip.x + clip.width - (await runBox(fixed, 'Latin')).right).toBeLessThan(10);

  const shrink = cell(4, 1).locator('.xlsxv-shrink-text > span');
  const patterns = cell(4, 2).locator('.xlsxv-fill-pattern');
  const rotated = cell(4, 4).locator('.xlsxv-rotated-value');
  const across = cell(5, 1).locator('.xlsxv-center-across-content');
  const overflow = cell(5, 4).locator('.xlsxv-overflow-value');
  for (const target of [shrink, patterns.first(), rotated, across, overflow]) await expect(target).toHaveCSS('direction', 'rtl');
  expect((await patterns.first().boundingBox())!.x).toBeLessThan((await patterns.nth(1).boundingBox())!.x);
  expect((await overflow.boundingBox())!.x).toBeLessThan((await cell(5, 4).boundingBox())!.x);

  for (const column of [1, 2]) {
    const lines = cell(6, column).locator('.xlsxv-vertical-lines');
    const frame = cell(6, column).locator('.xlsxv-vertical-frame');
    const a = await runBox(lines, 'Latin'), b = await runBox(lines, 'שלום');
    expect((a.top > b.top)).toBe(column === 1);
    const tail = await runBox(lines, 'TAIL'), box = (await frame.boundingBox())!;
    expect(Math.abs((tail.top + tail.bottom) / 2 - box.y - box.height / 2)).toBeLessThan(3);
  }

  const merge = grid.locator('[data-merge-ref="A7"]');
  const source = (await runBox(merge, 'Latin')).left;
  await grid.evaluate((element, x) => { element.scrollLeft = x - element.getBoundingClientRect().left - 350; }, source);
  await expect(merge).not.toHaveAttribute('aria-colindex', '2');
  const scroll = await grid.evaluate(el => el.scrollLeft);
  expect(Math.abs((await runBox(merge, 'Latin')).left + scroll - source)).toBeLessThan(2);
  await grid.evaluate(el => { el.scrollLeft = el.scrollWidth; el.scrollTop = el.scrollHeight; });
  const final = cell(1048576, 16384);
  await expect(final).toBeInViewport();
  await expect(final).toHaveText('שלום / Latin!');
  expect((await runBox(final, 'Latin')).right).toBeLessThan((await runBox(final, 'שלום')).left);
});
