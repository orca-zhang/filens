import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { createMergeBorderWorkbook, createStyledWorkbookFixture } from '../../../packages/xlsx/test/fixtures/styled-workbook.mjs';
import { countNearbyPixels } from './screenshot-pixels';

test('paints stored XLSX merge perimeter segments across both virtual axes', async ({ page }) => {
  await page.setViewportSize({ width: 1260, height: 850 });
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({ name: 'merge-borders.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(await createMergeBorderWorkbook()) });
  const grid = page.locator('.xlsxv-grid');
  const merge = (ref: string) => grid.locator(`[data-merge-ref="${ref}"]`);
  const segment = (side: string, color: string) => merge('A5').locator(`.xlsxv-merge-border-segment[style*="border-${side}:"][style*="${color}"]`);
  const column = (name: string) => grid.locator('.xlsxv-col-header').getByText(name, { exact: true });
  const width = async (letter: string) => (await column(letter).boundingBox())!.width;
  const blue = 'rgb(24, 71, 199)', green = 'rgb(18, 126, 34)', red = 'rgb(207, 26, 26)';
  await expect(merge('A1')).toHaveText('Uniform');
  await expect(merge('A1')).toHaveCSS('border-right-color', green);
  await expect(merge('A1')).toHaveCSS('border-bottom-style', 'double');
  await expect(merge('E1')).toHaveCSS('border-right-color', 'rgb(129, 57, 187)');
  await expect(merge('E1')).toHaveCSS('border-bottom-width', '0px');
  const topBlue = segment('top', blue).first();
  await expect(topBlue).toBeVisible();
  const bounds = (await topBlue.boundingBox())!;
  expect(Math.abs(bounds.width - (await width('B') + await width('C')))).toBeLessThan(2);
  await expect.poll(async () => {
    const edge = await topBlue.boundingBox();
    return edge ? countNearbyPixels(page, edge.x + edge.width / 2, edge.y + 1, [24, 71, 199]) : 0;
  }).toBeGreaterThan(10);
  await expect(segment('top', 'rgb(231, 139, 18)')).toHaveCount(0);
  const columnWidth = await width('A');
  const seek = (row: number, left: number) => grid.evaluate((element, { row, left }) => {
    const headerHeight = element.querySelector('thead')!.getBoundingClientRect().height;
    const ratio = Math.max(1, (1048576 * 30 - element.clientHeight + headerHeight) / (element.scrollHeight - element.clientHeight));
    element.scrollTop = (row - 1) * 30 / ratio;
    element.scrollLeft = left;
  }, { row, left });

  await seek(1, columnWidth * 41);
  await expect(merge('A5')).not.toHaveAttribute('aria-colindex', '2');
  await expect(segment('top', blue)).toHaveCount(1);
  await expect(merge('A5')).toHaveCSS('border-left-width', '0px');
  await seek(98, columnWidth * 43);
  await expect(segment('top', blue)).toHaveCount(0);
  await expect(segment('right', red)).toHaveCount(1);
  await expect(segment('right', green)).toHaveCount(2);
  await seek(190, columnWidth * 36);
  await expect(segment('bottom', red)).toHaveCount(1);
  await expect(segment('bottom', blue).first()).toHaveCSS('border-bottom-style', 'double');

  await grid.evaluate(element => { element.scrollTop = element.scrollHeight; element.scrollLeft = element.scrollWidth; });
  await expect(merge('XFB1048575')).toHaveText('Tail');
  await expect(merge('XFB1048575')).toHaveCSS('border-bottom-style', 'double');
  await expect(merge('XFB1048575')).toHaveCSS('border-right-color', green);
  await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
});

test('preserves XLSX source styles, wrapped rows and merged alignment while windowing', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./?view=preview');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({
    name: 'styled.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createStyledWorkbookFixture())
  });
  const grid = page.locator('.xlsxv-grid'), table = grid.locator('table');
  const cell = (row: number, col: number) => table.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${col + 1}"]`);
  const first = cell(1, 1);
  await expect(first).toHaveText(/Six short words/);
  await expect(first).toHaveCSS('font-style', 'italic');
  await expect(first).toHaveCSS('font-size', '16px');
  await expect(first).toHaveCSS('text-align', 'center');
  await expect(first).toHaveCSS('border-top-color', 'rgb(185, 28, 28)');
  await expect(first).toHaveCSS('border-bottom-style', 'double');
  await expect(first).toHaveCSS('color', 'rgb(25, 51, 77)');
  await expect(first).toHaveCSS('white-space', 'pre-wrap');
  await expect(cell(1, 2)).toHaveText('');
  await expect(cell(1, 2)).toHaveCSS('background-color', 'rgb(140, 178, 217)');
  await expect(cell(1, 3)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(cell(1, 4)).toHaveCSS('background-image', /repeating-linear-gradient/);
  await expect(cell(2, 3)).toHaveCSS('background-color', 'rgb(253, 230, 138)');
  await expect(cell(2, 2)).toHaveCSS('background-color', 'rgb(140, 178, 217)');
  await expect.poll(() => first.evaluate(cell => cell.parentElement!.offsetHeight)).toBeGreaterThan(80);
  const firstHeight = await first.evaluate(cell => cell.parentElement!.offsetHeight);

  await grid.evaluate(grid => { grid.scrollTop = 26 * 120 + 250; grid.scrollLeft = 1100; });
  const blankMerge = table.locator('[data-merge-ref="B90"]');
  await expect(blankMerge).toHaveCSS('background-color', 'rgb(253, 230, 138)');
  await expect(blankMerge).toHaveCSS('border-left-width', '0px');
  await expect(blankMerge).toHaveCSS('border-top-width', '0px');

  await grid.evaluate(grid => { grid.scrollTop = 26 * 1080 + 250; grid.scrollLeft = grid.scrollWidth / 2; });
  const merge = table.locator('[data-merge-ref="A500"]');
  const mergedContent = merge.locator('.xlsxv-merged-content');
  await expect(mergedContent).toHaveText('Centered merged text');
  await expect(mergedContent).toHaveCSS('justify-content', 'center');
  await expect(merge).toHaveCSS('background-repeat', 'no-repeat');
  await expect(merge).toHaveCSS('background-position-x', /^-/);
  const centerError = await mergedContent.evaluate(content => {
    const range = document.createRange();
    range.selectNodeContents(content);
    const text = range.getBoundingClientRect(), bounds = content.getBoundingClientRect();
    return Math.abs(text.top + text.height / 2 - bounds.top - bounds.height / 2);
  });
  expect(centerError).toBeLessThan(2);

  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
  await expect(cell(2000, 64)).toHaveText('15');
  await expect(cell(2000, 64)).toHaveCSS('background-color', 'rgb(140, 178, 217)');
  await expect(cell(2000, 64)).toBeInViewport();
  expect(await table.locator('.xlsxv-cell').count()).toBeLessThanOrEqual(2600);

  await grid.evaluate(grid => { grid.scrollTop = grid.scrollLeft = 0; });
  await expect(first).toBeInViewport();
  await expect.poll(() => first.evaluate(cell => cell.parentElement!.offsetHeight)).toBe(firstHeight);
  expect(errors).toEqual([]);
});

