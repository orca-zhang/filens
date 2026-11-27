import { expect, test, type Locator } from '@playwright/test';
import { createShrinkTextWorkbook, longLabel, mergedLabel } from '../../../packages/xlsx/test/fixtures/shrink-text-workbook.mjs';

async function expectTextToFit(cell: Locator, value: string) {
  const text = cell.locator('.xlsxv-shrink-text');
  await expect(text).toHaveText(value);
  const { scale, width, available } = await text.evaluate(span => {
    const host = span.closest('.xlsxv-merged-content, .xlsxv-fixed-clip > div, td') as HTMLElement;
    const font = getComputedStyle(host);
    const icon = host.querySelector('.xlsxv-conditional-icon');
    const glyphs = span.firstElementChild!;
    const range = span.ownerDocument.createRange();
    range.selectNodeContents(glyphs);
    return {
      scale: new DOMMatrix(getComputedStyle(glyphs).transform).a,
      width: range.getBoundingClientRect().width,
      available: host.clientWidth - parseFloat(font.paddingLeft) - parseFloat(font.paddingRight)
        - (icon ? icon.getBoundingClientRect().width + parseFloat(getComputedStyle(icon).marginInlineEnd) : 0)
    };
  });
  expect(scale).toBeGreaterThan(0);
  expect(scale).toBeLessThan(1);
  expect(width).toBeLessThanOrEqual(available + 1);
  expect(width).toBeGreaterThan(available - 5);
  return scale;
}

test('shrinks displayed XLSX text within its source cell and merged width', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 780 });
  await page.goto('./?view=preview&lang=en');
  await page.getByLabel('Import files', { exact: true }).setInputFiles({ name: 'shrink-to-fit.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createShrinkTextWorkbook()) });
  const grid = page.locator('.xlsxv-grid');
  const at = (row: number, col: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${col + 1}"]`);
  await expectTextToFit(at(1, 1), longLabel);
  await expect(at(1, 1)).toHaveCSS('padding-left', '8px');
  await expect(at(1, 1)).toHaveCSS('padding-right', '30px');
  await expect(at(1, 1).locator('.xlsxv-shrink-text > span')).toHaveCSS('text-decoration-style', 'double');
  await expectTextToFit(at(1, 2), 'USD 12,345.67');
  await expect(at(1, 3)).toHaveText('Fits');
  await expect(at(1, 3).locator('.xlsxv-shrink-text')).toHaveCount(0);
  await expect(at(1, 4)).toHaveCSS('white-space', 'pre-wrap');
  await expect(at(1, 4).locator('.xlsxv-shrink-text')).toHaveCount(0);
  await expectTextToFit(at(1, 5), 'Before Rich label');
  await expect(at(1, 5).getByText('Rich label')).toHaveCSS('color', 'rgb(153, 51, 102)');
  await expectTextToFit(at(1, 6), 'USD 1,234.56');
  await expect(at(1, 6).locator('.xlsxv-conditional-icon')).toHaveCount(1);
  await expectTextToFit(at(2, 1), longLabel);
  await expect(at(2, 1).locator('.xlsxv-fixed-clip')).toHaveCount(1);
  await expect(at(2, 2).locator('.xlsxv-shrink-text')).toHaveCount(0);
  await expectTextToFit(at(3, 1), longLabel);
  await expect(at(3, 2).locator('.xlsxv-shrink-text')).toHaveCount(0);

  const merge = grid.locator('[data-merge-ref="H4"]');
  await expect(merge).toHaveAttribute('aria-colindex', '9');
  const mergedScale = await expectTextToFit(merge, mergedLabel);
  await grid.evaluate(element => { element.scrollLeft = 900; });
  await expect(merge).not.toHaveAttribute('aria-colindex', '9');
  expect(await expectTextToFit(merge, mergedLabel)).toBe(mergedScale);
  await expect(merge.locator('.xlsxv-merged-content')).toHaveCSS('justify-content', 'center');

  await grid.evaluate(element => { element.scrollTop = element.scrollHeight; element.scrollLeft = element.scrollWidth; });
  const last = at(1048576, 16384);
  await expectTextToFit(last, `${longLabel} at the end`);
  await expect(last).toBeInViewport();
  await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(100);

  await page.getByRole('button', { name: 'Formulas', exact: true }).click();
  await expect(at(1, 1)).toHaveText('="An expression shown in formula view"');
  await expect(at(1, 1).locator('.xlsxv-shrink-text')).toHaveCount(0);
});
