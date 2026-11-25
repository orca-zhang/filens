import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { createLargeMergedNumbersArchive } from '../../../packages/iwork/test/fixtures/numbers-archive.mjs';

for (const emptyAnchor of [false, true]) {
  test(`parses a huge merged Numbers archive in the worker with bounded cells (empty anchor: ${emptyAnchor})`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const bytes = [...await createLargeMergedNumbersArchive({ emptyAnchor })];
    await page.goto('./');
    const moduleUrl = new URL(`@fs${resolve('packages/iwork/src/index.ts')}`, page.url()).href;
    const parsed = await page.evaluate(async ({ moduleUrl, bytes }) => {
      const { createIworkViewer } = await import(/* @vite-ignore */ moduleUrl);
      const host = document.createElement('div'); host.style.cssText = 'position:fixed;inset:0'; document.body.replaceChildren(host);
      const viewer = createIworkViewer(host);
      await viewer.preview(new Uint8Array(bytes), { cache: false });
      (window as any).numbersArchive = { viewer, bytes };
      const doc = viewer.getState().document, table = doc.sheets[0].tables[0].item;
      return { kind: doc.kind, rows: table.rows.length, columns: table.columns.length, cells: table.cells.length,
        covered: table.cells.filter(cell => cell.isMergedContinuation).length, warnings: doc.warnings };
    }, { moduleUrl, bytes });
    expect(parsed).toEqual({ kind: 'numbers', rows: 100_000, columns: 1024, cells: 3, covered: 1, warnings: [] });
    const grid = page.locator('.xlsxv-grid'), table = grid.locator('table');
    const merge = table.locator('[data-merge-ref="1:1"]');
    await expect(merge).toHaveText(emptyAnchor ? '' : 'Large merge origin');
    await expect(merge).toHaveAttribute('rowspan', '100');
    expect(await table.getByText('Stored covered value', { exact: true }).count()).toBe(0);
    await grid.evaluate(grid => { grid.scrollTop = 26 * 50_000; grid.scrollLeft = 96 * 700; });
    await expect.poll(() => merge.evaluate(cell => Number(cell.parentElement!.getAttribute('aria-rowindex')))).toBeGreaterThan(49_000);
    await expect(merge).toBeInViewport();
    await expect(table.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
    expect(await table.locator('.xlsxv-cell').count()).toBeLessThanOrEqual(2400);
    await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
    const last = table.locator('tr[aria-rowindex="100001"] td[aria-colindex="1025"]');
    await expect(last).toHaveText('Last sparse cell'); await expect(last).toBeInViewport();
    const position = await grid.evaluate(grid => [grid.scrollTop, grid.scrollLeft]);
    await page.evaluate(() => (window as any).numbersArchive.viewer.refreshFonts());
    await expect(last).toBeInViewport();
    await expect.poll(() => grid.evaluate(grid => [grid.scrollTop, grid.scrollLeft])).toEqual(position);
    await page.evaluate(async () => {
      const { viewer, bytes } = (window as any).numbersArchive;
      await viewer.preview(new Uint8Array(bytes), { cache: false });
    });
    await expect.poll(() => grid.evaluate(grid => [grid.scrollTop, grid.scrollLeft])).toEqual([0, 0]);
    await expect(merge).toHaveText(emptyAnchor ? '' : 'Large merge origin');
    await page.evaluate(() => (window as any).numbersArchive.viewer.destroy());
    await expect(page.locator('.xlsxv-grid')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
