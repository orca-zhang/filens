import { expect, test } from '@playwright/test';
import { createRotatedOverflowWorkbook, createRotatedWorkbook, createTrailingRotatedOverflowWorkbook } from '../../../packages/xlsx/test/fixtures/rotated-workbook.mjs';
import { countNearbyPixels } from './screenshot-pixels';

test('lays out XLSX angled and stacked text in source cells and clipped merges', async ({ page }) => {
  await page.setViewportSize({ width: 1240, height: 920 });
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({
    name: 'orientation.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createRotatedWorkbook())
  });
  const grid = page.locator('.xlsxv-grid');
  const row = (index: number) => grid.locator(`tbody tr[aria-rowindex="${index + 1}"]`);
  const cell = (r: number, c: number) => row(r).locator(`td[aria-colindex="${c + 1}"]`);
  const value = (r: number, c: number) => cell(r, c).locator('.xlsxv-rotated-value');
  const geometry = (element: Element) => {
    const matrix = new DOMMatrix(getComputedStyle(element).transform);
    return { angle: Math.round(Math.atan2(matrix.b, matrix.a) * 180 / Math.PI), scale: Math.hypot(matrix.a, matrix.b) };
  };
  await expect(value(1, 1)).toHaveText('Upwards');
  await expect.poll(async () => {
    const angles = await Promise.all([1, 2, 3, 4, 7].map(c => value(1, c).evaluate(geometry)));
    return angles.map(({ angle }) => angle);
  }).toEqual([-45, 45, -90, 90, -30]);
  await expect(value(1, 6)).toHaveCount(0);
  await expect(value(1, 8)).toHaveCount(0);
  await expect(value(1, 5)).toHaveText('A中é');
  await expect(value(1, 5)).toHaveCSS('text-orientation', 'upright');
  const glyphs = await value(1, 5).evaluate(element => {
    return Array.from({ length: 3 }, (_, index) => {
      const range = document.createRange();
      range.setStart(element.firstChild!, index);
      range.setEnd(element.firstChild!, index + 1);
      const bounds = range.getBoundingClientRect();
      return { x: bounds.x + bounds.width / 2, y: bounds.y };
    });
  });
  expect(Math.abs(glyphs[0].x - glyphs[1].x)).toBeLessThan(3);
  expect(glyphs[1].y - glyphs[0].y).toBeGreaterThan(8);
  expect(glyphs[2].y - glyphs[1].y).toBeGreaterThan(8);
  await expect.poll(() => row(1).evaluate(el => parseFloat(el.style.height))).toBeGreaterThan(70);

  expect((await row(2).boundingBox())!.height).toBeCloseTo(36, 0);
  await expect(cell(2, 1).locator('.xlsxv-fixed-clip')).toHaveCSS('overflow', 'hidden');
  expect((await value(2, 1).boundingBox())!.height).toBeGreaterThan(36);
  expect((await value(2, 2).evaluate(geometry)).scale).toBeLessThan(1);
  expect((await value(2, 2).boundingBox())!.height).toBeLessThanOrEqual(32.1);
  await expect(value(3, 1)).toHaveCSS('white-space', 'pre-wrap');
  expect(await value(3, 1).evaluate(el => el.clientHeight / parseFloat(getComputedStyle(el).lineHeight))).toBeGreaterThan(3);
  await expect(value(3, 2)).toHaveText('12,345.67');
  await expect(value(3, 3).getByText('run')).toHaveCSS('color', 'rgb(153, 17, 85)');
  await expect(value(3, 3).getByText('run')).toHaveCSS('font-weight', '700');
  const capped = (await row(4).boundingBox())!.height;
  expect(capped).toBeGreaterThan(535);
  expect(capped).toBeLessThanOrEqual(547);

  const merge = grid.locator('[data-merge-ref="H12"]');
  const sourcePosition = () => merge.locator('.xlsxv-rotated-value').evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const source = element.closest('.xlsxv-merged-content')!.getBoundingClientRect();
    return { x: bounds.x - source.x, y: bounds.y - source.y, width: bounds.width, height: bounds.height };
  });
  await expect(merge).toHaveText('Centred rotated merge');
  const initial = await sourcePosition();
  const columnWidth = (await grid.locator('.xlsxv-col-header').getByText('B', { exact: true }).boundingBox())!.width;
  await grid.evaluate((element, width) => {
    const header = element.querySelector('thead')!.getBoundingClientRect().height;
    const ratio = Math.max(1, (1048576 * 24 - element.clientHeight + header) / (element.scrollHeight - element.clientHeight));
    element.scrollTop = 112 * 24 / ratio;
    element.scrollLeft = width * 23;
  }, columnWidth);
  await expect(merge).not.toHaveAttribute('aria-colindex', '9');
  await expect(merge.locator('..')).not.toHaveAttribute('aria-rowindex', '13');
  const clipped = await sourcePosition();
  for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(clipped[key] - initial[key])).toBeLessThan(1);

  await grid.evaluate(element => { element.scrollTop = element.scrollHeight; element.scrollLeft = element.scrollWidth; });
  await expect(value(1048576, 16384)).toHaveText('Tail');
  await expect(value(1048576, 16384)).toBeInViewport();
  await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
});

