import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { createNumbersWindowFixture, createNumbersPictureFixture, createNumbersMergedFixture, createNumbersStyledFixture, createNumbersColumnWidthFixture } from '../../../packages/iwork/test/fixtures/numbers-window.mjs';

async function open(page: Page, fixture = createNumbersWindowFixture(), virtual?: boolean) {
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/iwork/src/index.ts')}`, page.url()).href;
  await page.evaluate(async ({ moduleUrl, fixture, virtual }) => {
    const { createIworkViewer } = await import(/* @vite-ignore */ moduleUrl);
    const host = document.createElement('div'); host.style.cssText = 'position:fixed;inset:0'; document.body.replaceChildren(host);
    const viewer = createIworkViewer(host, { virtual });
    const source = await (await fetch(new URL('samples/a.numbers', location.href))).arrayBuffer();
    await viewer.preview(source, { cache: false });
    const doc = viewer.getState().document;
    // Exercise the real viewer/worker lifecycle, then isolate large-grid rendering from parsing.
    doc.sheets[0] = fixture.sheets[0]; doc.sheets[1] = fixture.sheets[1];
    for (const [id, asset] of Object.entries(fixture.media) as [string, any][]) {
      doc.media[id] = { ...asset, data: new Uint8Array(Object.values(asset.data)) };
    }
    if (virtual === false) viewer.goToSheet(0);
    else viewer.refreshFonts();
    (window as any).numbersWindow = { viewer, host, source };
  }, { moduleUrl, fixture, virtual });
}

for (const virtual of [true, false]) {
  test(`collapses Numbers hidden source tracks with virtual=${virtual}`, async ({ page }) => {
    const fixture = createNumbersWindowFixture(2100, 64);
    fixture.sheets[0].tables.splice(1);
    const item = fixture.sheets[0].tables[0].item;
    Object.assign(item, { hiddenRows: [0, 2, ...Array.from({ length: 1860 }, (_, i) => i + 40)],
      hiddenColumns: [0, 2, ...Array.from({ length: 30 }, (_, i) => i + 10)] });
    Object.assign(item.cells[0], { rowSpan: 4, colSpan: 4 });
    await open(page, fixture, virtual);
    const grid = page.locator('.xlsxv-grid'), table = grid.locator('table').first();
    const rows = table.locator('tbody tr[aria-rowindex]');
    await expect(rows.first().locator('th')).toHaveText('2');
    await expect(table.locator('.xlsxv-col-header').first()).toHaveText('B');
    const merge = table.locator('[data-merge-ref="1:1"]');
    await expect(merge).toHaveText('large first');
    await expect(merge).toHaveAttribute('rowspan', '2');
    await expect(merge).toHaveAttribute('colspan', '2');
    await expect(rows).toHaveCount(100);
    const scroll = () => grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
    await scroll();
    if (!virtual) {
      await expect(rows).toHaveCount(200);
      await scroll();
      await expect(rows).toHaveCount(238);
      await scroll();
    }
    const last = table.locator('tr[aria-rowindex="2101"] td[aria-colindex="65"]');
    await expect(last).toHaveText('large last');
    await expect(last).toBeInViewport();
    if (virtual) await expect(rows).toHaveCount(100);
    await page.evaluate(() => (window as any).numbersWindow.viewer.refreshFonts());
    await expect(last).toBeInViewport();
  });
}