test('remeasures wrapped rows after a font change while preserving the reading row', async ({ page }) => {
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/xlsx/src/index.ts')}`, page.url()).href;
  await page.evaluate(async ({ moduleUrl, bytes }) => {
    const measureText = CanvasRenderingContext2D.prototype.measureText;
    const metrics = { digitWidth: 7 };
    CanvasRenderingContext2D.prototype.measureText = function (text: string) {
      return /^\d$/.test(text) && this.font.includes('Arial')
        ? { width: metrics.digitWidth } as TextMetrics : measureText.call(this, text);
    };
    const { createXlsxPreviewDriver } = await import(/* @vite-ignore */ moduleUrl);
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0';
    document.body.replaceChildren(host);
    const session = createXlsxPreviewDriver().createSession(host), source = new Uint8Array(bytes);
    await session.load(source, { descriptor: { source, extension: 'xlsx', name: 'styled.xlsx' } });
    Object.assign(window, { remeasureStyledSheet: () => {
      metrics.digitWidth = 14;
      session.refreshFonts({ references: [...session.getFontReferences()], loaded: [], warnings: [], relayout: true });
    } });
  }, { moduleUrl, bytes: [...await createStyledWorkbookFixture()] });
  const grid = page.locator('.xlsxv-grid'), first = grid.locator('tr[aria-rowindex="2"]');
  let height = 0;
  await expect.poll(async () => height = await first.evaluate(row => row.offsetHeight)).toBeGreaterThan(80);
  await grid.evaluate(grid => {
    const row = grid.querySelector('tr[aria-rowindex="4"]')!;
    grid.scrollTop += row.getBoundingClientRect().top - grid.getBoundingClientRect().top + 4;
  });
  const readingRow = () => grid.evaluate(grid => {
    const top = grid.getBoundingClientRect().top + grid.clientTop;
    return [...grid.querySelectorAll('tbody tr[aria-rowindex]')]
      .find(row => row.getBoundingClientRect().bottom > top)?.getAttribute('aria-rowindex');
  });
  await expect.poll(readingRow).toBe('4');
  await page.evaluate(() => (window as any).remeasureStyledSheet());
  await expect.poll(() => first.evaluate(row => row.offsetHeight)).toBeLessThan(height - 40);
  await expect.poll(readingRow).toBe('4');
});
