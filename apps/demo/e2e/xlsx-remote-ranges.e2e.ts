import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { createLargeFirstWorksheetFixture, createRangeWorkbookFixture, secondWorksheetMarker, thirdWorksheetMarker, workbookAttachmentText } from '../../../packages/xlsx/test/fixtures/range-workbook.mjs';
import { createWorkbookFixture } from '../../../packages/xlsx/test/fixtures/workbook.mjs';
import { createMergeBatchWorkbook } from '../../../packages/xlsx/test/fixtures/merge-batch-workbook.mjs';
import { createRepeatedConditionalWorkbook } from '../../../packages/xlsx/test/fixtures/repeated-conditional-workbook.mjs';
import { createDeferredSharedStringsWorkbook, deferredSharedString, laterWorksheetBatch, oversizedSharedStringValue } from '../../../packages/xlsx/test/fixtures/shared-strings.mjs';
import { serveZipFixture } from './zip-range-fixture';

const workbookType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const formulaResult = (page: Page) => page.locator('.xlsxv-grid tr[aria-rowindex="2"] .xlsxv-cell[aria-colindex="4"]');
const entryRangeSize = 1024 * 1024;

function streamedWorksheetPayload(bytes: Buffer, sheet: number | string = 2) {
  const name = typeof sheet === 'number' ? `sheet${sheet}` : sheet;
  return streamedZipPayload(bytes, `xl/worksheets/${name}.xml`);
}

function streamedZipPayload(bytes: Buffer, path: string) {
  const header = bytes.indexOf(path) - 30;
  expect(bytes.readUInt32LE(header)).toBe(0x04034b50);
  const start = header + 30 + bytes.readUInt16LE(header + 26) + bytes.readUInt16LE(header + 28);
  const size = bytes.readUInt32LE(header + 18);
  expect(size).toBeGreaterThan(2 * entryRangeSize);
  return { start, size };
}

test('reads remote XLSX parts by ranges, evaluates cross-sheet formulas and opens attachments on demand', async ({ page }, testInfo) => {
  const bytes = await createRangeWorkbookFixture(), server = await serveZipFixture(bytes, 'xlsx');
  const marker = bytes.indexOf(workbookAttachmentText);
  expect(marker).toBeGreaterThan(0);
  const attachmentRequested = () => server.requests.some(request => request.begin <= marker && request.end > marker);
  try {
    await page.goto(`./?url=${encodeURIComponent(server.url)}&lang=en`);
    await expect(formulaResult(page)).toHaveText('28');
    const attachments = page.locator('.filens-attachments');
    await expect(attachments).toBeVisible();
    expect(server.requests[0].range).toBe('bytes=0-0');
    expect(server.requests.slice(1).every(request => request.range && request.range !== 'bytes=0-0')).toBe(true);
    expect(attachmentRequested()).toBe(false);
    const startupBytes = server.requests.reduce((total, request) => total + request.sent, 0);
    expect(startupBytes).toBeLessThan(bytes.length / 8);
    await testInfo.attach('Workbook startup transfer', { body: JSON.stringify({ startupBytes, fileBytes: bytes.length }), contentType: 'application/json' });

    await page.locator('.xlsxv-sheet-tabs').getByRole('button', { name: 'Second', exact: true }).click();
    await expect(page.locator('.xlsxv-grid')).toContainText(secondWorksheetMarker);
    await attachments.locator('summary').click();
    await attachments.getByRole('button', { name: 'notes.txt', exact: true }).click();
    await expect(page.locator('.filens-attachment-preview')).toContainText(workbookAttachmentText);
    expect(attachmentRequested()).toBe(true);
    expect(server.requests.every(request => request.range)).toBe(true);
    await page.getByRole('button', { name: 'Back to document', exact: true }).click();
    await expect(page.locator('.xlsxv-grid')).toContainText(secondWorksheetMarker);
  } finally { await server.close(); }
});

test('reads a large compressed worksheet in ranges and resolves its final-row dependency', async ({ page }) => {
  const bytes = await createRangeWorkbookFixture({ streamed: true }), server = await serveZipFixture(bytes, 'xlsx');
  const { start, size } = streamedWorksheetPayload(bytes);
  try {
    await page.goto(`./?url=${encodeURIComponent(server.url)}&lang=en`);
    await expect(formulaResult(page)).toHaveText('28');
    const ranges = server.requests.filter(request => request.begin >= start && request.begin < start + size);
    expect(ranges.map(request => request.begin)).toEqual([start, start + entryRangeSize, start + 2 * entryRangeSize]);
    expect(ranges.map(request => request.sent)).toEqual([entryRangeSize, entryRangeSize, size - 2 * entryRangeSize]);
    expect(server.requests.every(request => request.range)).toBe(true);
  } finally { await server.close(); }
});