test('bounds large Numbers grids through distant rows/columns, font refresh, resize and sheet replacement', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await open(page);
  const grid = page.locator('.xlsxv-grid'), table = grid.locator('table').first();
  await expect(table.locator('.xlsxv-cell').first()).toHaveText('large first');
  expect(await table.locator('.xlsxv-cell').count()).toBeLessThanOrEqual(2400);
  await expect(grid.locator('table')).toHaveCount(2);
  await grid.evaluate(grid => { grid.scrollTop = 26 * 100_000; grid.scrollLeft = 96 * 1024; });
  const last = table.locator('tr[aria-rowindex="100001"] td[aria-colindex="1025"]');
  await expect(last).toHaveText('large last');
  await expect(last).toBeInViewport();
  await expect(table.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
  expect(await table.locator('.xlsxv-cell').count()).toBeLessThanOrEqual(2400);
  const position = await grid.evaluate(grid => [grid.scrollTop, grid.scrollLeft]);
  await page.evaluate(() => (window as any).numbersWindow.viewer.refreshFonts());
  await expect(last).toHaveText('large last');
  expect(await grid.evaluate(grid => [grid.scrollTop, grid.scrollLeft])).toEqual(position);
  await page.setViewportSize({ width: 900, height: 720 });
  await expect.poll(() => table.locator('.xlsxv-cell').count()).toBeLessThanOrEqual(2000);
  expect(await grid.evaluate(grid => [grid.scrollTop, grid.scrollLeft])).toEqual(position);
  await grid.evaluate(grid => { grid.scrollLeft = grid.scrollWidth; });
  await expect(last).toBeInViewport();
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollLeft = 0; });
  await expect(table.locator('.xlsxv-cell').first()).toHaveText('large first');
  await page.locator('.xlsxv-sheet-tab').nth(1).click();
  await expect(grid.locator('table')).toHaveCount(1);
  await expect(grid.locator('td').first()).toHaveText('other first');
  await page.evaluate(async () => {
    const test = (window as any).numbersWindow;
    await test.viewer.preview(test.source, { cache: false });
    test.viewer.destroy();
  });
  await expect(page.locator('.xlsxv-grid')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('uses each table’s offset when several Numbers tables share the viewport', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const fixture = createNumbersWindowFixture(2000, 64);
  const lower = createNumbersWindowFixture(5000, 128).sheets[0].tables[0];
  lower.id = lower.item.id = 'lower'; lower.item.cells[1].textFrame.paragraphs[0].runs[0].text = 'lower last';
  fixture.sheets[0].tables.push(lower);
  await open(page, fixture);
  const grid = page.locator('.xlsxv-grid'), lowerTable = grid.locator('table').nth(2);
  await grid.evaluate(grid => {
    const table = grid.querySelectorAll('table')[2];
    grid.scrollTop += table.getBoundingClientRect().top - grid.getBoundingClientRect().top + 26 * 5000;
    grid.scrollLeft = grid.scrollWidth;
  });
  const last = lowerTable.locator('tr[aria-rowindex="5001"] td[aria-colindex="129"]');
  await expect(last).toHaveText('lower last');
  await expect(last).toBeInViewport();
  await expect(grid.locator('table')).toHaveCount(3);
  expect(await grid.locator('tbody tr[aria-rowindex]').count()).toBeLessThanOrEqual(203);
  await page.evaluate(() => (window as any).numbersWindow.viewer.destroy());
  expect(errors).toEqual([]);
});

