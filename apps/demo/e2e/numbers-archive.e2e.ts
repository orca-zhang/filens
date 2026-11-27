import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { createLargeMergedNumbersArchive, createModernNumbersArchive, createNumbersPictureFillArchive, createWideSparseNumbersArchive } from '../../../packages/iwork/test/fixtures/numbers-archive.mjs';
import { countNearbyPixels } from './screenshot-pixels';

for (const virtual of [true, false]) test(`paints saved Numbers picture modes with virtual=${virtual}`, async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 740 });
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/iwork/src/index.ts')}`, page.url()).href;
  await page.evaluate(async ({ moduleUrl, bytes, virtual }) => {
    const { createIworkViewer } = await import(/* @vite-ignore */ moduleUrl);
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0';
    document.body.replaceChildren(host);
    await createIworkViewer(host, { virtual }).preview(new Uint8Array(bytes), { cache: false });
  }, { moduleUrl, bytes: [...await createNumbersPictureFillArchive()], virtual });
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, column: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
  const layer = (row: number, column: number) => cell(row, column).locator('.pptxv-fill-layer');
  await expect(cell(1, 4).locator('.pptxv-run')).toHaveText('Picture');
  for (const [i, size] of ['36px 18px', '100% 100%', '36px 18px', 'cover', 'contain'].entries()) {
    await expect(layer(1, i + 1)).toHaveCSS('background-size', size);
    await expect(layer(2, i + 1)).toHaveCSS('background-size', size);
    await expect.poll(async () => (await layer(1, i + 1).boundingBox())?.height ?? 0).toBeCloseTo(81, -1);
  }
  await expect(layer(1, 3)).toHaveCSS('background-repeat', 'repeat');
  const red: [number, number, number] = [230, 30, 30], green: [number, number, number] = [32, 144, 72];
  const white: [number, number, number] = [255, 255, 255];
  const pixel = async (column: number, x: number, y: number, rgb: [number, number, number]) => {
    await expect.poll(async () => {
      const rect = await layer(1, column).boundingBox();
      return rect ? countNearbyPixels(page, rect.x + x, rect.y + y, rgb, 12) : 0;
    }).toBeGreaterThan(20);
  };
  await pixel(1, 10, 20, white);
  await pixel(1, 44, 38, red);
  await pixel(2, 32, 28, red);
  await pixel(3, 6, 24, red);
  await pixel(3, 18, 24, green);
  await pixel(4, 32, 28, green);
  await pixel(5, 10, 7, white);
  await pixel(5, 10, 28, red);
  const label = (await cell(1, 4).locator('.pptxv-run').boundingBox())!;
  await expect.poll(() => countNearbyPixels(page, label.x + label.width / 2, label.y + label.height / 2,
    [17, 24, 39], 25)).toBeGreaterThan(2);
  const singleRow = (await layer(2, 6).boundingBox())!;
  expect(singleRow.width).toBeCloseTo(560, 0);
  expect(singleRow.height).toBeCloseTo(82, 0);
  if (!virtual) return;

  expect(await grid.evaluate(async el => {
    const height = el.scrollHeight, body = el.querySelector('tbody');
    for (let i = 0; i < 6; i++) await new Promise(requestAnimationFrame);
    return height === el.scrollHeight && body === el.querySelector('tbody');
  })).toBe(true);
  await grid.evaluate(el => { el.scrollTop = 82 * 90; el.scrollLeft = 112 * 35; });
  const merged = grid.locator('[data-merge-ref="3:6"]');
  await expect.poll(() => merged.evaluate(el => Number(el.parentElement!.getAttribute('aria-rowindex')))).toBeGreaterThan(4);
  const clipped = merged.locator('.pptxv-fill-layer');
  const source = (await clipped.boundingBox())!, shown = (await merged.boundingBox())!, viewport = (await grid.boundingBox())!;
  expect(source.width).toBeCloseTo(5600, 0);
  expect(source.height).toBeCloseTo(9840, 0);
  expect(source.x).toBeLessThan(shown.x);
  expect(source.y).toBeLessThan(shown.y);
  const phase = (start: number, origin: number, step: number, offset: number) =>
    origin + Math.ceil((start - origin - offset) / step) * step + offset;
  const x = phase(Math.max(shown.x, viewport.x + 60), source.x, 36, 6);
  const y = phase(Math.max(shown.y, viewport.y + 40), source.y, 18, 7);
  await expect.poll(() => countNearbyPixels(page, x, y, red, 12)).toBeGreaterThan(20);
  await expect.poll(() => countNearbyPixels(page, x + 12, y, green, 12)).toBeGreaterThan(20);
});

