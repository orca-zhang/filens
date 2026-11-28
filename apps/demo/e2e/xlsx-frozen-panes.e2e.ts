import { expect, test } from '@playwright/test';
import { createFrozenPanesWorkbook } from '../../../packages/xlsx/test/fixtures/frozen-panes-workbook.mjs';

test('pins saved XLSX rows and columns with bounded windows in LTR and RTL sheets', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 760 });
  await page.goto('./?view=preview&lang=en');
  await page.getByLabel('Import files', { exact: true }).setInputFiles({ name: 'frozen-panes.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(await createFrozenPanesWorkbook()) });
  const grid = page.locator('.xlsxv-grid');
  const header = grid.locator('.xlsxv-col-header');
  const row = (r: number) => grid.locator(`tr[aria-rowindex="${r + 1}"]`);
  const cell = (r: number, c: number) => row(r).locator(`td[aria-colindex="${c + 1}"]`);
  const geometry = (r: number, c: number) => cell(r, c).evaluate(el => {
    const { left, right, top, bottom } = el.getBoundingClientRect();
    const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
    return { left, right, top, bottom, hit: Boolean(hit && el.contains(hit)) };
  });
  const scroll = (end: boolean, rtl: boolean) => grid.evaluate((el, { end, rtl }) => {
    el.scrollTop = end ? el.scrollHeight : 0;
    el.scrollLeft = end ? el.scrollWidth * (rtl ? -1 : 1) : 0;
  }, { end, rtl });

  for (const direction of ['LTR', 'RTL'] as const) {
    await page.getByRole('button', { name: direction, exact: true }).click();
    await expect(cell(1, 1)).toHaveText(`${direction} summary`);
    await expect(cell(1, 30)).toHaveText('Top AD');
    await expect(cell(65, 1)).toHaveText('Side 65');
    await expect(cell(65, 30)).toHaveText('Saved origin');
    await expect(header.nth(1)).toHaveText('C');
    await expect(row(2)).toHaveCount(0);
    await expect.poll(async () => {
      const origin = await geometry(65, 30), pinned = await geometry(3, 3);
      return Math.max(Math.abs(origin.top - pinned.bottom), Math.abs(direction === 'RTL' ? origin.right - pinned.left : origin.left - pinned.right));
    }).toBeLessThan(4);
    const initial = await geometry(1, 1);
    expect(initial.hit).toBe(true);

    await scroll(false, direction === 'RTL');
    const fragments = grid.locator('[data-merge-ref="C3"]');
    await expect(fragments).toHaveCount(4);
    await expect(grid.locator('[data-merge-ref="C3"]:not([aria-hidden])')).toHaveText('Across panes');
    for (const merge of await fragments.all()) await expect(merge).toHaveCSS('background-color', 'rgb(220, 252, 231)');
    await expect(cell(4, 1)).toHaveText('After split');
    await expect(row(6).locator('.xlsxv-column-spacer .xlsxv-center-across-content')).toHaveText('Spans both panes');

    await scroll(true, direction === 'RTL');
    await expect(cell(1048576, 16384)).toHaveText('Final cell');
    await expect(cell(1048576, 1)).toHaveText('Final side');
    await expect.poll(async () => (await geometry(1048576, 16384)).hit).toBe(true);
    await expect.poll(async () => (await geometry(1048576, 1)).hit).toBe(true);
    const final = await geometry(1, 1);
    expect(final.hit).toBe(true);
    expect(Math.abs(final.left - initial.left)).toBeLessThan(2);
    expect(Math.abs(final.top - initial.top)).toBeLessThan(2);
    expect(await grid.locator('tbody tr[aria-rowindex]').count()).toBeLessThan(130);
    expect(await row(1048576).locator('.xlsxv-cell').count()).toBeLessThan(40);
  }

  await grid.evaluate(el => { el.style.maxWidth = '235px'; el.style.maxHeight = '100px'; });
  await expect(grid.locator('.xlsxv-frozen-rows tr')).toHaveCount(1);
  await expect(grid.locator('.xlsxv-col-header.xlsxv-frozen-column')).toHaveText(['A']);
  await scroll(true, true);
  await expect.poll(async () => (await geometry(1048576, 16384)).hit).toBe(true);
});

test('restores the saved scrolling origin without frozen panes', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 760 });
  await page.goto('./?view=preview&lang=en');
  await page.getByLabel('Import files', { exact: true }).setInputFiles({ name: 'saved-origin.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(await createFrozenPanesWorkbook({ frozen: false })) });
  const grid = page.locator('.xlsxv-grid');
  for (const [direction, row] of [['LTR', 65], ['RTL', 1_048_510], ['LTR', 65]] as const) {
    await page.getByRole('button', { name: direction, exact: true }).click();
    const target = grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="31"]`);
    await expect(target).toHaveText('Saved origin');
    await expect(target).toBeInViewport();
    await expect.poll(() => target.evaluate((cell, rtl) => {
      const box = cell.getBoundingClientRect();
      const corner = cell.closest('table')!.querySelector('.xlsxv-corner')!.getBoundingClientRect();
      return Math.max(Math.abs(box.top - corner.bottom), Math.abs(rtl ? box.right - corner.left : box.left - corner.right));
    }, direction === 'RTL')).toBeLessThan(3);
    await expect(grid.locator('.xlsxv-frozen-rows, .xlsxv-frozen-column')).toHaveCount(0);
    expect(await grid.locator('tbody tr[aria-rowindex]').count()).toBeLessThan(130);
  }
});