test('windows variable-height Numbers picture rows without collapsing them on horizontal turns or font refresh', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await open(page, createNumbersPictureFixture());
  const grid = page.locator('.xlsxv-grid'), table = grid.locator('table').first();
  const first = table.locator('tr[aria-rowindex="2"]'), firstImage = first.locator('img');
  await expect.poll(() => firstImage.evaluate((image: HTMLImageElement) => image.complete && image.naturalHeight)).toBe(240);
  let firstHeight = 0;
  await expect.poll(async () => {
    firstHeight = await first.evaluate(row => row.getBoundingClientRect().height);
    return firstHeight;
  }).toBeGreaterThan(180);
  expect(await table.locator('.xlsxv-cell').count()).toBeLessThanOrEqual(2400);
  await grid.evaluate(grid => { grid.scrollLeft = grid.scrollWidth; });
  await expect(first.locator('td[aria-colindex="65"] img')).toHaveCount(1);
  await expect.poll(() => first.locator('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth)).toBe(240);
  expect(await first.evaluate(row => row.getBoundingClientRect().height)).toBeCloseTo(firstHeight, 0);
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; });
  const last = table.locator('tr[aria-rowindex="5001"]'), lastImage = last.locator('td[aria-colindex="65"] img');
  await expect(lastImage).toHaveCount(1);
  await expect.poll(() => lastImage.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth)).toBe(240);
  await expect(lastImage).toBeInViewport();
  await grid.evaluate(grid => { grid.scrollLeft = 0; });
  const tall = last.locator('td[aria-colindex="2"] img');
  await expect.poll(() => tall.evaluate((image: HTMLImageElement) => image.complete && image.naturalHeight)).toBe(240);
  await expect.poll(() => last.evaluate(row => row.getBoundingClientRect().height)).toBeGreaterThan(180);
  await expect(tall).toBeInViewport();
  const position = await grid.evaluate(grid => [grid.scrollTop, grid.scrollLeft]);
  await page.evaluate(() => (window as any).numbersWindow.viewer.refreshFonts());
  await expect(tall).toHaveCount(1);
  await expect.poll(() => tall.evaluate((image: HTMLImageElement) => image.complete && image.naturalHeight)).toBe(240);
  await expect(tall).toBeInViewport();
  await expect.poll(() => grid.evaluate(grid => [grid.scrollTop, grid.scrollLeft])).toEqual(position);
  await expect.poll(() => grid.evaluate(grid => grid.scrollHeight - grid.scrollTop - grid.clientHeight)).toBeLessThanOrEqual(1);
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollLeft = 0; });
  await expect(firstImage).toHaveCount(1);
  await expect(firstImage).toBeInViewport();
  expect(await table.locator('tbody tr[aria-rowindex]').count()).toBe(100);
  await page.evaluate(() => (window as any).numbersWindow.viewer.destroy());
  expect(errors).toEqual([]);
});

for (const merged of [false, true]) {
  test(`preserves source widths and the reading row in ${merged ? 'merged' : 'narrow'} Numbers picture tables on resize`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const fixture = createNumbersPictureFixture(2000, 2);
    fixture.sheets[0].tables[0].item.columns = [320, 160];
    if (merged) fixture.sheets[0].tables[0].item.cells[0].colSpan = 2;
    for (const cell of fixture.sheets[0].tables[0].item.cells) {
      if (cell.fill.type === 'picture') cell.fill.mediaId = 'picture-wide';
    }
    await open(page, fixture);
    const grid = page.locator('.xlsxv-grid'), table = grid.locator('table').first();
    const first = table.locator('tr[aria-rowindex="2"]');
    await expect.poll(() => first.locator('img').first().evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth)).toBe(240);
    let originalHeight = 0;
    await expect.poll(async () => originalHeight = await first.evaluate(row => row.getBoundingClientRect().height)).toBeGreaterThan(100);
    const originalWidth = await table.evaluate(table => table.getBoundingClientRect().width);
    expect(originalWidth).toBeCloseTo(529, 0); // Includes the collapsed outside border.
    const readingRow = () => grid.evaluate(grid => {
      const top = grid.getBoundingClientRect().top + grid.clientTop;
      return [...grid.querySelectorAll('table:first-of-type tbody tr[aria-rowindex]')]
        .find(row => row.getBoundingClientRect().bottom > top)?.getAttribute('aria-rowindex');
    });
    await grid.evaluate(grid => {
      const row = grid.querySelector('tr[aria-rowindex="2"]')!;
      grid.scrollTop += row.getBoundingClientRect().bottom - grid.getBoundingClientRect().top - 5;
    });
    await expect.poll(readingRow).toBe('2');
    await page.setViewportSize({ width: 480, height: 720 });
    await expect.poll(() => table.evaluate(table => table.getBoundingClientRect().width)).toBeCloseTo(originalWidth, 0);
    await expect.poll(() => first.evaluate(row => row.getBoundingClientRect().height)).toBeCloseTo(originalHeight, 0);
    await expect.poll(readingRow).toBe('2');
    await grid.evaluate(grid => { grid.scrollTop = 40_000; });
    await expect.poll(async () => Number(await readingRow())).toBeGreaterThan(1000);
    const row = await readingRow();
    await page.setViewportSize({ width: 1100, height: 720 });
    await expect.poll(readingRow).toBe(row);
    await grid.evaluate(grid => { grid.scrollTop = 0; });
    await expect.poll(() => first.evaluate(row => row.getBoundingClientRect().height)).toBeCloseTo(originalHeight, 0);
    await page.setViewportSize({ width: 480, height: 720 });
    await expect.poll(() => first.evaluate(row => row.getBoundingClientRect().height)).toBeCloseTo(originalHeight, 0);
    await expect(first.locator('img').first()).toBeInViewport();
    await page.evaluate(() => (window as any).numbersWindow.viewer.destroy());
    expect(errors).toEqual([]);
  });
}

