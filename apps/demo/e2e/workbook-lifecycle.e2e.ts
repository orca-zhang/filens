import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import JSZip from 'jszip';
import { createColumnStyledWorkbookFixture, createMergedWorkbookFixture, createWorkbookFixture } from '../../../packages/xlsx/test/fixtures/workbook.mjs';

test('retains merged-cell geometry and offscreen anchors while windowing both workbook dimensions', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('./?view=preview');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({ name: 'merged.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createMergedWorkbookFixture({ formulas: true })) });
  const grid = page.locator('.xlsxv-grid'), table = grid.locator('table');
  const heading = table.locator('[data-merge-ref="A1"]');
  await expect(heading).toHaveText('Merged heading');
  await expect(heading).toHaveCSS('max-width', 'none');
  await expect(heading).toHaveAttribute('rowspan', '3'); await expect(heading).toHaveAttribute('colspan', '4');
  expect(await table.getByText('Covered value', { exact: true }).count()).toBe(0);
  const box = await heading.boundingBox();
  const columnWidths = await table.locator('.xlsxv-col-header').evaluateAll(headers => headers.slice(0, 4).reduce((sum, header) => sum + header.getBoundingClientRect().width, 0));
  expect(box!.width).toBeCloseTo(columnWidths, 0); expect(box!.height).toBeCloseTo(78, 0);
  await grid.evaluate(grid => { grid.scrollTop = 26 * 105; });
  const boundary = table.locator('[data-merge-ref="B90"]');
  await expect(boundary).toHaveText('15');
  await expect.poll(() => boundary.evaluate(cell => Number(cell.parentElement!.getAttribute('aria-rowindex')))).toBeGreaterThan(91);
  await expect(boundary).toHaveCSS('font-weight', '700');
  await grid.evaluate(grid => { grid.scrollTop = 26 * 1000; grid.scrollLeft = grid.scrollWidth; });
  const distant = table.locator('[data-merge-ref="A500"]');
  await expect(distant).toHaveText('Tall merge');
  await expect(distant).toHaveAttribute('rowspan', '100');
  await expect(table.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
  expect(await table.locator('.xlsxv-cell').count()).toBeLessThanOrEqual(2400);
  await expect(distant).toBeInViewport();
  const position = await grid.evaluate(grid => [grid.scrollTop, grid.scrollLeft]);
  await page.setViewportSize({ width: 900, height: 720 });
  await expect(distant).toBeInViewport();
  expect(await grid.evaluate(grid => [grid.scrollTop, grid.scrollLeft])).toEqual(position);
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
  const last = table.locator('tr[aria-rowindex="2001"] td[aria-colindex="65"]');
  await expect(last).toHaveText('15'); await expect(last).toBeInViewport();
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollLeft = 0; });
  await expect(heading).toBeInViewport();
  expect((await heading.boundingBox())!.height).toBeCloseTo(78, 0);
  expect(errors).toEqual([]);
});

test('reaches XFD1048576 with bounded row and column DOM and keeps the last cell visible', async ({ page }) => {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="Wide" sheetId="1" r:id="sheet"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="sheet" Target="worksheets/sheet.xml"/></Relationships>');
  zip.file('xl/worksheets/sheet.xml', '<worksheet><sheetData>' +
    '<row r="1"><c r="A1"><v>7</v></c><c r="B1"><v>8</v></c></row>' +
    '<row r="1048576"><c r="XFD1048576"><f>SUM(A1:B1)</f></c></row>' +
    '</sheetData></worksheet>');
  await page.goto('./?view=preview');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({ name: 'wide.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: await zip.generateAsync({ type: 'nodebuffer' }) });
  const grid = page.locator('.xlsxv-grid');
  await expect(page.locator('.xlsxv-col-header')).not.toHaveCount(0);
  const maxColumns = await grid.evaluate(grid => Math.ceil(grid.clientWidth / grid.querySelector('.xlsxv-col-header')!.getBoundingClientRect().width) + 10);
  expect(await page.locator('.xlsxv-col-header').count()).toBeGreaterThanOrEqual(20);
  expect(await page.locator('.xlsxv-col-header').count()).toBeLessThanOrEqual(maxColumns);
  expect(await page.locator('.xlsxv-cell').count()).toBeLessThanOrEqual(maxColumns * 100);
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
  const last = page.locator('tr[aria-rowindex="1048577"] .xlsxv-cell[aria-colindex="16385"]');
  await expect(last).toHaveText('15');
  await expect(page.locator('.xlsxv-col-header').last()).toHaveText('XFD');
  expect(await page.locator('.xlsxv-cell').count()).toBeLessThanOrEqual(maxColumns * 100);
  const bounds = await last.boundingBox(), viewport = await grid.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(viewport!.x + 47);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport!.x + viewport!.width + 1);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport!.y + viewport!.height + 1);
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollLeft = 0; });
  await expect(page.locator('tr[aria-rowindex="2"] .xlsxv-cell[aria-colindex="2"]')).toHaveText('7');
  await expect(page.locator('.xlsxv-col-header').first()).toHaveText('A');
});

