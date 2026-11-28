import { expect, test, type Locator, type Page } from '@playwright/test';
import { createLogicalBordersWorkbook } from '../../../packages/xlsx/test/fixtures/logical-borders-workbook.mjs';

async function verifyBorders(page: Page) {
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, column: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
  const red = 'rgb(204, 34, 34)', blue = 'rgb(34, 68, 204)', green = 'rgb(34, 136, 68)';
  const edges = async (target: Locator, direction: string, left: string, right: string) => {
    await expect(target).toHaveCSS('direction', direction);
    await expect(target).toHaveCSS('border-left-color', left);
    await expect(target).toHaveCSS('border-right-color', right);
  };
  const transparent = 'rgba(0, 0, 0, 0)';
  await expect(grid).toHaveCSS('direction', 'rtl');
  await edges(cell(1, 1), 'rtl', blue, red);
  await edges(cell(1, 2), 'ltr', red, blue);
  await edges(cell(1, 3), 'rtl', blue, red);
  await edges(cell(1, 4), 'rtl', red, blue);
  await edges(cell(2, 1), 'rtl', transparent, green);
  await edges(cell(2, 2), 'ltr', green, 'rgb(153, 34, 170)');
  await expect(cell(2, 3)).toHaveText('Prefix שלום / Latin');
  await edges(cell(2, 3), 'ltr', red, blue);
  await edges(cell(2, 4), 'rtl', blue, transparent);

  const merge = grid.locator('[data-merge-ref="A4"]');
  await expect(merge).toHaveCSS('direction', 'rtl');
  await expect(merge).toHaveCSS('border-left-width', '0px');
  const segments = merge.locator('.xlsxv-merge-border-segment[style*="border-right:"]');
  await expect(segments).toHaveCount(2);
  await expect(segments.first()).toHaveCSS('border-right-color', red);
  await expect(segments.last()).toHaveCSS('border-right-color', green);
  const cleared = grid.locator('[data-merge-ref="A7"]');
  await expect(cleared).toHaveCSS('border-right-color', transparent);
  await expect(cleared.locator('.xlsxv-merge-border-segment')).toHaveCount(0);

  await grid.evaluate(el => { el.scrollLeft = -el.scrollWidth; });
  await expect(merge).not.toHaveAttribute('aria-colindex', '2');
  await expect(merge).toHaveCSS('direction', 'rtl');
  await expect(merge).toHaveCSS('border-right-width', '0px');
  await expect(merge).toHaveCSS('border-left-color', blue);
}

test('places Strict XLSX logical borders by displayed cell direction and keeps clipped merge edges', async ({ page }) => {
  await page.setViewportSize({ width: 1160, height: 860 });
  await page.goto('./?view=preview&lang=en');
  await page.getByLabel('Import files', { exact: true }).setInputFiles({ name: 'logical-borders.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createLogicalBordersWorkbook()) });
  await verifyBorders(page);
});
