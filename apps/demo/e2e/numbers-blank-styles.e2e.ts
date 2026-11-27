import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { createLargeMergedNumbersArchive } from '../../../packages/iwork/test/fixtures/numbers-archive.mjs';

for (const virtual of [true, false]) {
  test(`renders authored Numbers border runs on merged edges and blank cells with virtual=${virtual}`, async ({ page }) => {
    const [rowCount, columnCount] = virtual ? [100_000, 1024] : [244, 32];
    const bytes = [...await createLargeMergedNumbersArchive({ rowCount, columnCount, customStrokes: true })];
    await page.goto('./');
    const moduleUrl = new URL(`@fs${resolve('packages/iwork/src/index.ts')}`, page.url()).href;
    await page.evaluate(async ({ moduleUrl, bytes, virtual }) => {
      const { createIworkViewer } = await import(/* @vite-ignore */ moduleUrl);
      const host = document.createElement('div'); host.style.cssText = 'position:fixed;inset:0';
      document.body.replaceChildren(host);
      const viewer = createIworkViewer(host, { virtual });
      const source = new Uint8Array(bytes);
      await viewer.preview(source);
      await viewer.preview(source);
    }, { moduleUrl, bytes, virtual });
    const grid = page.locator('.xlsxv-grid');
    const anchor = grid.locator('[data-merge-ref="1:1"]').first();
    const top = anchor.locator('.xlsxv-merge-border-segment[style*="border-top"]');
    await expect(top).toHaveCount(5);
    await expect(top.nth(0)).toHaveCSS('border-top-color', 'rgb(17, 34, 153)');
    await expect(top.nth(1)).toHaveCSS('border-top-color', 'rgb(0, 136, 68)');
    await expect(top.nth(3)).toHaveCSS('border-top-width', '0px');
    await expect(anchor).toHaveCSS('border-left-color', 'rgb(68, 85, 102)');

    if (virtual) {
      await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight / 2; });
      await expect(anchor.locator('.xlsxv-merge-border-segment[style*="border-top"]')).toHaveCount(0);
      await expect(anchor).toHaveCSS('border-left-width', '3px');
    }
    const scroll = () => grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
    await scroll();
    if (!virtual) {
      const rows = grid.locator('tbody tr[aria-rowindex]');
      await expect(rows).toHaveCount(200);
      await scroll();
      await expect(rows).toHaveCount(rowCount);
      await scroll();
    }
    const bottom = anchor.locator('.xlsxv-merge-border-segment[style*="border-bottom"]');
    await expect(bottom).toHaveCount(2);
    await expect(bottom.nth(0)).toHaveCSS('border-bottom-color', 'rgb(170, 34, 51)');
    await expect(bottom.nth(1)).toHaveCSS('border-bottom-color', 'rgb(85, 34, 153)');
    await expect(anchor).toHaveCSS('border-right-color', 'rgb(153, 85, 17)');
    const at = (column: number) => grid.locator(`tr[aria-rowindex="${rowCount + 1}"] td[aria-colindex="${column + 1}"]`);
    await expect(at(columnCount - 1)).toBeEmpty();
    await expect(at(columnCount - 1)).toHaveCSS('border-top-color', 'rgb(170, 34, 51)');
    await expect(at(columnCount)).toHaveText('Last sparse cell');
    await expect(at(columnCount)).toHaveCSS('border-top-color', 'rgb(85, 34, 153)');
  });
}

for (const virtual of [true, false]) {
  test(`inherits Numbers blank-cell paint through the archive worker with virtual=${virtual}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const [rowCount, columnCount] = virtual ? [100_000, 1024] : [244, 32];
    const bytes = [...await createLargeMergedNumbersArchive({ rowCount, columnCount, styledBlanks: true })];
    await page.goto('./');
    const moduleUrl = new URL(`@fs${resolve('packages/iwork/src/index.ts')}`, page.url()).href;
    const cells = await page.evaluate(async ({ moduleUrl, bytes, virtual }) => {
      const { createIworkViewer } = await import(/* @vite-ignore */ moduleUrl);
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;inset:0';
      document.body.replaceChildren(host);
      const viewer = createIworkViewer(host, { virtual });
      const source = new Uint8Array(bytes);
      await viewer.preview(source);
      // The second open exercises the cached model with inherited styles.
      await viewer.preview(source);
      (window as any).numbersBlankStyles = viewer;
      return viewer.getState().document.sheets[0].tables[0].item.cells.length;
    }, { moduleUrl, bytes, virtual });
    expect(cells).toBe(3);
    const grid = page.locator('.xlsxv-grid');
    const rows = grid.locator('tbody tr[aria-rowindex]');
    const at = (row: number, column: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
    const fill = (row: number, column: number, color: string) => expect(at(row, column)).toHaveCSS('background-color', color);
    await fill(1, 3, 'rgb(153, 204, 255)');
    await expect(at(1, 3)).toHaveCSS('border-bottom-width', '3px');
    await expect(at(2, 2)).toHaveCount(0);
    await expect(grid.locator('[data-merge-ref="1:1"]')).toHaveText('Large merge origin');
    await fill(3, 1, 'rgb(255, 204, 102)');
    await fill(3, 3, 'rgb(204, 221, 255)');
    await expect(at(3, 3)).toHaveCSS('border-right-width', '0px');
    await fill(4, 3, 'rgba(0, 0, 0, 0)');
    await fill(4, 5, 'rgb(204, 238, 204)');
    await expect(at(4, 5)).toHaveCSS('border-right-color', 'rgb(153, 51, 102)');
    await fill(5, 5, 'rgb(255, 204, 221)');
    await expect(at(5, 5)).toBeEmpty();
    await expect(rows).toHaveCount(100);

    const scroll = () => grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
    await scroll();
    if (!virtual) {
      await expect(rows).toHaveCount(200);
      await scroll();
      await expect(rows).toHaveCount(rowCount);
      await scroll();
    }
    await expect(at(rowCount, columnCount)).toHaveText('Last sparse cell');
    await expect(at(rowCount, columnCount)).toBeInViewport();
    await fill(rowCount, columnCount, 'rgb(255, 230, 102)');
    await fill(rowCount, columnCount - 1, 'rgb(204, 255, 204)');
    await expect(at(rowCount, columnCount - 1)).toHaveCSS('border-top-width', '4px');
    await fill(rowCount - 1, columnCount, 'rgb(204, 221, 255)');
    if (virtual) {
      await expect(rows).toHaveCount(100);
      expect(await grid.locator('.xlsxv-cell').count()).toBeLessThanOrEqual(2500);
    }
    await page.evaluate(() => (window as any).numbersBlankStyles.refreshFonts());
    await expect(at(rowCount, columnCount)).toBeInViewport();
    await fill(rowCount, columnCount - 1, 'rgb(204, 255, 204)');
    expect(errors).toEqual([]);
  });
}