test('tints one Numbers picture for regular, blank and clipped merged cells', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 740 });
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/iwork/src/index.ts')}`, page.url()).href;
  await page.evaluate(async ({ moduleUrl, bytes }) => {
    const { createIworkViewer } = await import(/* @vite-ignore */ moduleUrl);
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0';
    document.body.replaceChildren(host);
    const pngs: string[] = [], revoked: string[] = [];
    const createUrl = URL.createObjectURL.bind(URL), revokeUrl = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => {
      const url = createUrl(blob);
      if (blob.type === 'image/png') pngs.push(url);
      return url;
    };
    URL.revokeObjectURL = url => { revoked.push(url); revokeUrl(url); };
    const viewer = createIworkViewer(host);
    Object.assign(window, { tintTest: { viewer, pngs, revoked, bytes } });
    await viewer.preview(new Uint8Array(bytes), { cache: false });
  }, { moduleUrl, bytes: [...await createNumbersPictureFillArchive({ tinted: true })] });
  const grid = page.locator('.xlsxv-grid');
  const pngs = () => page.evaluate(() => (window as any).tintTest.pngs as string[]);
  await expect.poll(async () => (await pngs()).length).toBe(1);
  const [url] = await pngs();
  const cell = (row: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="4"] .pptxv-fill-layer`);
  for (const row of [1, 2]) await expect(cell(row)).toHaveCSS('background-image', `url("${url}")`);
  const solid: [number, number, number] = [115, 15, 143], translucent: [number, number, number] = [136, 164, 210];
  const transparent: [number, number, number] = [255, 255, 255];
  const rect = (await cell(1).boundingBox())!;
  for (const [offset, color] of [[6, solid], [18, translucent], [30, transparent]] as const) {
    await expect.poll(() => countNearbyPixels(page, rect.x + offset, rect.y + 24, color, 12)).toBeGreaterThan(20);
  }

  await grid.evaluate(el => { el.scrollTop = 82 * 90; el.scrollLeft = 112 * 35; });
  const paint = grid.locator('[data-merge-ref="3:6"] .pptxv-fill-layer');
  await expect.poll(() => paint.evaluate(el => el.getBoundingClientRect().top)).toBeLessThan(0);
  await expect(paint).toHaveCSS('background-image', `url("${url}")`);
  const source = (await paint.boundingBox())!, viewport = (await grid.boundingBox())!;
  const x = source.x + Math.ceil((viewport.x + 60 - source.x - 6) / 36) * 36 + 6;
  const y = viewport.y + 140;
  await expect.poll(() => countNearbyPixels(page, x, y, solid, 12)).toBeGreaterThan(20);
  await expect.poll(() => countNearbyPixels(page, x + 12, y, translucent, 12)).toBeGreaterThan(20);
  await expect.poll(() => countNearbyPixels(page, x + 24, y, transparent, 12)).toBeGreaterThan(20);
  expect(await pngs()).toEqual([url]);
  await page.evaluate(async () => {
    const state = (window as any).tintTest;
    const encode = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, ...options) {
      encode.call(this, blob => { state.finishEncode = () => callback(blob); }, ...options);
    };
    await state.viewer.preview(new Uint8Array(state.bytes), { cache: false });
  });
  await page.waitForFunction(() => typeof (window as any).tintTest.finishEncode === 'function');
  expect(await page.evaluate(async url => {
    const { viewer, revoked, pngs, finishEncode } = (window as any).tintTest;
    viewer.destroy();
    finishEncode();
    await new Promise(resolve => setTimeout(resolve, 0));
    return { revoked: revoked.includes(url), created: pngs };
  }, url)).toEqual({ revoked: true, created: [url] });
});

test('renders modern Numbers values in the worker across a wide table', async ({ page }) => {
  await page.goto('./?view=preview&lang=zh');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({
    name: 'modern-values.numbers',
    mimeType: 'application/vnd.apple.numbers',
    buffer: Buffer.from(await createModernNumbersArchive())
  });
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, col: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${col + 1}"]`);
  await expect(cell(1, 1)).toHaveText('-12.50%');
  await expect(cell(1, 1)).toHaveCSS('background-color', 'rgb(0, 255, 0)');
  await expect(cell(1, 1).locator('.pptxv-run')).toHaveCSS('font-weight', '700');
  await expect(cell(1, 2)).toHaveText('1999-12-31 23:59:59');
  await expect(cell(1, 3)).toHaveText('36:00:00');
  await expect(cell(1, 4)).toHaveText('Available');
  await expect(cell(1, 5)).toHaveText('Modern text');
  await expect(cell(1, 5).locator('.pptxv-paragraph')).toHaveCSS('text-align', 'center');
  await expect(cell(1, 5).locator('.pptxv-run')).toHaveCSS('font-weight', '400');
  await expect(cell(1, 5).locator('.pptxv-run')).toHaveCSS('font-style', 'italic');
  await expect(cell(1, 5).locator('.pptxv-run')).toHaveCSS('font-size', '16px');
  await expect(cell(1, 5).locator('.pptxv-run')).toHaveCSS('font-family', /Helvetica Neue/);
  await expect(cell(2, 1)).toHaveText('36:00');
  await expect(cell(2, 2)).toHaveText('-1h 1m 1s 125ms');
  await expect(cell(2, 3)).toHaveText('0 days');
  await expect(cell(2, 4)).toHaveText('01:01.001');
  await expect(cell(3, 1)).toHaveText('-1.23E-05');
  await expect(cell(3, 2)).toHaveText('3 16/113');
  await expect(cell(3, 3)).toHaveText('-1 2/4');
  await expect(cell(3, 4)).toHaveText('FFFFFF01');
  await expect(cell(4, 1)).toHaveText('3');
  await expect(cell(4, 2)).toHaveText('(123,456.79)');
  await expect(cell(4, 3).locator('.pptxv-run')).toHaveCSS('color', 'rgb(255, 0, 0)');
  await expect(cell(4, 4).locator('.pptxv-run')).not.toHaveCSS('color', 'rgb(255, 0, 0)');
  await expect(cell(4, 5)).toHaveText('£(9,876,543.22)');
  await expect(cell(4, 6)).toHaveText('$ (1,234.56)');
  await expect(cell(4, 8)).toHaveText('3');
  await expect(cell(4, 8)).toHaveCSS('background-color', 'rgb(0, 255, 0)');
  await expect(cell(4, 8).locator('.pptxv-run')).toHaveCSS('color', 'rgb(204, 0, 102)');
  await expect(cell(5, 1)).toHaveText('Thursday, 29 February 2024 1:04:05.12345 PM AD');
  await expect(cell(5, 2)).toHaveText('Sun5172026AD');
  await expect(cell(5, 3)).toHaveText('Epoch 2001/01/01 24:00 0');
  await expect(cell(5, 4)).toHaveText('1372143');
  await expect(cell(5, 5)).toHaveText('Friday, 31 December 1999 11:59:59.00000 PM AD');
  await expect(cell(6, 1)).toHaveText('Zero or below 1,234.56');
  await expect(cell(6, 3)).toHaveText('Ref 007%: 1,234.56');
  await expect(cell(6, 4)).toHaveText('Tag [A&B]');
  await expect(cell(6, 5)).toHaveText('Tag [Styled text]');
  await expect(cell(6, 5).locator('.pptxv-run').nth(1)).toHaveCSS('font-weight', '700');
  await expect(cell(6, 5).locator('.pptxv-run').nth(1)).toHaveCSS('font-style', 'italic');
  await expect(cell(6, 6)).toHaveText('CHF 42.45 paid');
  await expect(cell(6, 7)).toHaveText('5% of 12.5%');
  await expect.poll(() => cell(6, 10).textContent()).toBe('-    42.12');
  await expect(cell(6, 11)).toHaveText('Zero or below 2.5');
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
  await expect(cell(100_000, 2043)).toHaveText('Zero or below 1,234.56');
  await expect(cell(100_000, 2044)).toHaveText('Epoch 2001/01/01 24:00 0');
  const accounting = cell(100_000, 2045).locator('.iworkv-accounting .pptxv-paragraph');
  await expect(accounting).toHaveText('$ (1,234.56)');
  await expect(accounting).toHaveCSS('justify-content', 'space-between');
  const [currency, amount] = await accounting.locator('.pptxv-run').evaluateAll(runs => runs.map(run => run.getBoundingClientRect().toJSON()));
  expect(amount.left - currency.right).toBeGreaterThan(20);
  await expect(cell(100_000, 2046)).toHaveText('1.00E+01');
  await expect(cell(100_000, 2047)).toHaveText('1 day 1 hour');
  await expect(cell(100_000, 2048)).toHaveText('€42.50');
  await expect(cell(100_000, 2048).locator('.pptxv-run')).toHaveCSS('color', 'rgb(204, 0, 102)');
  await expect(cell(100_000, 2048)).toBeInViewport();
  await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
});