test('paints rotated text across blank tracks and retains the source anchor outside both column windows', async ({ page }) => {
  await page.setViewportSize({ width: 1240, height: 920 });
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({
    name: 'orientation-overflow.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createRotatedOverflowWorkbook())
  });
  const grid = page.locator('.xlsxv-grid');
  const row = (r: number) => grid.locator(`tbody tr[aria-rowindex="${r + 1}"]`);
  const cell = (r: number, c: number) => row(r).locator(`td[aria-colindex="${c + 1}"]`);
  const overflow = (r: number) => row(r).locator('.xlsxv-rotated-overflow');
  const box = async (target: ReturnType<typeof cell>) => {
    let bounds: Awaited<ReturnType<typeof target.boundingBox>> = null;
    await expect.poll(async () => bounds = await target.boundingBox()).not.toBeNull();
    return bounds!;
  };
  await expect(overflow(1)).toHaveText(/A long rotated caption/);
  const rightEdge = async (r: number) => { const bounds = await box(overflow(r)); return bounds.x + bounds.width; };
  expect(Math.abs(await rightEdge(1) - (await box(cell(1, 5))).x)).toBeLessThan(2);
  await expect(cell(1, 1)).toHaveCSS('border-right-color', 'rgba(0, 0, 0, 0)');
  await expect(cell(1, 2)).toHaveCSS('border-right-color', 'rgba(0, 0, 0, 0)');
  await expect(cell(1, 4)).toHaveCSS('border-right-color', 'rgb(216, 222, 232)');
  const second = await box(cell(1, 2));
  const ink = await overflow(1).locator('.xlsxv-rotated-value').evaluate((el, { x, width }) => {
    const text = el.firstChild!;
    const range = document.createRange();
    return Array.from(el.textContent ?? '', (character, i) => {
      if (!/\w/.test(character)) return undefined;
      range.setStart(text, i); range.setEnd(text, i + 1);
      const bounds = range.getBoundingClientRect();
      return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    }).find(point => point && point.x > x + 8 && point.x < x + width - 8);
  }, second);
  expect(ink).toBeDefined();
  expect(await countNearbyPixels(page, ink!.x, ink!.y, [190, 24, 93], 38)).toBeGreaterThan(2);

  const formula = await box(cell(2, 4));
  expect(Math.abs((await box(overflow(2))).x - formula.x - formula.width)).toBeLessThan(2);
  const merged = await box(row(3).locator('[data-merge-ref="D3"]'));
  expect(Math.abs(await rightEdge(3) - merged.x)).toBeLessThan(2);
  await expect(cell(4, 5)).toHaveText('2');
  const projected = await box(cell(4, 5));
  expect(Math.abs((await box(overflow(4))).x - projected.x - projected.width)).toBeLessThan(2);
  await expect(overflow(5)).toHaveCount(0);
  await expect(overflow(8)).toHaveCount(0);

  const sourceX = (r: number) => overflow(r).locator('.xlsxv-rotated-value').evaluate(el => {
    const grid = el.closest('.xlsxv-grid')!;
    return el.getBoundingClientRect().x - grid.getBoundingClientRect().x + grid.scrollLeft;
  });
  await expect(cell(6, 1).locator('.xlsxv-rotated-overflow')).toHaveCount(1);
  await expect(row(7).locator('.xlsxv-column-spacer .xlsxv-rotated-overflow')).toHaveCount(1);
  const autoHeight = (await box(row(7))).height;
  expect(autoHeight).toBeGreaterThan(50);
  const [rightward, leftward] = await Promise.all([sourceX(6), sourceX(7)]);
  const columnWidth = (await box(cell(1, 2))).width;
  await grid.evaluate((element, width) => { element.scrollLeft = width * 36; }, columnWidth);
  await expect(row(6).locator('.xlsxv-column-spacer .xlsxv-rotated-overflow')).toHaveCount(1);
  await expect(cell(7, 52).locator('.xlsxv-rotated-overflow')).toHaveCount(1);
  expect(Math.abs(await sourceX(6) - rightward)).toBeLessThan(2);
  expect(Math.abs(await sourceX(7) - leftward)).toBeLessThan(2);
  expect(Math.abs((await box(row(7))).height - autoHeight)).toBeLessThan(2);
  await expect(cell(6, 1)).toHaveCount(0);
  expect(await row(6).locator('.xlsxv-cell').count()).toBeLessThan(30);

  await grid.evaluate(el => { el.scrollLeft = el.scrollWidth; el.scrollTop = el.scrollHeight; });
  await expect(cell(1048576, 16383).locator('.xlsxv-rotated-overflow')).toHaveCount(1);
  const sheetEnd = await box(cell(1048576, 16384));
  expect(Math.abs(await rightEdge(1048576) - sheetEnd.x - sheetEnd.width)).toBeLessThan(2);
  await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
});

