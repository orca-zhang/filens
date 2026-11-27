import { createServer, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import JSZip from 'jszip';
import { createColumnStyledWorkbookFixture, createMergedWorkbookFixture, createWorkbookFixture } from '../../../packages/xlsx/test/fixtures/workbook.mjs';
import { createImplicitCoordinateWorkbook, createWorksheetBatchWorkbook } from '../../../packages/xlsx/test/fixtures/worksheet-batches.mjs';

test('renders formulas and rich text from a large worksheet parsed in row batches', async ({ page }) => {
  await page.goto('./?view=preview');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({
    name: 'row-batches.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createWorksheetBatchWorkbook()),
  });
  const grid = page.locator('.xlsxv-grid');
  await expect(grid.locator('[data-merge-ref="B1"]')).toHaveText('North & 南 branch');
  await expect(grid.locator('tr[aria-rowindex="2"] [aria-colindex="4"]')).toHaveText('4');
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
  const last = grid.locator('tr[aria-rowindex="1048577"] [aria-colindex="16385"]');
  await expect(last).toHaveText('6430.00');
  await expect(last).toBeInViewport();
  await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
});

test('retains omitted XLSX coordinates through the last cell and cross-sheet formulas', async ({ page }) => {
  await page.goto('./?view=preview');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({
    name: 'omitted-coordinates.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createImplicitCoordinateWorkbook({ large: true, mixed: true }))
  });
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, column: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
  await expect(cell(1, 1)).toHaveText('2');
  await expect(cell(1, 2)).toBeEmpty();
  await expect(cell(1, 3)).toHaveText('6');
  await expect(cell(1, 4)).toBeEmpty();
  await expect(grid.locator('[data-merge-ref="F1"]')).toHaveText('Heading');
  await expect(cell(9, 1)).toHaveCount(0);
  await expect(cell(10, 4)).toHaveText('12.00');
  const summary = page.getByRole('button', { name: 'Summary', exact: true });
  await expect(summary).toBeVisible();
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
  await expect(cell(1048576, 16384)).toHaveText('22');
  await expect(cell(1048576, 16384)).toBeInViewport();
  await summary.click();
  await expect(cell(1, 1)).toHaveText('59');
  await expect(cell(4, 4)).toHaveText('9');
  await expect(cell(5, 4)).toHaveText('12');
});

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

test('reads a remote CSV body without buffering it in the workbench', async ({ page }) => {
  const url = 'https://files.example.test/stream.csv';
  await page.route(url, route => route.fulfill({
    contentType: 'text/csv', headers: { 'Access-Control-Allow-Origin': '*' },
    body: 'name,subject\r\n"中文 😀","quoted ""value""\nwith a newline"\r\n'
  }));
  await page.addInitScript(url => {
    const reads: string[] = [];
    Object.assign(window, { csvBufferedReads: reads });
    for (const method of ['arrayBuffer', 'text'] as const) {
      const read = Response.prototype[method];
      Object.defineProperty(Response.prototype, method, { value(this: Response) {
        if (this.url === url) reads.push(method);
        return read.call(this);
      } });
    }
  }, url);
  await page.goto(`./?url=${encodeURIComponent(url)}&lang=en`);
  const grid = page.locator('.xlsxv-grid');
  await expect(grid).toContainText('中文 😀');
  await expect(grid).toContainText('quoted "value" with a newline');
  expect(await page.evaluate(() => (window as Window & { csvBufferedReads: string[] }).csvBufferedReads)).toEqual([]);
});

async function serveHeldCsv(firstChunk: string) {
  let activeResponse: ServerResponse | undefined, cancelled = false;
  const server = createServer((_, response) => {
    activeResponse = response;
    response.once('close', () => { cancelled = !response.writableFinished; });
    response.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/csv' });
    response.write(firstChunk);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}/held.csv`,
    write: (chunk: string) => activeResponse!.write(chunk),
    finish: (chunk: string) => activeResponse!.end(chunk),
    disconnect: () => activeResponse!.destroy(),
    cancelled: () => cancelled,
    close: () => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); })
  };
}

test('shows complete CSV records before the HTTP body ends and preserves the reading position', async ({ page }) => {
  const rows = (first: number, count: number) => Array.from({ length: count }, (_, index) =>
    `Entry ${first + index},completed record from the HTTP stream\r\n`).join('');
  const server = await serveHeldCsv(rows(1, 220) + 'Split row,"unfinished');
  try {
    await page.goto(`./?url=${encodeURIComponent(server.url)}&lang=en`);
    const grid = page.locator('.xlsxv-grid');
    const table = grid.locator('table');
    const status = page.locator('.wb-status');
    await expect(grid.getByText('Entry 1', { exact: true })).toBeInViewport();
    await expect(status).toHaveText('Opening file…');
    await expect(page.locator('.pptxv-overlay.is-progress')).toBeVisible();
    await expect(table).toHaveAttribute('aria-rowcount', '221');
    const before = await grid.evaluate(grid => { grid.scrollTop = 2600; return grid.scrollTop; });
    const readingRow = grid.getByText('Entry 110', { exact: true });
    await expect(readingRow).toBeInViewport();
    await readingRow.evaluate(cell => { cell.dataset.existingCell = 'true'; });
    const oldHeight = await grid.evaluate(grid => grid.scrollHeight);

    server.write(' continuation"\r\n' + rows(222, 60));
    await expect(table).toHaveAttribute('aria-rowcount', '282');
    expect(await grid.evaluate(grid => grid.scrollHeight)).toBeGreaterThan(oldHeight);
    await expect(readingRow).toHaveAttribute('data-existing-cell', 'true');

    server.write(rows(282, 168)
      + 'wide row,' + Array.from({ length: 30 }, (_, index) => `Column ${index + 2}`).join(',') + '\r\n');
    await expect(table).toHaveAttribute('aria-rowcount', '451');
    await expect(table).toHaveAttribute('aria-colcount', '32');
    await expect(status).toHaveText('Opening file…');
    expect(await grid.evaluate((grid, top) => Math.abs(grid.scrollTop - top), before)).toBeLessThanOrEqual(1);
    await expect(readingRow).toBeInViewport();
    expect(await table.locator('tbody tr[aria-rowindex]').count()).toBeLessThanOrEqual(100);

    await grid.evaluate(grid => { grid.scrollTop = 5700; });
    await expect(grid.getByText('unfinished continuation', { exact: true })).toBeInViewport();
    await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
    await expect(grid.getByText('Column 31', { exact: true })).toBeInViewport();
    const tail = await grid.evaluate(grid => ({ top: grid.scrollTop, left: grid.scrollLeft }));
    server.finish('Final record,from EOF');
    await expect(status).toHaveText('Preview ready');
    await expect(table).toHaveAttribute('aria-rowcount', '452');
    await expect(page.locator('.pptxv-overlay')).toHaveCount(0);
    expect(await grid.evaluate(grid => ({ top: grid.scrollTop, left: grid.scrollLeft }))).toEqual(tail);
    await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = 0; });
    await expect(grid.getByText('Final record', { exact: true })).toBeInViewport();
  } finally { await server.close(); }
});

test('cancels a remote CSV body after the first rows render and the file is replaced', async ({ page }) => {
  const server = await serveHeldCsv('Streamed,1\r\nStale,"incomplete');
  try {
    await page.goto(`./?url=${encodeURIComponent(server.url)}&lang=en`);
    await expect(page.locator('.xlsxv-grid')).toContainText('Streamed');
    await expect(page.locator('.xlsxv-grid')).not.toContainText('Stale');
    await page.locator('.wb-upload input[type=file]').setInputFiles({
      name: 'replacement.csv', mimeType: 'text/csv', buffer: Buffer.from('Current,42')
    });
    await expect(page.locator('.xlsxv-grid')).toContainText('Current');
    await expect(page.locator('.xlsxv-grid')).not.toContainText('Streamed');
    await expect.poll(server.cancelled).toBe(true);
    await expect(page.getByRole('alert')).toHaveCount(0);
  } finally { await server.close(); }
});

test('preserves the logical CSV reading row when the growing grid exceeds the browser scroll limit', async ({ page }) => {
  await page.goto('./?view=preview&format=csv&lang=en');
  await expect(page.locator('.xlsxv-grid .xlsxv-table')).toBeVisible();
  const moduleUrl = new URL(`@fs${resolve('packages/xlsx/src/table.ts')}`, page.url()).href;
  const state = await page.evaluate(async url => {
    const { SheetRowWindow } = await import(/* @vite-ignore */ url);
    const grid = document.createElement('div');
    grid.className = 'xlsxv-grid';
    grid.style.cssText = 'position:fixed;top:0;left:0;width:480px;height:360px;overflow:auto';
    document.body.append(grid);
    const sheet = { id: 'csv', name: 'CSV', rowCount: 500_000, columnCount: 1, rows: [] };
    const view = new SheetRowWindow(sheet, grid);
    const middleRow = () => {
      const y = grid.getBoundingClientRect().top + grid.clientHeight / 2;
      const row = [...view.table.tBodies[0].rows].find(row => {
        const bounds = row.getBoundingClientRect();
        return row.hasAttribute('aria-rowindex') && bounds.top <= y && bounds.bottom > y;
      });
      return Number(row?.getAttribute('aria-rowindex'));
    };
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    grid.scrollTop = 6_000_000;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const before = middleRow();
    sheet.rowCount = 4_000_000;
    view.refreshCsvDimensions();
    const after = middleRow();
    const height = grid.scrollHeight;
    view.destroy();
    grid.remove();
    return { before, after, height };
  }, moduleUrl);
  expect(state.before).toBeGreaterThan(100_000);
  expect(state.height).toBeLessThan(4_000_000 * 26);
  expect(Math.abs(state.after - state.before), JSON.stringify(state)).toBeLessThanOrEqual(1);
});

test('clears previously shown CSV rows if the body fails', async ({ page }) => {
  const server = await serveHeldCsv('Streamed,1\r\nStale,"incomplete');
  try {
    await page.goto(`./?url=${encodeURIComponent(server.url)}&lang=en`);
    await expect(page.locator('.xlsxv-grid')).toContainText('Streamed');
    server.disconnect();
    await expect(page.locator('.wb-status')).toHaveText('Preview failed');
    await expect(page.locator('.xlsxv-grid .xlsxv-table')).toHaveCount(0);
  } finally { await server.close(); }
});

test('shows a local CSV before the last Blob slice finishes and reaches the last row', async ({ page }) => {
  const rows = 12_000, blockSize = 256 * 1024;
  const buffer = Buffer.from(Array.from({ length: rows }, (_, index) =>
    `Entry ${index + 1},"quoted ""value""\nwith a newline",${index}\r\n`).join(''));
  await page.addInitScript(size => {
    const reads = { whole: 0, slices: [] as number[] };
    const waiting = new WeakSet<Blob>();
    let resume!: () => void;
    const complete = new Promise<void>(resolve => { resume = resolve; });
    Object.assign(window, { csvBlobReads: reads, resumeCsvRead: resume });
    const slice = Blob.prototype.slice;
    Blob.prototype.slice = function (start, end, type) {
      const result = slice.call(this, start, end, type);
      if (this.size === size) {
        reads.slices.push(result.size);
        if (end !== undefined && end >= size) waiting.add(result);
      }
      return result;
    };
    for (const method of ['arrayBuffer', 'text'] as const) {
      const read = Blob.prototype[method];
      Object.defineProperty(Blob.prototype, method, { value(this: Blob) {
        if (this.size === size) reads.whole++;
        if (waiting.has(this)) return complete.then(() => read.call(this));
        return read.call(this);
      } });
    }
  }, buffer.length);
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({ name: 'large.csv', mimeType: 'text/csv', buffer });
  const grid = page.locator('.xlsxv-grid');
  await expect(grid).toContainText('Entry 1');
  await expect(page.locator('.wb-status')).toHaveText('Opening file…');
  const partialRows = Number(await grid.locator('table').getAttribute('aria-rowcount'));
  expect(partialRows).toBeGreaterThan(1);
  expect(partialRows).toBeLessThan(rows + 1);
  await page.evaluate(() => (window as Window & { resumeCsvRead: () => void }).resumeCsvRead());
  await expect(page.locator('.wb-status')).toHaveText('Preview ready');
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; });
  await expect(grid.locator(`tr[aria-rowindex="${rows + 1}"] [aria-colindex="2"]`)).toHaveText(`Entry ${rows}`);
  const reads = await page.evaluate(() => (window as Window & { csvBlobReads: { whole: number; slices: number[] } }).csvBlobReads);
  expect(reads.whole).toBe(0);
  expect(reads.slices).toEqual(Array.from({ length: Math.ceil(buffer.length / blockSize) },
    (_, index) => Math.min(blockSize, buffer.length - index * blockSize)));
});

for (const failure of ['404', 'CORS']) {
  test(`reports remote CSV ${failure} failures from the workbook driver`, async ({ page }) => {
    const url = 'https://files.example.test/missing.csv?signature=opaque';
    await page.route(url, route => failure === '404' ? route.fulfill({ status: 404 }) : route.abort('failed'));
    await page.goto(`./?url=${encodeURIComponent(url)}&lang=en`);
    await expect(page.getByRole('alert')).toContainText(failure);
    await expect(page.getByRole('alert')).not.toContainText('signature');
    await expect(page.locator('.wb-status')).toHaveText('Preview failed');
  });
}