for (const ending of ['complete', 'fail', 'replace', 'oversized', 'replace-oversized', 'multiple-batches', 'replace-multiple-batches']) test(`shows ready rows before a shared string range ends (${ending})`, async ({ page }) => {
  const multipleBatches = ending.endsWith('multiple-batches'), tailRow = multipleBatches ? 6 : 4;
  const bytes = Buffer.from(await createDeferredSharedStringsWorkbook({ oversized: ending.endsWith('oversized'), multipleBatches }));
  const { start, size } = streamedZipPayload(bytes, 'xl/catalog-strings.xml');
  const server = await serveZipFixture(bytes, 'xlsx');
  const waiting = () => server.requests.find(request => request.begin === start + entryRangeSize);
  server.pause(start + entryRangeSize);
  const grid = page.locator('.xlsxv-grid'), state = page.locator('.wb-status');
  const cell = (row: number, col: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${col + 1}"]`);
  try {
    await page.goto(`./?url=${encodeURIComponent(server.url)}&lang=en`);
    await expect.poll(() => waiting()?.sent).toBe(0);
    await expect(state).toHaveText('Opening file…');
    await expect(cell(1, 1)).toHaveText('First & 中');
    await expect(cell(1, 2)).toHaveText('17');
    await expect(cell(1, 3)).toHaveAttribute('aria-busy', 'true');
    await expect(cell(2, 1).getByText('Shared rich text')).toHaveCSS('color', 'rgb(51, 102, 153)');
    await expect(cell(3, 1)).toHaveText('Inline rich text');
    if (multipleBatches) {
      await expect(cell(5, 1)).toHaveText('Shared rich text');
      await expect(cell(5, 2)).toHaveText(laterWorksheetBatch);
    }
    await expect(cell(tailRow, 1)).toHaveCount(0);
    expect(waiting()?.sent).toBe(0);
    if (ending === 'fail') {
      server.disconnect();
      await expect(state).toHaveText('Preview failed');
      await expect(grid.locator('table')).toHaveCount(0);
      await expect(page.locator('.xlsxv-sheet-tabs button')).toHaveCount(0);
    } else if (ending.startsWith('replace')) {
      await page.locator('.wb-upload input[type=file]').setInputFiles({
        name: 'replacement.xlsx', mimeType: workbookType, buffer: Buffer.from(await createWorkbookFixture()),
      });
      await expect(formulaResult(page)).toHaveText('21');
      await expect.poll(() => waiting()?.cancelled).toBe(true);
      expect(server.requests.some(request => request.begin === start + 2 * entryRangeSize)).toBe(false);
    } else {
      server.resume();
      await expect(state).toHaveText('Preview ready');
      await expect(cell(tailRow, 1)).toHaveText(deferredSharedString);
      await expect(cell(1, 3)).toHaveText(String(deferredSharedString.length));
      if (ending === 'oversized') {
        await expect(cell(4, 4).getByText(oversizedSharedStringValue)).toHaveCSS('color', 'rgb(51, 102, 153)');
      }
      const ranges = Array.from({ length: Math.ceil(size / entryRangeSize) }, (_, index) => Math.min(entryRangeSize, size - index * entryRangeSize));
      expect(server.requests.filter(request => request.begin >= start && request.end <= start + size).map(request => request.sent)).toEqual(ranges);
      await grid.evaluate(el => { el.scrollTop = el.scrollHeight; el.scrollLeft = el.scrollWidth; });
      await expect(cell(1048576, 16384)).toHaveText(deferredSharedString);
      await expect(cell(1048576, 16384)).toBeInViewport();
    }
  } finally { await server.close(); }
});

for (const frozen of [false, true]) for (const userScrolled of [false, true]) test(`retains the XLSX origin through range loading (frozen=${frozen}, user scroll=${userScrolled})`, async ({ page }) => {
  const bytes = await createLargeFirstWorksheetFixture({ prefixed: true, ...(frozen ? { frozenOrigin: 'B3000' } : { viewOrigin: 'AD3000' }) });
  const server = await serveZipFixture(bytes, 'xlsx');
  const { start } = streamedWorksheetPayload(bytes, 1);
  server.pause(start + entryRangeSize);
  const grid = page.locator('.xlsxv-grid');
  const row = (r: number) => grid.locator(`tr[aria-rowindex="${r + 1}"]`);
  const pinned = row(2);
  const gap = (target: number) => row(target).evaluate((element, frozen) => {
    const table = element.closest('table')!;
    const header = frozen ? table.tBodies[0] : table.querySelector('.xlsxv-corner')!;
    return element.getBoundingClientRect().top - header.getBoundingClientRect().bottom;
  }, frozen);
  try {
    await page.goto(`./?url=${encodeURIComponent(server.url)}&lang=en`);
    await expect.poll(() => server.requests.find(request => request.begin === start + entryRangeSize)?.sent).toBe(0);
    await expect(page.locator('.wb-status')).toHaveText('Opening file…');
    if (frozen) await expect(pinned).toBeInViewport();
    await expect(row(3000)).toHaveCount(0);
    let readingGap = 0;
    if (userScrolled) {
      await grid.evaluate(element => { element.scrollTop = 1300; });
      await expect(row(54)).toBeInViewport();
      readingGap = await gap(54);
    }
    server.resume();
    await expect(page.locator('.wb-status')).toHaveText('Preview ready');
    if (frozen) await expect(pinned).toBeInViewport();
    const readingRow = userScrolled ? 54 : 3000;
    await expect.poll(async () => Math.abs(await gap(readingRow) - readingGap)).toBeLessThan(4);
    if (!frozen) {
      const target = row(readingRow).locator('td[aria-colindex="31"]');
      await expect.poll(() => target.evaluate(cell => {
        const corner = cell.closest('table')!.querySelector('.xlsxv-corner')!;
        return Math.abs(cell.getBoundingClientRect().left - corner.getBoundingClientRect().right);
      })).toBeLessThan(4);
    }
  } finally { await server.close(); }
});

for (const prefixed of [false, true]) test(`extends the first worksheet while its later ranges are still pending (prefixed=${prefixed})`, async ({ page }, testInfo) => {
  const bytes = await createLargeFirstWorksheetFixture({ prefixed }), server = await serveZipFixture(bytes, 'xlsx');
  const { start, size } = streamedWorksheetPayload(bytes, 1);
  server.pause(start + entryRangeSize);
  const grid = page.locator('.xlsxv-grid');
  const held = () => server.requests.find(request => request.begin === start + entryRangeSize);
  try {
    await page.goto(`./?url=${encodeURIComponent(server.url)}&lang=en`);
    await expect.poll(() => held()?.sent).toBe(0);
    await grid.evaluate(() => new Promise(requestAnimationFrame));
    await expect(page.locator('.wb-status')).toHaveText('Opening file…');
    await expect(grid.getByText('First 1', { exact: true })).toBeInViewport();
    await expect(grid.getByText('First 1', { exact: true })).toHaveCSS('color', 'rgb(51, 102, 153)');
    await expect(formulaResult(page)).toHaveText('…');
    await expect(formulaResult(page)).toHaveAttribute('aria-busy', 'true');
    await expect(grid.locator('tr[aria-rowindex="2"] td[aria-colindex="5"]')).toHaveText('41');
    await expect(grid.locator('tr[aria-rowindex="46"]')).toHaveCount(0);
    await expect(grid.locator('[data-merge-ref="A3"]')).toHaveCount(0);
    expect(server.requests.filter(request => request.begin >= start && request.begin < start + size)
      .map(request => request.sent)).toEqual([entryRangeSize, 0]);

    await grid.evaluate(element => { element.scrollTop = 1300; });
    const reading = grid.getByText('First 54', { exact: true });
    const offset = () => reading.evaluate(cell => cell.getBoundingClientRect().top - cell.closest('.xlsxv-grid')!.getBoundingClientRect().top);
    await expect(reading).toBeInViewport();
    const originalOffset = await offset();
    const rowCount = async () => Number(await grid.locator('table').getAttribute('aria-rowcount')) - 1;
    const firstRows = await rowCount();
    const finalRange = start + 2 * entryRangeSize;
    server.resume(finalRange);
    await expect.poll(() => server.requests.find(request => request.begin === finalRange)?.sent).toBe(0);
    await grid.evaluate(() => new Promise(requestAnimationFrame));
    await expect(page.locator('.wb-status')).toHaveText('Opening file…');
    await expect.poll(rowCount).toBeGreaterThan(firstRows);
    expect(Math.abs(await offset() - originalOffset)).toBeLessThan(2);
    const laterRows = await rowCount();
    await grid.evaluate(element => { element.scrollTop = element.scrollHeight; });
    const addedRow = grid.locator(`tr[aria-rowindex="${laterRows + 1}"] td[aria-colindex="2"]`);
    await expect(addedRow).toHaveText(/^[A-Za-z0-9+/]{1024}$/);
    await expect(addedRow).toBeInViewport();
    await grid.evaluate((element, rows) => { element.scrollTop = element.scrollHeight * 899 / rows; }, laterRows);
    await expect(grid.locator('tr[aria-rowindex="901"] td[aria-colindex="3"]')).toHaveText('North & <South> 中😃');
    await testInfo.attach('Progressive worksheet rows', {
      body: JSON.stringify({ firstRows, laterRows, worksheetBytesRead: 2 * entryRangeSize, sheetCompressedBytes: size }),
      contentType: 'application/json'
    });
    await grid.evaluate(element => { element.scrollTop = 1300; });
    await expect(reading).toBeInViewport();
    server.resume();
    await expect(page.locator('.wb-status')).toHaveText('Preview ready');
    await expect(page.locator('.xlsxv-sheet-tabs button')).toHaveCount(1);
    await expect(reading).toBeInViewport();
    // WebKit may compress the final Excel row track, so compare the row's position in the grid.
    expect(Math.abs(await offset() - originalOffset)).toBeLessThan(2);
    await grid.evaluate(element => { element.scrollTop = 0; });
    await expect(grid.locator('[data-merge-ref="A3"]')).toHaveText('First 3');
    await expect(formulaResult(page)).toHaveText('28');
    await expect(formulaResult(page)).toHaveCSS('background-color', 'rgb(0, 255, 0)');
    await grid.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(grid.locator('tr[aria-rowindex="1048577"] td[aria-colindex="3"]')).toHaveText('21');
    await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
  } finally { await server.close(); }
});

test('shows an oversized first XLSX row before a later HTTP range arrives', async ({ page }) => {
  const bytes = await createLargeFirstWorksheetFixture({ wideFirstRow: true }), server = await serveZipFixture(bytes, 'xlsx');
  const { start } = streamedWorksheetPayload(bytes, 1);
  const offset = start + entryRangeSize;
  const held = () => server.requests.find(request => request.begin <= offset && offset < request.end);
  server.pause(offset);
  const grid = page.locator('.xlsxv-grid'), status = page.locator('.wb-status');
  try {
    await page.goto(`./?url=${encodeURIComponent(server.url)}&lang=en`);
    await expect.poll(() => held()?.sent).toBe(0);
    await expect(grid.getByText('First 1', { exact: true })).toBeInViewport();
    await expect(formulaResult(page)).toHaveAttribute('aria-busy', 'true');
    await expect(status).toHaveText('Opening file…');
    expect(held()?.begin).toBe(offset);
    server.resume();
    await expect(status).toHaveText('Preview ready');
    await expect(formulaResult(page)).toHaveText('28');
    await expect(formulaResult(page)).toHaveCSS('background-color', 'rgb(0, 255, 0)');
    await grid.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(grid.locator('tr[aria-rowindex="1048577"] td[aria-colindex="3"]')).toHaveText('21');
  } finally { await server.close(); }
});

for (const [prefixed, separateGroups] of [[false, false], [false, true], [true, true]]) test(prefixed
  ? 'cancels pending large XLSX conditional metadata when replaced'
  : `shows sparse rows while ${separateGroups ? 'many small' : 'large'} XLSX conditional groups are pending without reading the sheet twice`, async ({ page }) => {
  const bytes = Buffer.from(await createRepeatedConditionalWorkbook(24_000, { storeWorksheet: true, prefixed, linkedBar: true, separateGroups }));
  const server = await serveZipFixture(bytes, 'xlsx');
  const { start, size } = streamedWorksheetPayload(bytes, 's1');
  const final = start + Math.floor((size - 1) / entryRangeSize) * entryRangeSize;
  const ranges = () => server.requests.filter(request => request.begin >= start && request.begin < start + size);
  const waiting = () => ranges().find(request => request.begin === final);
  server.pause(final);
  try {
    await page.goto(`./?url=${encodeURIComponent(server.url)}&lang=en`);
    await expect.poll(() => waiting()?.sent).toBe(0);
    const grid = page.locator('.xlsxv-grid');
    const at = (row: number, column: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
    await expect(page.locator('.wb-status')).toHaveText('Opening file…');
    await expect(at(1, 1)).toHaveText('4');
    await expect(at(1, 1)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await grid.evaluate(element => { element.scrollTop = element.scrollHeight; element.scrollLeft = element.scrollWidth; });
    const last = at(1_048_576, 16_384);
    await expect(last).toHaveText('9');

    if (prefixed) {
      await page.locator('.wb-upload input[type=file]').setInputFiles({
        name: 'replacement.txt', mimeType: 'text/plain', buffer: Buffer.from('Replacement document')
      });
      await expect.poll(() => waiting()?.cancelled).toBe(true);
      await expect(page.locator('.wb-preview-stage')).toContainText('Replacement document');
      await expect(grid).toHaveCount(0);
      return;
    }
    server.resume();
    await expect(page.locator('.wb-status')).toHaveText('Preview ready');
    await expect(last).toHaveText('9.0');
    await expect(last).toHaveCSS('background-color', 'rgb(255, 205, 210)');
    await expect(last.locator('.xlsxv-data-bar-fill')).toHaveCSS('background-color', 'rgb(0, 255, 0)');
    await expect(last).toBeInViewport();
    const blocks = Array.from({ length: Math.ceil(size / entryRangeSize) }, (_, index) => start + index * entryRangeSize);
    expect(ranges().map(range => range.begin)).toEqual(blocks);
    expect(ranges().reduce((total, range) => total + range.sent, 0)).toBe(size);
  } finally { await server.close(); }
});

test('clears the first worksheet rows when the following range fails', async ({ page }) => {
  const bytes = await createLargeFirstWorksheetFixture(), server = await serveZipFixture(bytes, 'xlsx');
  const { start } = streamedWorksheetPayload(bytes, 1);
  server.pause(start + entryRangeSize);
  try {
    await page.goto(`./?url=${encodeURIComponent(server.url)}&lang=en`);
    await expect.poll(() => server.requests.find(request => request.begin === start + entryRangeSize)?.sent).toBe(0);
    await expect(page.locator('.xlsxv-grid').getByText('First 1', { exact: true })).toBeInViewport();
    server.disconnect();
    await expect(page.locator('.wb-status')).toHaveText('Preview failed');
    await expect(page.locator('.xlsxv-grid .xlsxv-table')).toHaveCount(0);
    await expect(page.locator('.xlsxv-sheet-tabs button')).toHaveCount(0);
  } finally { await server.close(); }
});

test('applies large trailing XLSX merge metadata in place after the final HTTP range', async ({ page }) => {
  const bytes = Buffer.from(await createMergeBatchWorkbook(75_000, { stored: true, prefixed: true }));
  const server = await serveZipFixture(bytes, 'xlsx');
  const { start, size } = streamedWorksheetPayload(bytes, 's1');
  const final = start + Math.floor((size - 1) / entryRangeSize) * entryRangeSize;
  const ranges = () => server.requests.filter(request => request.begin >= start && request.begin < start + size);
  server.pause(final);
  try {
    await page.goto(`./?url=${encodeURIComponent(server.url)}&lang=en`);
    await expect.poll(() => ranges().find(request => request.begin === final)?.sent).toBe(0);
    const grid = page.locator('.xlsxv-grid');
    await expect(page.locator('.wb-status')).toHaveText('Opening file…');
    await expect(grid.locator('tr[aria-rowindex="2"] td[aria-colindex="3"]')).toHaveText('4');
    await grid.evaluate(element => { element.scrollTop = element.scrollHeight; element.scrollLeft = element.scrollWidth; });
    const last = grid.locator('tr[aria-rowindex="1048576"] td[aria-colindex="16384"]');
    await expect(last).toHaveText('8');
    await expect(last).toBeInViewport();
    await expect(last).not.toHaveAttribute('data-merge-ref');

    server.resume();
    await expect(page.locator('.wb-status')).toHaveText('Preview ready');
    await expect(last).toHaveAttribute('data-merge-ref', 'XFC1048575');
    await expect(last).toHaveAttribute('rowspan', '2');
    await expect(last).toHaveAttribute('colspan', '2');
    await expect(last).toHaveText('8');
    await expect(last).toBeInViewport();
    await expect(last).toHaveCSS('background-color', 'rgb(204, 221, 255)');
    const blocks = Array.from({ length: Math.ceil(size / entryRangeSize) }, (_, index) => start + index * entryRangeSize);
    expect(ranges().map(range => range.begin)).toEqual(blocks);
    expect(ranges().reduce((total, range) => total + range.sent, 0)).toBe(size);
  } finally { await server.close(); }
});

for (const rtl of [false, true]) test(`retains the reading column in an extended ${rtl ? 'RTL' : 'LTR'} XLSX grid after the remaining ranges load`, async ({ page }) => {
  await page.setViewportSize({ width: 1040, height: 840 });
  const bytes = await createLargeFirstWorksheetFixture({ rotatedTitle: true, rightToLeft: rtl, prefixed: rtl });
  const server = await serveZipFixture(bytes, 'xlsx');
  const { start } = streamedWorksheetPayload(bytes, 1);
  const range = start + entryRangeSize;
  server.pause(range);
  const grid = page.locator('.xlsxv-grid'), title = grid.locator('tr[aria-rowindex="111"] .xlsxv-rotated-overflow');
  try {
    await page.goto(`./?url=${encodeURIComponent(server.url)}&lang=en`);
    await expect.poll(() => server.requests.find(request => request.begin === range)?.sent).toBe(0);
    await expect(grid.getByText('First 1', { exact: true })).toBeInViewport();
    await expect(grid).toHaveCSS('direction', rtl ? 'rtl' : 'ltr');
    await expect(title).toHaveCount(0);
    await grid.evaluate(el => { el.scrollTop = 26 * 107; });
    await expect(title).toContainText('A rotated title');
    const direction = rtl ? -1 : 1;
    const before = await grid.evaluate((el, sign) => {
      el.scrollLeft = sign * (el.scrollWidth - el.clientWidth) / 2;
      return el.scrollLeft;
    }, direction);
    expect(before * direction).toBeGreaterThan(1000);
    await expect(title.locator('..')).toHaveClass(/xlsxv-column-spacer/);
    server.resume();
    await expect(page.locator('.wb-status')).toHaveText('Preview ready');
    await expect(grid).toHaveCSS('direction', rtl ? 'rtl' : 'ltr');
    await expect(title).toBeInViewport();
    await expect.poll(async () => Math.abs(await grid.evaluate(el => el.scrollLeft) - before)).toBeLessThan(2);
  } finally { await server.close(); }
});

test('shows parsed sheets while a later XLSX range is pending and calculates only after loading', async ({ page }) => {
  const bytes = await createRangeWorkbookFixture({ progressive: true }), server = await serveZipFixture(bytes, 'xlsx');
  const marker = bytes.indexOf(thirdWorksheetMarker);
  expect(marker).toBeGreaterThan(0);
  server.pause(marker);
  const held = () => server.requests.find(request => request.begin <= marker && request.end > marker);
  try {
    await page.goto(`./?url=${encodeURIComponent(server.url)}&lang=en`);
    await expect.poll(() => held()?.sent).toBe(0);
    const tabs = page.locator('.xlsxv-sheet-tabs');
    const grid = page.locator('.xlsxv-grid');
    const cached = grid.locator('tr[aria-rowindex="2"] .xlsxv-cell[aria-colindex="5"]');
    await expect(grid.getByText('First 1', { exact: true })).toBeInViewport();
    await expect(page.locator('.wb-status')).toHaveText('Opening file…');
    await expect(page.locator('.pptxv-overlay.is-progress')).toBeVisible();
    await expect(formulaResult(page)).toHaveText('…');
    await expect(formulaResult(page)).toHaveAttribute('aria-busy', 'true');
    await expect(formulaResult(page)).not.toHaveCSS('background-color', 'rgb(0, 255, 0)');
    await expect(cached).toHaveText('101');
    await expect(tabs.getByRole('button', { name: 'Third', exact: true })).toHaveCount(0);
    await expect(page.locator('.filens-attachments')).toHaveCount(0);

    const second = tabs.getByRole('button', { name: 'Second', exact: true });
    await second.click();
    await expect(grid.getByText(secondWorksheetMarker, { exact: true })).toBeInViewport();
    await expect(formulaResult(page)).toHaveText('…');
    const scrollTop = await grid.evaluate(grid => { grid.scrollTop = 1300; return grid.scrollTop; });
    await expect(grid.getByText('Second 54', { exact: true })).toBeInViewport();

    server.resume();
    await expect(page.locator('.wb-status')).toHaveText('Preview ready');
    await expect(second).toHaveClass(/is-active/);
    await expect(grid.getByText('Second 54', { exact: true })).toBeInViewport();
    expect(await grid.evaluate(grid => grid.scrollTop)).toBe(scrollTop);
    await expect(tabs.getByRole('button', { name: 'Third', exact: true })).toBeVisible();
    await grid.evaluate(grid => { grid.scrollTop = 0; });
    await expect(formulaResult(page)).toHaveText('21');
    await tabs.getByRole('button', { name: 'First', exact: true }).click();
    await expect(formulaResult(page)).toHaveText('28');
    await expect(formulaResult(page)).not.toHaveAttribute('aria-busy', 'true');
    await expect(formulaResult(page)).toHaveCSS('background-color', 'rgb(0, 255, 0)');
    await expect(cached).toHaveText('101');
    await expect(page.locator('.filens-attachments')).toBeVisible();
  } finally { await server.close(); }
});

for (const switchTab of [false, true]) test(`loads the saved XLSX tab before earlier tabs (switch tab=${switchTab})`, async ({ page }) => {
  const bytes = await createRangeWorkbookFixture({ progressive: true, activeTab: 1 });
  const firstOffset = bytes.indexOf('First 1</t>'), lastOffset = bytes.indexOf(thirdWorksheetMarker);
  expect(firstOffset).toBeGreaterThan(0);
  expect(lastOffset).toBeGreaterThan(firstOffset);
  const server = await serveZipFixture(bytes, 'xlsx');
  const held = (offset: number) => server.requests.find(request => request.begin <= offset && request.end > offset);
  server.pause(firstOffset);
  const grid = page.locator('.xlsxv-grid'), status = page.locator('.wb-status');
  const tabs = page.locator('.xlsxv-sheet-tabs button');
  const first = tabs.filter({ hasText: 'First' }), second = tabs.filter({ hasText: 'Second' });
  try {
    await page.goto(`./?url=${encodeURIComponent(server.url)}&lang=en`);
    await expect.poll(() => held(firstOffset)?.sent).toBe(0);
    await expect(status).toHaveText('Opening file…');
    await expect(tabs).toHaveText(['Second']);
    await expect(second).toHaveClass(/is-active/);
    await expect(grid.getByText('Second 54', { exact: true })).toBeInViewport();
    await grid.evaluate(element => { element.scrollTop += 1100; });
    await expect(grid.getByText('Second 100', { exact: true })).toBeInViewport();
    const readingTop = await grid.evaluate(element => element.scrollTop);
    await second.focus();

    server.resume(lastOffset);
    await expect.poll(() => held(lastOffset)?.sent).toBe(0);
    await expect(tabs).toHaveText(['First', 'Second']);
    await expect(second).toBeFocused();
    await second.press('Enter');
    await expect(second).toHaveClass(/is-active/);
    expect(await grid.evaluate(element => element.scrollTop)).toBe(readingTop);
    if (switchTab) {
      await first.click();
      await expect(grid.getByText('First 1', { exact: true })).toBeInViewport();
      await expect(formulaResult(page)).toHaveText('…');
    }

    server.resume();
    await expect(status).toHaveText('Preview ready');
    await expect(tabs).toHaveText(['First', 'Second', 'Third']);
    await expect(switchTab ? first : second).toHaveClass(/is-active/);
    if (switchTab) await expect(formulaResult(page)).toHaveText('28');
    else {
      await expect(grid.getByText('Second 100', { exact: true })).toBeInViewport();
      expect(await grid.evaluate(element => element.scrollTop)).toBe(readingTop);
    }
  } finally { await server.close(); }
});

test('clears the partial XLSX grid if a later worksheet range fails', async ({ page }) => {
  const bytes = await createRangeWorkbookFixture(), server = await serveZipFixture(bytes, 'xlsx');
  const marker = bytes.indexOf(secondWorksheetMarker);
  expect(marker).toBeGreaterThan(0);
  server.pause(marker);
  try {
    await page.goto(`./?url=${encodeURIComponent(server.url)}&lang=en`);
    await expect.poll(() => server.requests.find(request => request.begin <= marker && request.end > marker)?.sent).toBe(0);
    await expect(page.locator('.xlsxv-grid')).toContainText('First 1');
    server.disconnect();
    await expect(page.locator('.wb-status')).toHaveText('Preview failed');
    await expect(page.locator('.xlsxv-grid .xlsxv-table')).toHaveCount(0);
  } finally { await server.close(); }
});

test('cancels a pending compressed worksheet block when the workbook is replaced', async ({ page }) => {
  const bytes = await createRangeWorkbookFixture({ streamed: true }), server = await serveZipFixture(bytes, 'xlsx');
  const { start } = streamedWorksheetPayload(bytes);
  const pendingOffset = start + entryRangeSize;
  server.pause(pendingOffset);
  const worksheetRequest = () => server.requests.find(request => request.begin === pendingOffset);
  try {
    await page.goto(`./?url=${encodeURIComponent(server.url)}&lang=en`);
    await expect.poll(() => worksheetRequest()?.sent).toBe(0);
    expect(server.requests.find(request => request.begin === start)?.sent).toBe(entryRangeSize);
    await expect(page.locator('.xlsxv-grid')).toContainText('First 1');
    await expect(formulaResult(page)).toHaveText('…');
    await page.locator('.wb-upload input[type=file]').setInputFiles({
      name: 'replacement.xlsx', mimeType: workbookType, buffer: Buffer.from(await createWorkbookFixture()),
    });
    await expect(page.locator('.wb-preview-title strong')).toHaveText('replacement.xlsx');
    await expect(formulaResult(page)).toHaveText('21');
    await expect.poll(() => worksheetRequest()?.cancelled).toBe(true);
    expect(server.requests.some(request => request.begin === start + 2 * entryRangeSize)).toBe(false);
    await expect(page.locator('.wb-note.is-error')).toHaveCount(0);
  } finally { await server.close(); }
});

async function pauseLocalZipSlice(page: Page, bytes: Buffer, start: number, size: number, blockedOffset: number) {
  await page.addInitScript(({ archiveSize, start, end, finalBlock }) => {
    const ranges: [number, number][] = [];
    const waiting = new WeakSet<Blob>();
    let resume!: () => void;
    const complete = new Promise<void>(resolve => { resume = resolve; });
    Object.assign(window, { zipSourceRanges: ranges, resumeZipRead: resume });
    const slice = Blob.prototype.slice, read = Blob.prototype.arrayBuffer;
    Blob.prototype.slice = function (first, last, type) {
      const result = slice.call(this, first, last, type);
      if (this.size === archiveSize && first !== undefined && first >= start && first < end && last !== undefined && last <= end) {
        ranges.push([first, last]);
        if (first === finalBlock) waiting.add(result);
      }
      return result;
    };
    Blob.prototype.arrayBuffer = function () {
      return waiting.has(this) ? complete.then(() => read.call(this)) : read.call(this);
    };
  }, { archiveSize: bytes.length, start, end: start + size, finalBlock: blockedOffset });
}

test('shows ready rows while a local shared string slice is pending', async ({ page }) => {
  const bytes = Buffer.from(await createDeferredSharedStringsWorkbook({ multipleBatches: true }));
  const { start, size } = streamedZipPayload(bytes, 'xl/catalog-strings.xml');
  await pauseLocalZipSlice(page, bytes, start, size, start + entryRangeSize);
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({ name: 'shared-catalog.xlsx', mimeType: workbookType, buffer: bytes });
  const grid = page.locator('.xlsxv-grid');
  await expect(grid.getByText('First & 中', { exact: true })).toBeInViewport();
  await expect(grid.getByText(laterWorksheetBatch, { exact: true })).toBeInViewport();
  await expect(grid.getByText(deferredSharedString, { exact: true })).toHaveCount(0);
  await expect(page.locator('.wb-status')).toHaveText('Opening file…');
  await expect.poll(() => page.evaluate(() => (window as Window & { zipSourceRanges: [number, number][] }).zipSourceRanges))
    .toEqual([[start, start + entryRangeSize], [start + entryRangeSize, start + 2 * entryRangeSize]]);
  await page.evaluate(() => (window as Window & { resumeZipRead: () => void }).resumeZipRead());
  await expect(page.locator('.wb-status')).toHaveText('Preview ready');
  await expect(grid.getByText(deferredSharedString, { exact: true })).toBeInViewport();
});

test('opens a partially read later worksheet while its final bounded Blob slice is pending', async ({ page }) => {
  const bytes = await createRangeWorkbookFixture({ streamed: true });
  const { start, size } = streamedWorksheetPayload(bytes);
  await pauseLocalZipSlice(page, bytes, start, size, start + 2 * entryRangeSize);
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({ name: 'streamed.xlsx', mimeType: workbookType, buffer: bytes });
  await expect(page.locator('.xlsxv-grid')).toContainText('First 1');
  await expect(formulaResult(page)).toHaveText('…');
  await expect(page.locator('.wb-status')).toHaveText('Opening file…');
  const selection = page.locator('.xlsxv-sheet-tabs');
  const second = selection.getByRole('button', { name: 'Second', exact: true });
  await second.click();
  const grid = page.locator('.xlsxv-grid');
  await expect(grid.getByText(secondWorksheetMarker, { exact: true })).toBeInViewport();
  await expect.poll(async () => Number(await grid.locator('table').getAttribute('aria-rowcount'))).toBeGreaterThan(1800);
  await expect(page.locator('.wb-status')).toHaveText('Opening file…');
  await page.evaluate(() => (window as Window & { resumeZipRead: () => void }).resumeZipRead());
  await expect(page.locator('.wb-status')).toHaveText('Preview ready');
  await expect(second).toHaveClass(/is-active/);
  await expect(grid.getByText(secondWorksheetMarker, { exact: true })).toBeInViewport();
  await selection.getByRole('button', { name: 'First', exact: true }).click();
  await expect(formulaResult(page)).toHaveText('28');
  const ranges = await page.evaluate(() => (window as Window & { zipSourceRanges: [number, number][] }).zipSourceRanges);
  expect(ranges).toEqual([
    [start, start + entryRangeSize],
    [start + entryRangeSize, start + 2 * entryRangeSize],
    [start + 2 * entryRangeSize, start + size],
  ]);
});

for (const prefixed of [false, true]) test(`replaces a partially displayed single-sheet XLSX while its next Blob slice is held (prefixed=${prefixed})`, async ({ page }) => {
  const bytes = await createLargeFirstWorksheetFixture({ prefixed }), { start, size } = streamedWorksheetPayload(bytes, 1);
  await pauseLocalZipSlice(page, bytes, start, size, start + entryRangeSize);
  await page.goto('./?view=preview&lang=en');
  const input = page.locator('.wb-upload input[type=file]');
  await input.setInputFiles({ name: 'large-first.xlsx', mimeType: workbookType, buffer: bytes });
  await expect(formulaResult(page)).toHaveText('…');
  await expect(page.locator('.wb-status')).toHaveText('Opening file…');
  await expect.poll(() => page.evaluate(() => (window as Window & { zipSourceRanges: [number, number][] }).zipSourceRanges))
    .toEqual([[start, start + entryRangeSize], [start + entryRangeSize, start + 2 * entryRangeSize]]);
  await input.setInputFiles({ name: 'replacement.xlsx', mimeType: workbookType, buffer: Buffer.from(await createWorkbookFixture()) });
  await expect(formulaResult(page)).toHaveText('21');
  await page.evaluate(() => (window as Window & { resumeZipRead: () => void }).resumeZipRead());
  await expect(page.locator('.wb-status')).toHaveText('Preview ready');
  await expect(page.locator('.wb-preview-title strong')).toHaveText('replacement.xlsx');
  await expect(formulaResult(page)).toHaveText('21');
  await expect(page.locator('.xlsxv-sheet-tabs button')).toHaveCount(2);
});

test('opens an XLSX upload by Blob slices and keeps its attachment lazy', async ({ page }) => {
  const bytes = await createRangeWorkbookFixture();
  await page.addInitScript(size => {
    const reads = { whole: 0, slices: 0 };
    Object.assign(window, { workbookSourceReads: reads });
    const arrayBuffer = Blob.prototype.arrayBuffer, slice = Blob.prototype.slice;
    Blob.prototype.arrayBuffer = function () {
      if (this.size === size) reads.whole++;
      return arrayBuffer.call(this);
    };
    Blob.prototype.slice = function (...args: Parameters<Blob['slice']>) {
      const result = slice.apply(this, args);
      if (this.size === size) reads.slices += result.size;
      return result;
    };
  }, bytes.length);
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({ name: 'sliced.xlsx', mimeType: workbookType, buffer: bytes });
  await expect(formulaResult(page)).toHaveText('28');
  await expect(page.locator('.filens-attachments')).toBeVisible();
  const reads = await page.evaluate(() => (window as Window & { workbookSourceReads?: { whole: number; slices: number } }).workbookSourceReads!);
  expect(reads.whole).toBe(0);
  expect(reads.slices).toBeGreaterThan(0);
  expect(reads.slices).toBeLessThan(bytes.length / 8);
});

test('reuses a full HTTP response for the XLSX workbook and its attachment list', async ({ page }) => {
  const bytes = await createRangeWorkbookFixture(), server = await serveZipFixture(bytes, 'xlsx', false);
  try {
    await page.goto(`./?url=${encodeURIComponent(server.url)}&lang=en`);
    await expect(formulaResult(page)).toHaveText('28');
    await expect(page.locator('.filens-attachments')).toBeVisible();
    expect(server.requests).toMatchObject([{ range: 'bytes=0-0', sent: bytes.length, cancelled: false }]);
  } finally { await server.close(); }
});

test('opens a remote encrypted XLSX with the Office converter after the range probe', async ({ page }) => {
  const bytes = await readFile('packages/converter-client/test/fixtures/password/agile.xlsx');
  const server = await serveZipFixture(bytes, 'xlsx');
  try {
    await page.goto(`./?url=${encodeURIComponent(server.url)}&lang=zh_CN`);
    const field = page.getByLabel('文档密码', { exact: true });
    await expect(field).toBeVisible();
    await field.fill('wrong');
    await field.press('Enter');
    await expect(page.getByRole('alert')).toContainText('密码不正确，请重试。');
    await field.fill(' filens 密码🔐 ');
    await field.press('Enter');
    await expect(page.locator('.xlsxv-grid')).toContainText('Fixture XLSX workbook');
    expect(server.requests).toMatchObject([{ range: 'bytes=0-0', sent: 1 }, { range: undefined, sent: bytes.length }]);
  } finally { await server.close(); }
});

for (const failure of ['404', 'CORS']) {
  test(`reports ${failure} failures for a remote XLSX source`, async ({ page }) => {
    const source = 'https://files.example.test/missing.xlsx?signature=opaque';
    await page.route(source, route => failure === '404' ? route.fulfill({ status: 404 }) : route.abort('failed'));
    await page.goto(`./?url=${encodeURIComponent(source)}&lang=en`);
    await expect(page.getByRole('alert')).toContainText(failure);
    await expect(page.locator('.wb-preview-title strong')).toHaveText('missing.xlsx');
    await expect(page.locator('.wb-status')).toHaveText('Preview failed');
    await expect(page.getByRole('alert')).not.toContainText('signature');
  });
}
