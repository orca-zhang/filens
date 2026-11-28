import { expect, test, type Locator } from '@playwright/test';
import { createHorizontalJustificationWorkbook } from '../../../packages/xlsx/test/fixtures/horizontal-justification-workbook.mjs';

function textEdges(locator: Locator, word: string) {
  return locator.evaluate((element, word) => {
    const tree = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = tree.nextNode(); node; node = tree.nextNode()) {
      const offset = node.textContent!.indexOf(word);
      if (offset < 0) continue;
      const range = document.createRange();
      range.setStart(node, offset);
      range.setEnd(node, offset + word.length);
      const text = range.getBoundingClientRect(), box = element.getBoundingClientRect();
      return { left: text.left - box.left, right: box.right - text.right, top: text.top - box.top,
        width: box.width, x: text.x, y: text.y, wordWidth: text.width };
    }
    throw new Error(`Missing word ${word}`);
  }, word);
}

test('wraps justified text and distributes saved cell alignment through clipped merges', async ({ page }) => {
  await page.setViewportSize({ width: 1330, height: 940 });
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({ name: 'horizontal-justification.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createHorizontalJustificationWorkbook()) });
  const grid = page.locator('.xlsxv-grid');
  const row = (r: number) => grid.locator(`tr[aria-rowindex="${r + 1}"]`);
  const cell = (r: number, c: number) => row(r).locator(`td[aria-colindex="${c + 1}"]`);
  await expect(cell(1, 1)).toHaveText('Alpha beta');
  expect((await textEdges(cell(1, 1), 'beta')).right).toBeLessThan(11);
  expect((await textEdges(cell(1, 2), 'beta')).right).toBeGreaterThan(35);
  expect((await textEdges(cell(1, 4), 'beta')).right).toBeLessThan(11);

  await expect(cell(1, 3).getByText('CD', { exact: true })).toHaveCSS('color', 'rgb(185, 28, 28)');
  const left = (await textEdges(cell(1, 3), 'AB')).left, right = (await textEdges(cell(1, 3), 'CD')).right;
  expect(left).toBeGreaterThan(24);
  expect(Math.abs(left - right)).toBeLessThan(2);
  const fixed = cell(3, 3).locator('.xlsxv-fixed-clip');
  await expect(fixed).toBeVisible();
  const padding = (target: Locator) => target.evaluate(element => [element.style.paddingLeft, element.style.paddingRight]);
  expect(await padding(fixed)).toEqual(await padding(cell(1, 3)));

  await expect.poll(() => row(2).evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(50);
  expect((await textEdges(cell(2, 1), 'upsilon')).top).toBeGreaterThan(40);
  expect((await textEdges(cell(2, 2), 'four')).right).toBeLessThan(11);
  const centered = await textEdges(cell(3, 1), '42');
  expect(Math.abs(centered.left - centered.right)).toBeLessThan(2);
  for (const word of ['Solo', 'Term']) {
    const edge = await textEdges(cell(4, 1), word);
    expect(Math.abs(edge.left - edge.right)).toBeLessThan(2);
  }

  const merge = grid.locator('[data-merge-ref="A10"]');
  const content = merge.locator('.xlsxv-merged-content');
  const initial = await textEdges(content, 'beta');
  expect(initial.width).toBeGreaterThan(4500);
  expect(initial.right).toBeLessThan(1.5);
  await grid.evaluate((element, right) => { element.scrollLeft = right - element.getBoundingClientRect().left - 225; }, initial.x);
  await expect(merge).not.toHaveAttribute('aria-colindex', '2');
  await expect.poll(async () => (await textEdges(content, 'beta')).x).toBeLessThan(800);
  const clipped = await textEdges(content, 'beta');
  expect(clipped.width).toBeCloseTo(initial.width, 1);
  expect(clipped.right).toBeCloseTo(initial.right, 1);
  expect(clipped.x).toBeGreaterThan(200);

  await grid.evaluate(element => { element.scrollLeft = element.scrollWidth; element.scrollTop = element.scrollHeight; });
  const tail = cell(1048576, 16384);
  await expect(tail).toHaveText('Omega end');
  await expect(tail).toBeInViewport();
  expect((await textEdges(tail, 'end')).right).toBeLessThan(11);
});
