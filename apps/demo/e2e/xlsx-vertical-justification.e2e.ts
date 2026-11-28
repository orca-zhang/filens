import { expect, test, type Locator } from '@playwright/test';
import { createVerticalJustificationWorkbook } from '../../../packages/xlsx/test/fixtures/vertical-justification-workbook.mjs';

function bounds(locator: Locator, word: string) {
  return locator.evaluate((element, word) => {
    const tree = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = tree.nextNode(); node; node = tree.nextNode()) {
      const offset = node.textContent!.indexOf(word);
      if (offset < 0) continue;
      const range = document.createRange();
      range.setStart(node, offset);
      range.setEnd(node, offset + word.length);
      const text = range.getBoundingClientRect(), box = element.getBoundingClientRect();
      return { x: text.x, y: text.y, top: text.top - box.top, bottom: box.bottom - text.bottom, height: box.height };
    }
    throw new Error(`Missing word ${word}`);
  }, word);
}

test('distributes browser-laid-out lines through fixed, automatic and clipped merged rows', async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 1000 });
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({ name: 'vertical-justification.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(await createVerticalJustificationWorkbook()) });
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, col: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${col + 1}"]`);
  await expect(cell(1, 1)).toHaveText('First Second Third');
  expect((await bounds(cell(1, 1), 'First')).top).toBeLessThan(7);
  expect((await bounds(cell(1, 1), 'Second')).top).toBeGreaterThan(44);
  expect((await bounds(cell(1, 1), 'Third')).bottom).toBeLessThan(7);
  const solo = await bounds(cell(1, 2), 'Solo');
  expect(Math.abs(solo.top - solo.bottom)).toBeLessThan(3);
  expect((await bounds(cell(1, 3), 'Start')).top).toBeLessThan(7);
  await expect(cell(1, 4).getByText('Color run')).toHaveCSS('color', 'rgb(185, 28, 28)');
  expect((await bounds(cell(1, 4), 'Color')).bottom).toBeLessThan(8);

  expect((await bounds(cell(2, 1), 'upsilon')).top).toBeGreaterThan(40);
  expect((await bounds(cell(3, 2), 'Lower')).bottom).toBeLessThan(7);
  expect((await bounds(cell(4, 1), 'First')).height).toBeCloseTo(16, 0);
  expect((await bounds(cell(5, 1), 'Third')).bottom).toBeLessThan(8);
  expect((await bounds(cell(6, 1), 'Third')).top).toBeGreaterThan(25);

  const across = grid.locator('tr[aria-rowindex="6"] .xlsxv-center-across');
  const acrossBefore = await bounds(across, 'Third');
  await grid.evaluate((element, x) => { element.scrollLeft = x - element.getBoundingClientRect().left - 200; }, acrossBefore.x);
  await expect(cell(5, 1)).toHaveCount(0);
  const acrossAfter = await bounds(across, 'Third');
  expect(Math.abs(acrossAfter.bottom - acrossBefore.bottom)).toBeLessThan(1.1);
  expect(acrossAfter.x).toBeGreaterThan(200);
  expect(acrossAfter.x).toBeLessThan(800);
  await grid.evaluate(element => { element.scrollLeft = 0; });
  await expect(cell(5, 1)).toHaveText('First Second Third');

  const merged = grid.locator('[data-merge-ref="A20"]');
  const frame = merged.locator('.xlsxv-vertical-frame');
  const before = await bounds(frame, 'Middle');
  expect(before.top).toBeGreaterThan(1850);
  expect(Math.abs(before.top - before.bottom)).toBeLessThan(4);
  await grid.evaluate((element, point) => {
    const origin = element.getBoundingClientRect();
    const viewport = element.clientHeight - element.querySelector('thead')!.getBoundingClientRect().height;
    const scrollScale = Math.max(1, (1048576 * 20 - viewport) / (element.scrollHeight - element.clientHeight));
    element.scrollLeft = point.x - origin.left - 200;
    element.scrollTop = (point.y - origin.top - 200) / scrollScale;
  }, before);
  await expect(merged).not.toHaveAttribute('aria-colindex', '2');
  await expect(merged.locator('..')).not.toHaveAttribute('aria-rowindex', '21');
  const clipped = await bounds(frame, 'Middle');
  expect(clipped.top).toBeCloseTo(before.top, 0);
  expect(clipped.height).toBeCloseTo(before.height, 0);
  expect(clipped.x).toBeGreaterThan(200);
  expect(clipped.y).toBeGreaterThan(200);
  expect(clipped.y).toBeLessThan(750);

  await grid.evaluate(element => { element.scrollLeft = element.scrollWidth; element.scrollTop = element.scrollHeight; });
  const last = cell(1048576, 16384);
  await expect(last).toHaveText('TOP TAIL');
  await expect(last).toBeInViewport();
  expect((await bounds(last, 'TAIL')).bottom).toBeLessThan(7);
});