test('preserves unequal Numbers source widths, very wide columns and clipped merged coordinates', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const fixture = createNumbersColumnWidthFixture(), columns = fixture.sheets[0].tables[0].item.columns;
  await open(page, fixture);
  const grid = page.locator('.xlsxv-grid'), table = grid.locator('table').first();
  for (let index = 0; index < 4; index++) {
    expect((await table.locator('.xlsxv-col-header').nth(index).boundingBox())!.width).toBeCloseTo(columns[index], 0);
  }
  expect((await grid.locator('table').nth(1).boundingBox())!.width).toBeCloseTo(365, 0);
  await grid.evaluate((grid, left) => { grid.scrollLeft = left; }, columns.slice(0, 30).reduce((sum, width) => sum + width, 1000));
  const wide = table.locator('tr[aria-rowindex="2"] td[aria-colindex="32"]');
  await expect(wide).toHaveText('Wide source column'); await expect(wide).toBeInViewport();
  expect((await wide.boundingBox())!.width).toBeCloseTo(2400, 0);
  await grid.evaluate(grid => { grid.scrollTop = 26 * 140; grid.scrollLeft = 1400; });
  const merged = table.locator('[data-merge-ref="91:2"]'), content = merged.locator('.xlsxv-merged-content');
  await expect(merged).toHaveCount(1);
  await grid.evaluate(grid => {
    const run = grid.querySelector('[data-merge-ref="91:2"] .pptxv-run')!;
    grid.scrollTop += run.getBoundingClientRect().top - grid.getBoundingClientRect().top - grid.clientHeight / 2;
  });
  await expect(merged.locator('.pptxv-run')).toBeInViewport();
  await expect(merged).toHaveCSS('border-left-width', '0px');
  const mergeWidth = columns.slice(1, 21).reduce((sum, width) => sum + width, 0);
  expect((await content.boundingBox())!.width).toBeCloseTo(mergeWidth, 0);
  expect(Math.abs((await content.boundingBox())!.x - ((await table.boundingBox())!.x + 48 + columns[0]))).toBeLessThanOrEqual(2);
  const position = await grid.evaluate(grid => [grid.scrollTop, grid.scrollLeft]);
  await page.evaluate(() => (window as any).numbersWindow.viewer.refreshFonts());
  await expect(merged.locator('.pptxv-run')).toBeInViewport();
  await expect.poll(() => grid.evaluate(grid => [grid.scrollTop, grid.scrollLeft])).toEqual(position);
  await page.setViewportSize({ width: 900, height: 720 });
  await expect.poll(() => content.evaluate(content => content.getBoundingClientRect().width)).toBeCloseTo(mergeWidth, 0);
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
  const last = table.locator('tr[aria-rowindex="2001"] td[aria-colindex="65"]');
  await expect(last).toHaveText('Styled last'); await expect(last).toBeInViewport();
  expect((await last.boundingBox())!.width).toBeCloseTo(columns.at(-1)!, 0);
  expect(await table.locator('.xlsxv-cell').count()).toBeLessThanOrEqual(2400);
  await page.evaluate(() => (window as any).numbersWindow.viewer.destroy());
  expect(errors).toEqual([]);
});