test('extends XLSX only to the trailing columns needed for measured rotated text', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 840 });
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({
    name: 'trailing-orientation.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createTrailingRotatedOverflowWorkbook())
  });
  const grid = page.locator('.xlsxv-grid');
  const table = grid.locator('.xlsxv-table'), headers = table.locator('.xlsxv-col-header');
  const label = (r: number) => table.locator(`tr[aria-rowindex="${r + 1}"] .xlsxv-rotated-overflow`);
  const position = async () => {
    let left: number | undefined;
    await expect.poll(async () => left = await grid.evaluate(grid => {
      const value = grid.querySelector('tr[aria-rowindex="2"] .xlsxv-rotated-overflow .xlsxv-rotated-value');
      if (value) return value.getBoundingClientRect().left - grid.getBoundingClientRect().left + grid.scrollLeft;
    })).toBeDefined();
    return left!;
  };
  await expect(label(1)).toHaveText('This text is rotated');
  await expect(headers).toHaveText(['A', 'C']);
  await expect(table).toHaveAttribute('aria-colcount', '4');
  const [a, c] = await Promise.all([headers.first().boundingBox(), headers.last().boundingBox()]);
  expect(c!.width).toBeGreaterThan(a!.width * 2);

  await page.getByRole('button', { name: 'Long title', exact: true }).click();
  await expect(label(1)).toContainText('trailing blank columns');
  const initial = await position();
  const extent = Number(await table.getAttribute('aria-colcount'));
  expect(extent).toBeGreaterThan(21);
  await grid.evaluate(grid => { grid.scrollLeft = grid.scrollWidth; });
  await expect(table.locator('.xlsxv-column-spacer .xlsxv-rotated-overflow')).toContainText('trailing blank columns');
  await expect(table).toHaveAttribute('aria-colcount', String(extent));
  await expect(headers.last()).toHaveAttribute('aria-colindex', String(extent));
  await expect(headers.getByText('A', { exact: true })).toHaveCount(0);
  expect(await table.locator('tbody tr[aria-rowindex="2"] td.xlsxv-cell').count()).toBeLessThan(35);
  expect(Math.abs(await position() - initial)).toBeLessThan(2);
  const last = (await headers.last().boundingBox())!, lastValue = (await label(1).locator('.xlsxv-rotated-value').boundingBox())!;
  expect(lastValue.x + lastValue.width).toBeGreaterThan(last.x);
  expect(lastValue.x + lastValue.width).toBeLessThanOrEqual(last.x + last.width + 1);

  await page.getByRole('button', { name: 'Short title', exact: true }).click();
  await expect(headers).toHaveText(['A']);
  await expect(label(1)).toHaveCount(0);

  await page.getByRole('button', { name: 'Late title', exact: true }).click();
  await expect(headers).toHaveText(['A']);
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; });
  await expect(label(180)).toHaveText('A heading appears in the last row');
  await expect(label(180)).toBeInViewport();
  expect(await headers.count()).toBeGreaterThan(1);
});
