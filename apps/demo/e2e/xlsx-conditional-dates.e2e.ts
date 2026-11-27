import { expect, test } from '@playwright/test';
import { createConditionalDateWorkbook } from '../../../packages/xlsx/test/fixtures/conditional-date-workbook.mjs';

test.use({ timezoneId: 'America/New_York' });

test('applies XLSX date periods using the viewer time zone and workbook date system', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2024-01-02T04:30:00Z'));
  await page.setViewportSize({ width: 1150, height: 760 });
  await page.goto('./?view=preview');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({ name: 'calendar.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createConditionalDateWorkbook(true)) });
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, column: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
  const highlighted = 'rgb(220, 252, 231)', plain = 'rgba(0, 0, 0, 0)';
  await expect(cell(8, 1)).toHaveCSS('background-color', highlighted);
  await expect(cell(9, 2)).toHaveCSS('background-color', highlighted);
  await expect(cell(10, 2)).toHaveCSS('background-color', highlighted);
  await expect(cell(11, 2)).toHaveCSS('background-color', plain);
  await expect(cell(11, 3)).toHaveCSS('background-color', highlighted);
  await expect(cell(13, 7)).toHaveCSS('background-color', highlighted);
  await expect(cell(18, 10)).toHaveCSS('background-color', highlighted);
  await expect(cell(19, 10)).toHaveCSS('background-color', plain);
});
