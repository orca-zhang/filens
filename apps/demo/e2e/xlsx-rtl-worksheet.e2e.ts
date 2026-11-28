import { expect, test, type Locator } from '@playwright/test';
import { createRtlWorksheet } from '../../../packages/xlsx/test/fixtures/rtl-worksheet.mjs';

async function textBox(target: Locator) {
  return target.evaluate(element => {
    const range = element.ownerDocument.createRange();
    range.selectNodeContents(element);
    const { left, right } = range.getBoundingClientRect();
    return { left, right };
  });
}

test('mirrors saved worksheet columns and keeps source geometry through RTL scroll windows', async ({ page }) => {
  await page.setViewportSize({ width: 1160, height: 860 });
  await page.goto('./?view=preview&lang=en');
  await page.getByLabel('Import files', { exact: true }).setInputFiles({ name: 'rtl-worksheet.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(await createRtlWorksheet()) });
  const grid = page.locator('.xlsxv-grid');
  const row = (index: number) => grid.locator(`tr[aria-rowindex="${index + 1}"]`);
  const cell = (r: number, c: number) => row(r).locator(`td[aria-colindex="${c + 1}"]`);
  const header = grid.locator('.xlsxv-col-header');
  const box = async (target: Locator) => {
    await expect(target).toBeVisible();
    return (await target.boundingBox())!;
  };
  const corner = grid.locator('.xlsxv-corner');
  await expect(grid).toHaveCSS('direction', 'rtl');
  await expect(header.nth(1)).toHaveText('C');
  expect((await box(header.nth(0))).x).toBeGreaterThan((await box(header.nth(1))).x);
  await expect(cell(1, 1)).toHaveCSS('direction', 'rtl');
  await expect(cell(1, 3)).toHaveCSS('direction', 'ltr');
  await expect(cell(1, 3)).toHaveCSS('text-align', 'right');
  await expect(cell(1, 4)).toHaveText('42');
  const cornerStart = await box(corner);

  const centered = await textBox(row(3).locator('.xlsxv-center-across-content'));
  const a3 = await box(cell(3, 1)), d3 = await box(cell(3, 4));
  expect(Math.abs(centered.left + centered.right - d3.x - a3.x - a3.width)).toBeLessThan(4);
  const a8 = await box(cell(8, 1)), e8 = await box(cell(8, 5));
  const overflow = await box(row(8).locator('.xlsxv-text-overflow'));
  expect(Math.abs(overflow.x - e8.x - e8.width)).toBeLessThan(2);
  expect(Math.abs(overflow.x + overflow.width - a8.x - a8.width)).toBeLessThan(2);
  const fills = row(10).locator('.xlsxv-fill-pattern');
  expect(Math.abs((await box(fills.first())).x - (await box(cell(10, 4))).x - 8)).toBeLessThan(2);
  expect((await box(fills.last())).x).toBeGreaterThan((await box(cell(10, 1))).x);
  const rotated = await box(row(11).locator('.xlsxv-rotated-overflow'));
  expect(rotated.x).toBeLessThan((await box(cell(11, 1))).x);

  const merged = grid.locator('[data-merge-ref="A5"]');
  await expect(merged).toHaveCSS('border-right-color', 'rgb(34, 68, 204)');
  const wide = row(4).locator('.xlsxv-center-across-content');
  const mergedText = merged.locator('.xlsxv-merged-content');
  const before = await Promise.all([textBox(wide), textBox(mergedText)]);
  await grid.evaluate((el, point) => { el.scrollLeft = point - el.getBoundingClientRect().right + 370; }, before[0].left);
  await expect(row(4).locator('.xlsxv-column-spacer .xlsxv-center-across-content')).toHaveText('Centered wide');
  await expect(merged).not.toHaveAttribute('aria-colindex', '2');
  await expect(merged).toHaveCSS('border-right-width', '0px');
  const scroll = await grid.evaluate(el => el.scrollLeft);
  const after = await Promise.all([textBox(wide), textBox(mergedText)]);
  for (const [i, position] of after.entries()) expect(Math.abs(position.left + scroll - before[i].left)).toBeLessThan(2);
  expect(Math.abs((await box(corner)).x - cornerStart.x)).toBeLessThan(2);
  const topBorder = merged.locator('.xlsxv-merge-border-segment[style*="rgb(34, 136, 68)"]');
  const borderColumn = grid.locator('.xlsxv-col-header[aria-colindex="51"]');
  expect(Math.abs((await box(topBorder)).x - (await box(borderColumn)).x)).toBeLessThan(2);

  await grid.evaluate(el => { el.scrollLeft = -7100; });
  await expect(cell(9, 81)).toHaveText(/^Start/);
  const label = row(9).locator('.xlsxv-overflow-value');
  const worldX = (await box(label)).x + await grid.evaluate(el => el.scrollLeft);
  await grid.evaluate(el => { el.scrollLeft = -4000; });
  await expect(row(9).locator('.xlsxv-column-spacer .xlsxv-text-overflow')).toContainText('Start');
  expect(Math.abs((await box(label)).x + await grid.evaluate(el => el.scrollLeft) - worldX)).toBeLessThan(2);

  await grid.evaluate(el => { el.scrollLeft = -9000; });
  await expect(merged).toHaveCSS('border-left-color', 'rgb(204, 68, 34)');

  await grid.evaluate(el => { el.scrollLeft = -el.scrollWidth; el.scrollTop = el.scrollHeight; });
  await expect(cell(1048576, 16384)).toHaveText('Final cell');
  await expect(cell(1048576, 16384)).toBeInViewport();
  expect(await grid.locator('tbody tr[aria-rowindex]').count()).toBeLessThan(130);
  expect(await row(1048576).locator('.xlsxv-cell').count()).toBeLessThan(36);
  await page.getByRole('button', { name: 'LTR', exact: true }).click();
  await expect(grid).toHaveCSS('direction', 'ltr');
  expect((await box(header.nth(0))).x).toBeLessThan((await box(header.nth(1))).x);
  await page.getByRole('button', { name: 'RTL', exact: true }).click();
  await expect(grid).toHaveCSS('direction', 'rtl');
  await expect(cell(1, 1)).toBeInViewport();
});