test('keeps merged Numbers pictures within source rows and clips huge spans to the visible window', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const fixture = createNumbersMergedFixture();
  await open(page, fixture);
  const grid = page.locator('.xlsxv-grid'), table = grid.locator('table').first();
  const first = table.locator('[data-merge-ref="1:1"]');
  await expect(first).toHaveAttribute('rowspan', '3'); await expect(first).toHaveAttribute('colspan', '4');
  await expect.poll(() => first.locator('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalHeight)).toBe(240);
  await expect(first.locator('img')).toBeInViewport();
  expect((await first.boundingBox())!.height).toBeCloseTo(116, 0);
  expect(await table.getByText('Covered Numbers value', { exact: true }).count()).toBe(0);
  const offset = fixture.sheets[0].tables[0].item.rows.slice(0, 3200).reduce((sum, height) => sum + height, 0);
  await grid.evaluate((grid, offset) => { grid.scrollTop = offset; grid.scrollLeft = grid.scrollWidth; }, offset);
  const distant = table.locator('[data-merge-ref="2501:1"]');
  await expect(distant).toHaveCount(1); await expect(distant).toHaveAttribute('rowspan', '100');
  await expect(distant).toBeInViewport();
  await expect(distant.locator('img')).toHaveCount(1);
  expect(await table.locator('.xlsxv-cell').count()).toBeLessThanOrEqual(2400);
  const position = await grid.evaluate(grid => [grid.scrollTop, grid.scrollLeft]);
  await page.evaluate(() => (window as any).numbersWindow.viewer.refreshFonts());
  await expect(distant).toBeInViewport();
  await expect.poll(() => grid.evaluate(grid => [grid.scrollTop, grid.scrollLeft])).toEqual(position);
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollLeft = 0; });
  await expect(first.locator('img')).toBeInViewport();
  expect((await first.boundingBox())!.height).toBeCloseTo(116, 0);
  await page.evaluate(() => (window as any).numbersWindow.viewer.destroy());
  expect(errors).toEqual([]);
});