test('renders modern and legacy stored cells at the end of a wide sparse Numbers table', async ({ page }) => {
  await page.goto('./?view=preview&lang=zh');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({
    name: 'wide-sparse-rows.numbers', mimeType: 'application/vnd.apple.numbers',
    buffer: Buffer.from(await createWideSparseNumbersArchive())
  });
  const grid = page.locator('.xlsxv-grid');
  await expect(grid.locator('tr[aria-rowindex="2"] td[aria-colindex="2"]')).toHaveText('Row start');
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
  await expect(grid.locator('tr[aria-rowindex="4096"] td[aria-colindex="2049"]')).toHaveText('Modern edge');
  const last = grid.locator('tr[aria-rowindex="4097"] td[aria-colindex="2049"]');
  await expect(last).toHaveText('Legacy edge');
  await expect(last).toBeInViewport();
  await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
});

for (const [emptyAnchor, hiddenTracks] of [[false, false], [true, false], [false, true]]) {
  test(`parses a huge merged Numbers archive in the worker (empty anchor: ${emptyAnchor}, hidden tracks: ${hiddenTracks})`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const bytes = [...await createLargeMergedNumbersArchive({ emptyAnchor, hiddenTracks })];
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
        covered: table.cells.filter(cell => cell.isMergedContinuation).length, warnings: doc.warnings,
        hiddenRows: table.hiddenRows ?? [], hiddenColumns: table.hiddenColumns ?? [] };
    }, { moduleUrl, bytes });
    const hidden = hiddenTracks ? [0, 1] : [];
    expect(parsed).toEqual({ kind: 'numbers', rows: 100_000, columns: 1024, cells: 3, covered: 1, warnings: [],
      hiddenRows: hidden, hiddenColumns: hidden });
    const grid = page.locator('.xlsxv-grid'), table = grid.locator('table');
    const merge = table.locator('[data-merge-ref="1:1"]');
    await expect(merge).toHaveText(emptyAnchor ? '' : 'Large merge origin');
    await expect(merge).toHaveAttribute('rowspan', '100');
    if (hiddenTracks) {
      await expect(table.locator('.xlsxv-row-header').first()).toHaveText('3');
      await expect(table.locator('.xlsxv-col-header').first()).toHaveText('C');
    }
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
