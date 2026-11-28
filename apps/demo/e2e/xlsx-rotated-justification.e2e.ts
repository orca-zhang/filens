import { expect, test, type Locator } from '@playwright/test';
import { createRotatedJustificationWorkbook } from '../../../packages/xlsx/test/fixtures/rotated-workbook.mjs';

function wordBounds(locator: Locator, word: string) {
  return locator.evaluate((element, word) => {
    const tree = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = tree.nextNode(); node; node = tree.nextNode()) {
      const start = node.textContent!.indexOf(word);
      if (start < 0) continue;
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + word.length);
      const glyphs = range.getBoundingClientRect(), box = element.getBoundingClientRect();
      return { x: glyphs.x, y: glyphs.y, top: glyphs.top - box.top, bottom: box.bottom - glyphs.bottom };
    }
    throw new Error(`Missing word ${word}`);
  }, word);
}

test('justifies upright and right-angle text along the source row height', async ({ page }) => {
  await page.setViewportSize({ width: 1330, height: 970 });
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({ name: 'rotated-justification.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(await createRotatedJustificationWorkbook()) });
  const grid = page.locator('.xlsxv-grid');
  const cell = (r: number, c: number) => grid.locator(`tr[aria-rowindex="${r + 1}"] td[aria-colindex="${c + 1}"]`);
  await expect(cell(1, 1)).toHaveText('Alpha beta');
  expect((await wordBounds(cell(1, 1), 'Alpha')).top).toBeLessThan(8);
  expect((await wordBounds(cell(1, 1), 'beta')).bottom).toBeLessThan(8);
  expect((await wordBounds(cell(1, 2), 'Alpha')).bottom).toBeLessThan(8);
  expect((await wordBounds(cell(1, 2), 'beta')).top).toBeLessThan(8);
  await expect(cell(1, 3).locator('.xlsxv-vertical-lines')).toHaveCSS('text-orientation', 'upright');
  expect((await wordBounds(cell(1, 3), 'ABC')).top).toBeLessThan(8);
  expect((await wordBounds(cell(1, 3), 'DEF')).bottom).toBeLessThan(8);
  expect((await wordBounds(cell(1, 4), 'beta')).bottom).toBeGreaterThan(35);

  expect((await cell(2, 1).boundingBox())!.height).toBeGreaterThan(120);
  expect((await wordBounds(cell(2, 1), 'beta')).bottom).toBeLessThan(8);
  expect((await wordBounds(cell(3, 1), 'cccc')).bottom).toBeLessThan(9);
  expect((await wordBounds(cell(3, 1), 'dddd')).top).toBeLessThan(8);
  const wrappedSingle = await wordBounds(cell(3, 2), 'dddd');
  expect(Math.abs(wrappedSingle.top - wrappedSingle.bottom)).toBeLessThan(3);
  const single = await wordBounds(cell(3, 3), 'Solo');
  expect(Math.abs(single.top - single.bottom)).toBeLessThan(3);
  await expect(cell(3, 4).getByText('CD', { exact: true })).toHaveCSS('color', 'rgb(185, 28, 28)');
  expect((await wordBounds(cell(3, 4), 'CD')).bottom).toBeLessThan(9);
  expect((await wordBounds(cell(4, 1), 'End')).bottom).toBeLessThan(9);
  await expect(cell(4, 2)).toHaveText('Alpha beta Solo');
  await expect(cell(4, 2).getByText('So', { exact: true })).toHaveCSS('color', 'rgb(185, 28, 28)');
  await expect(cell(4, 2).getByText('lo', { exact: true })).toHaveCSS('font-style', 'italic');
  const hardBreakStart = await wordBounds(cell(4, 2), 'So'), hardBreakEnd = await wordBounds(cell(4, 2), 'lo');
  expect(Math.abs(hardBreakStart.top - hardBreakEnd.bottom)).toBeLessThan(3);
  await expect(cell(5, 1)).toHaveCSS('text-align', 'right');
  await expect(cell(5, 2)).toHaveCSS('text-align', 'center');

  const merge = grid.locator('[data-merge-ref="A12"]');
  const frame = merge.locator('.xlsxv-vertical-frame');
  const before = await wordBounds(frame, 'Middle');
  expect(before.top).toBeGreaterThan(1700);
  await grid.evaluate((element, point) => {
    const origin = element.getBoundingClientRect();
    const viewport = element.clientHeight - element.querySelector('thead')!.getBoundingClientRect().height;
    const ratio = Math.max(1, (1048576 * 20 - viewport) / (element.scrollHeight - element.clientHeight));
    element.scrollLeft = point.x - origin.left - 200;
    element.scrollTop = (point.y - origin.top - 200) / ratio;
  }, before);
  await expect(merge).not.toHaveAttribute('aria-colindex', '2');
  await expect(merge.locator('..')).not.toHaveAttribute('aria-rowindex', '13');
  const after = await wordBounds(frame, 'Middle');
  expect(Math.abs(after.top - before.top)).toBeLessThan(1.5);
  expect(after.y).toBeGreaterThan(200);
  expect(after.y).toBeLessThan(800);
  await grid.evaluate(element => { element.scrollLeft = element.scrollWidth; element.scrollTop = element.scrollHeight; });
  const tail = cell(1048576, 16384);
  await expect(tail).toHaveText('UP TAIL');
  await expect(tail).toBeInViewport();
  expect((await wordBounds(tail, 'TAIL')).bottom).toBeLessThan(10);
});
