import { expect, test, type Locator, type Page } from '@playwright/test';
import { createPathGradientWorkbook } from '../../../packages/xlsx/test/fixtures/path-gradient-workbook.mjs';
import { countNearbyPixels } from './screenshot-pixels';

test.use({ viewport: { width: 1080, height: 840 }, deviceScaleFactor: 1 });

async function expectColor(page: Page, cell: Locator, x: number, y: number, rgb: [number, number, number]) {
  const box = (await cell.boundingBox())!;
  expect(await countNearbyPixels(page, box.x + x * box.width, box.y + y * box.height, rgb, 28)).toBeGreaterThan(20);
}

test('paints rectangular gradient stops in ordinary cells and clipped conditional merges', async ({ page }) => {
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({ name: 'path-gradient.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(await createPathGradientWorkbook()) });
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, column: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
  const frame = cell(1, 1), corner = cell(1, 2), differential = cell(1, 3);
  await expect(frame).toHaveCSS('background-image', /data:image\/svg\+xml/);
  await expect(differential).toHaveText('42');
  await expectColor(page, frame, .45, .45, [255, 255, 255]);
  for (const [x, y] of [[.1, .5], [.85, .5], [.5, .125], [.5, .875]]) {
    await expectColor(page, frame, x, y, [210, 24, 49]);
  }
  await expectColor(page, frame, .95, .07, [101, 52, 137]);
  await expectColor(page, corner, .08, .1, [7, 129, 81]);
  await expectColor(page, corner, .92, .9, [34, 34, 34]);
  await expectColor(page, differential, .1, .5, [210, 24, 49]);

  const merged = grid.locator('[data-merge-ref="A5"]');
  await expect(merged).toHaveText('42');
  const origin = (await merged.boundingBox())!;
  const width = (await frame.boundingBox())!.width * 52, height = 200 * 32;
  let previousRow = '6';
  for (const [fraction, rgb] of [[.57, [253, 228, 103]], [.84, [2, 175, 137]]] as const) {
    const center = await grid.evaluate((element, { x, y }) => {
      const bounds = element.getBoundingClientRect();
      const header = element.querySelector('thead')!.getBoundingClientRect().height;
      const logicalHeight = 1048576 * 32 + 136;
      const ratio = Math.max(1, (logicalHeight - element.clientHeight + header) / (element.scrollHeight - element.clientHeight));
      const center = { x: bounds.left + element.clientWidth / 2, y: bounds.top + element.clientHeight / 2 };
      element.scrollLeft = x - center.x;
      element.scrollTop = (y - center.y) / ratio;
      return center;
    }, { x: origin.x + width * fraction, y: origin.y + height * fraction });
    await expect(merged).not.toHaveAttribute('aria-colindex', '2');
    await expect(merged.locator('..')).not.toHaveAttribute('aria-rowindex', previousRow);
    previousRow = (await merged.locator('..').getAttribute('aria-rowindex'))!;
    await expect(merged).toHaveCSS('background-size', '100% 100%');
    await expect.poll(() => countNearbyPixels(page, center.x, center.y, [...rgb], 28, true)).toBeGreaterThan(50);
  }

  await grid.evaluate(element => { element.scrollTop = element.scrollHeight; element.scrollLeft = element.scrollWidth; });
  const last = cell(1048576, 16384);
  await expect(last).toHaveText('42');
  await expectColor(page, last, .45, .45, [255, 255, 255]);
});