test('reaches the last Excel row with bounded DOM and preserves formulas referring to offscreen cells', async ({ page }) => {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="Million rows" sheetId="1" r:id="sheet"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="sheet" Target="worksheets/sheet.xml"/></Relationships>');
  zip.file('xl/worksheets/sheet.xml', '<worksheet><sheetData>' +
    '<row r="1"><c r="A1" t="inlineStr"><is><t>First row</t></is></c><c r="B1"><v>7</v></c></row>' +
    '<row r="2"><c r="B2"><v>8</v></c></row>' +
    '<row r="786432"><c r="A786432" t="inlineStr"><is><t>Three quarters</t></is></c></row>' +
    '<row r="1048576"><c r="A1048576" t="inlineStr"><is><t>Last row</t></is></c><c r="C1048576"><f>SUM(B1:B2)</f></c></row>' +
    '</sheetData></worksheet>');
  await page.goto('./?view=preview');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({ name: 'million-rows.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: await zip.generateAsync({ type: 'nodebuffer' }) });
  const rows = page.locator('.xlsxv-table tbody tr[aria-rowindex]'), grid = page.locator('.xlsxv-grid');
  await expect(rows).toHaveCount(100);
  await expect(rows.first().locator('td').first()).toHaveText('First row');
  await expect(page.locator('.xlsxv-table')).toHaveAttribute('aria-rowcount', '1048577');
  for (const fraction of [0.1, 0.5, 0.75, 1]) {
    await grid.evaluate((grid, fraction) => { grid.scrollTop = (grid.scrollHeight - grid.clientHeight) * fraction; }, fraction);
    if (fraction === 1) await expect(rows.last().locator('th')).toHaveText('1048576');
    else if (fraction === 0.75) await expect(rows.filter({ hasText: 'Three quarters' })).toBeInViewport();
    else await expect.poll(() => rows.first().locator('th').textContent()).not.toBe('1');
    await expect(rows).toHaveCount(100);
    expect(await page.locator('.xlsxv-table tbody tr').count()).toBe(102);
  }
  expect(await rows.last().locator('td').allTextContents()).toEqual(['Last row', '', '15']);
  await grid.evaluate(grid => { grid.scrollTop = 0; });
  await expect(rows.first().locator('td').first()).toHaveText('First row');
  await expect(rows).toHaveCount(100);
  await expect(page.locator('.wb-note.is-error')).toHaveCount(0);
});

test('preserves column, row and explicit cell fonts while scrolling styled numeric rows', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('./?view=preview');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({ name: 'column-styles.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(await createColumnStyledWorkbookFixture()) });
  const rows = page.locator('.xlsxv-table tbody tr[aria-rowindex]'), grid = page.locator('.xlsxv-grid');
  await expect(rows).toHaveCount(100);
  const check = async (index: number) => {
    const cells = rows.nth(index).locator('td');
    await expect(cells.nth(1)).toHaveText('Names & notes');
    await expect(cells.nth(0)).toHaveCSS('font-family', /Arial/);
    await expect(cells.nth(1)).toHaveCSS('font-family', index === 10 ? /Times New Roman/ : /Courier New/);
    await expect(cells.nth(2)).toHaveCSS('font-family', /Times New Roman/);
    await expect(cells.nth(7)).toHaveCSS('font-family', /Arial/);
  };
  await check(0); await check(10);
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; });
  await expect(rows.last().locator('th')).toHaveText('240');
  await expect(rows).toHaveCount(100);
  await check(99);
  await expect(rows.last().locator('td').nth(2)).toHaveText('1922');
  expect(errors).toEqual([]);
});

test('keeps workbook values/formulas in bounded row windows and resets scrolling on sheet changes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/xlsx/src/index.ts')}`, page.url()).href;
  await page.evaluate(async ({ moduleUrl, bytes }) => {
    const { createXlsxPreviewDriver } = await import(/* @vite-ignore */ moduleUrl);
    const host = document.createElement('div');
    host.id = 'workbook-lifecycle-test'; host.style.cssText = 'position:fixed;inset:0;width:800px;height:600px;background:white';
    document.body.replaceChildren(host);
    const session = createXlsxPreviewDriver().createSession(host);
    (window as any).workbookLifecycle = { session, host };
    const source = new Uint8Array(bytes);
    await session.load(source, { descriptor: { source, name: 'sheets.xlsx', extension: 'xlsx' } });
  }, { moduleUrl, bytes: [...await createWorkbookFixture()] });
  const rows = page.locator('.xlsxv-table tbody tr[aria-rowindex]'), grid = page.locator('.xlsxv-grid');
  await expect(rows).toHaveCount(100);
  expect(await rows.first().locator('td').allTextContents()).toEqual(['First 1', '7', '21']);
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; });
  await expect(rows.last().locator('th')).toHaveText('240');
  await expect(rows).toHaveCount(100);
  expect(await rows.last().locator('td').allTextContents()).toEqual(['First 240', '1680', '']);
  await page.evaluate(() => (window as any).workbookLifecycle.session.next());
  await expect(rows).toHaveCount(100);
  expect(await rows.first().locator('td').allTextContents()).toEqual(['Second 1', '7', '21']);
  expect(await grid.evaluate(grid => grid.scrollTop)).toBe(0);
  await page.evaluate(() => (window as any).workbookLifecycle.session.prev());
  await expect(rows).toHaveCount(100);
  expect(await rows.first().locator('td').allTextContents()).toEqual(['First 1', '7', '21']);
  await page.evaluate(() => (window as any).workbookLifecycle.session.destroy());
  await expect(page.locator('#workbook-lifecycle-test')).toBeEmpty();
  expect(errors).toEqual([]);
});

test('discards replaced, aborted and destroyed CSV/XLSX reads without stale events', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/xlsx/src/index.ts')}`, page.url()).href;
  const results = await page.evaluate(async moduleUrl => {
    const { createXlsxPreviewDriver } = await import(/* @vite-ignore */ moduleUrl);
    const results = [];
    for (const format of ['csv', 'xlsx']) for (const action of ['replace', 'abort', 'destroy']) {
      const host = document.createElement('div'); document.body.replaceChildren(host);
      const session = createXlsxPreviewDriver().createSession(host);
      let rendered = 0, reportedErrors = 0, finish!: (value: any) => void;
      session.on('rendered', () => rendered++); session.on('error', () => reportedErrors++);
      const source = new Blob([]);
      Object.defineProperty(source, format === 'csv' ? 'text' : 'arrayBuffer', { value: () => new Promise(resolve => { finish = resolve; }) });
      const controller = new AbortController();
      const pending = session.load(source, { descriptor: { source, extension: format }, signal: controller.signal })
        .then(() => 'settled', (error: Error) => error.name);
      if (action === 'replace') {
        const current = new TextEncoder().encode('Current,42');
        await session.load(current, { descriptor: { source: current, extension: 'csv', name: 'current.csv' } });
      } else if (action === 'abort') controller.abort();
      else session.destroy();
      finish(format === 'csv' ? 'Stale,7' : new ArrayBuffer(0));
      const outcome = await pending;
      const correctContent = action === 'replace' ? host.querySelector('.xlsxv-table')?.textContent?.includes('Current') : !host.querySelector('.xlsxv-table');
      const state = session.getState(); session.destroy();
      results.push({ format, action, outcome, rendered, reportedErrors, correctContent, loading: state.loading });
    }
    return results;
  }, moduleUrl);
  expect(results).toHaveLength(6);
  for (const result of results) expect(result).toMatchObject({ outcome: result.action === 'abort' ? 'AbortError' : 'settled', rendered: result.action === 'replace' ? 1 : 0, reportedErrors: 0, correctContent: true, loading: false });
  expect(errors).toEqual([]);
});