test('preserves Numbers rich text, fills, borders and merged alignment through distant windows and font refresh', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await open(page, createNumbersStyledFixture());
  const grid = page.locator('.xlsxv-grid'), table = grid.locator('table').first();
  const first = table.locator('tr[aria-rowindex="2"] td[aria-colindex="2"]');
  await expect(first).toHaveCSS('background-color', 'rgb(254, 243, 199)');
  await expect(first).toHaveCSS('vertical-align', 'bottom');
  await expect(first).toHaveCSS('border-top-style', 'dashed'); await expect(first).toHaveCSS('border-bottom-style', 'double');
  const runs = first.locator('.pptxv-run');
  await expect(runs.nth(0)).toHaveCSS('font-weight', '700'); await expect(runs.nth(0)).toHaveCSS('font-size', '18px');
  await expect(runs.nth(0)).toHaveCSS('color', 'rgb(185, 28, 28)');
  await expect(runs.nth(0)).toHaveAttribute('href', 'https://example.com/report');
  await expect(runs.nth(1)).toHaveCSS('font-style', 'italic');
  await expect(first.locator('p').first()).toHaveCSS('text-align', 'right');
  await expect(first.locator('.pptxv-text-frame')).toHaveCSS('padding-left', '12px');
  const frameBox = await first.locator('.pptxv-text-frame').boundingBox(), cellBox = await first.boundingBox();
  expect(frameBox!.y).toBeGreaterThan(cellBox!.y);
  expect(frameBox!.y + frameBox!.height).toBeLessThanOrEqual(cellBox!.y + cellBox!.height + 1);
  await expect(table.locator('tr[aria-rowindex="3"] td[aria-colindex="2"]')).toHaveCSS('background-image', /linear-gradient/);
  await expect(table.locator('tr[aria-rowindex="3"] td[aria-colindex="3"]')).toHaveCSS('background-image', /linear-gradient/);
  await grid.evaluate(grid => { grid.scrollTop = 26 * 150; });
  const merged = table.locator('[data-merge-ref="91:2"]');
  await expect(merged.locator('.pptxv-run')).toBeInViewport();
  await expect(merged.locator('.pptxv-text-frame')).toHaveCSS('justify-content', 'center');
  await expect(merged).toHaveCSS('border-top-width', '0px'); await expect(merged).toHaveCSS('border-bottom-width', '0px');
  await expect(merged).toHaveCSS('background-size', '1920px 3900px');
  await grid.evaluate(grid => { grid.scrollLeft = 96 * 10; });
  await expect(merged).toHaveCSS('border-left-width', '0px');
  await expect(merged.locator('.pptxv-run')).toBeInViewport();
  const position = await grid.evaluate(grid => [grid.scrollTop, grid.scrollLeft]);
  await page.evaluate(() => {
    const viewer = (window as any).numbersWindow.viewer;
    for (const cell of viewer.getState().document.sheets[0].tables[0].item.cells)
      for (const paragraph of cell.textFrame.paragraphs) for (const run of paragraph.runs) run.fontFamily = 'Loaded Numbers Serif';
    viewer.refreshFonts();
  });
  await expect(merged.locator('.pptxv-run')).toHaveCSS('font-family', /Loaded Numbers Serif/);
  await expect.poll(() => grid.evaluate(grid => [grid.scrollTop, grid.scrollLeft])).toEqual(position);
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
  const last = table.locator('tr[aria-rowindex="2001"] td[aria-colindex="65"]');
  await expect(last).toHaveText('Styled last'); await expect(last).toBeInViewport();
  await expect(last).toHaveCSS('background-color', 'rgb(209, 250, 229)');
  expect(await table.locator('.xlsxv-cell').count()).toBeLessThanOrEqual(2400);
  await page.evaluate(() => (window as any).numbersWindow.viewer.destroy());
  expect(errors).toEqual([]);
});

test('renders inherited header typography and fills from a real Numbers archive', async ({ page }) => {
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/iwork/src/index.ts')}`, page.url()).href;
  const source = await page.evaluate(async moduleUrl => {
    const { createIworkViewer } = await import(/* @vite-ignore */ moduleUrl);
    const host = document.createElement('div'); host.style.cssText = 'position:fixed;inset:0'; document.body.replaceChildren(host);
    const viewer = createIworkViewer(host);
    await viewer.preview(await (await fetch(new URL('samples/a.numbers', location.href))).arrayBuffer(), { cache: false });
    (window as any).realNumbersStyles = viewer;
    const item = viewer.getState().document.sheets[0].tables[0].item;
    const cell = item.cells.find(cell => cell.row === 0 && cell.column === 0);
    return { text: cell.textFrame.paragraphs[0].runs[0].text, fill: cell.fill.color, size: cell.textFrame.paragraphs[0].runs[0].fontSize,
      bold: cell.textFrame.paragraphs[0].runs[0].bold, columnWidths: item.columns };
  }, moduleUrl);
  expect(source).toMatchObject({ text: '    aws', fill: '#bec0bf', size: 10, bold: true });
  const cell = page.locator('.xlsxv-grid table').first().locator('tr[aria-rowindex="2"] td[aria-colindex="2"]');
  expect(await cell.locator('.pptxv-run').evaluate(run => run.textContent)).toBe(source.text);
  await expect(cell).toHaveCSS('background-color', 'rgb(190, 192, 191)');
  await expect(cell.locator('.pptxv-run')).toHaveCSS('font-size', '10px');
  await expect(cell.locator('.pptxv-run')).toHaveCSS('font-weight', '700');
  await expect(cell.locator('.pptxv-run')).toHaveCSS('font-family', /Helvetica/);
  expect((await cell.boundingBox())!.width).toBeCloseTo(source.columnWidths[0], 0);
  await page.evaluate(() => (window as any).realNumbersStyles.destroy());
});
