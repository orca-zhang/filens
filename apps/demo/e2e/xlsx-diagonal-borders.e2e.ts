import { expect, test, type Locator, type Page } from '@playwright/test';
import { createDiagonalBorderWorkbook } from '../../../packages/xlsx/test/fixtures/styled-workbook.mjs';
import { countNearbyPixels } from './screenshot-pixels';

test.use({ viewport: { width: 1080, height: 840 }, deviceScaleFactor: 1 });

async function expectRedStroke(page: Page, source: Locator, fraction: number) {
  const bounds = (await source.boundingBox())!;
  const x = bounds.x + bounds.width * fraction, y = bounds.y + bounds.height * fraction;
  const redPixels = await countNearbyPixels(page, x, y, [185, 28, 28], 45);
  expect(redPixels).toBeGreaterThan(4);
}

test('draws source diagonal borders on ordinary cells and across clipped merges', async ({ page }) => {
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({ name: 'diagonal-borders.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(await createDiagonalBorderWorkbook()) });
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, column: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
  const source = (target: Locator) => target.locator(':scope > .xlsxv-diagonal-clip > .xlsxv-diagonal-source');
  const angle = (stroke: Locator) => stroke.evaluate(element => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return Math.atan2(matrix.b, matrix.a);
  });
  await expect(cell(1, 1)).toHaveText('Label');
  await expect(cell(1, 1)).toHaveCSS('border-right-width', '1px');
  await expect(source(cell(1, 1)).locator('.is-down')).toHaveCSS('border-top-color', 'rgb(185, 28, 28)');
  await expect(source(cell(1, 2)).locator('.is-up')).toHaveCSS('border-top-style', 'double');
  await expect(cell(1, 2)).toHaveCSS('background-color', 'rgb(255, 247, 222)');
  await expect(source(cell(1, 3)).locator('span')).toHaveCount(2);
  await expect(source(cell(1, 4))).toHaveCount(0);
  await expect(source(cell(1, 5)).locator('.is-down')).toHaveCount(1);
  await expect(source(cell(2, 2)).locator('.is-up')).toHaveCSS('border-top-style', 'dashed');
  await expect(source(cell(2, 2)).locator('.is-down')).toHaveCount(0);
  await expect(source(cell(2, 3))).toHaveCount(0);
  expect(await angle(source(cell(1, 2)).locator('.is-up'))).toBeLessThan(0);
  await expectRedStroke(page, source(cell(1, 1)), .8);

  const merged = grid.locator('[data-merge-ref="A10"]');
  const full = source(merged);
  await expect(merged).toHaveText('Diagonal merge');
  const initial = (await full.boundingBox())!;
  await grid.evaluate((element, { x, y }) => {
    const bounds = element.getBoundingClientRect();
    const header = element.querySelector('thead')!.getBoundingClientRect().height;
    const logicalHeight = 1048576 * 32 + 12;
    const ratio = Math.max(1, (logicalHeight - element.clientHeight + header) / (element.scrollHeight - element.clientHeight));
    element.scrollLeft = x - bounds.left - element.clientWidth / 2;
    element.scrollTop = (y - bounds.top - element.clientHeight / 2) / ratio;
  }, { x: initial.x + .6 * initial.width, y: initial.y + .6 * initial.height });
  await expect(merged).not.toHaveAttribute('aria-colindex', '2');
  await expect.poll(() => full.evaluate(element => element.style.top)).toMatch(/^-/);
  const measured = (await full.boundingBox())!;
  expect(measured.width).toBeCloseTo(initial.width, 0);
  expect(measured.height).toBeCloseTo(initial.height, 0);
  expect(await angle(full.locator('.is-down'))).toBeCloseTo(Math.atan2(measured.height, measured.width), 4);
  await expectRedStroke(page, full, .6);

  await grid.evaluate(element => { element.scrollTop = element.scrollHeight; element.scrollLeft = element.scrollWidth; });
  await expect(cell(1048576, 16384)).toHaveText('42');
  await expect(source(cell(1048576, 16384)).locator('.is-up')).toHaveCSS('border-top-color', 'rgb(79, 129, 189)');
  await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
});
