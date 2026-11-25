import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import JSZip from 'jszip';
import { createDefinedNameWorkbook } from '../../../packages/xlsx/test/fixtures/defined-name-workbook.mjs';
import { createFormulaWorkbook } from '../../../packages/xlsx/test/fixtures/formula-workbook.mjs';
import { createSharedFormulaWorkbook } from '../../../packages/xlsx/test/fixtures/shared-formula-workbook.mjs';

const mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

test('evaluates uncached cross-sheet formulas through Excel’s final cell', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./?view=preview');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({
    name: 'cross-sheet-formulas.xlsx', mimeType, buffer: Buffer.from(await createFormulaWorkbook())
  });
  const grid = page.locator('.xlsxv-grid'), table = grid.locator('table');
  const at = (row: number, col: number) => table.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${col + 1}"]`);
  await expect(at(1, 1)).toHaveText('10');
  await expect(at(1, 2)).toHaveText('15');
  await expect(at(1, 3)).toHaveText('7.5');
  await expect(at(1, 4)).toHaveText('total: 15');
  await expect(at(1, 5)).toHaveText('safe');
  await expect(at(2, 1)).toHaveText('=Input!B1');
  await expect(at(2, 3)).toHaveText('#N/A');
  await expect(at(2, 5)).toHaveText('5');
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
  await expect(at(1048576, 16384)).toHaveText('225.25');
  await expect(at(1048576, 16384)).toBeInViewport();
  await expect(table.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
  expect(await table.locator('.xlsxv-cell').count()).toBeLessThanOrEqual(2200);

  await page.getByRole('button', { name: 'Input', exact: true }).click();
  await expect(at(1, 1)).toHaveText('10');
  await expect(at(1, 2)).toHaveText('=Summary!A2');
  expect(await grid.evaluate(grid => [grid.scrollTop, grid.scrollLeft])).toEqual([0, 0]);
  await page.getByRole('button', { name: 'Summary', exact: true }).click();
  await expect(at(1, 4)).toHaveText('total: 15');
  expect(errors).toEqual([]);
});

test('calculates CONCAT in the shipped formula sample after removing its cached values', async ({ page }) => {
  const zip = await JSZip.loadAsync(await readFile('apps/demo/public/samples/rich-xlsx-formulas.xlsx'));
  const path = 'xl/worksheets/sheet1.xml';
  const xml = await zip.file(path)!.async('string');
  const cached = /(<f>_xlfn\.CONCAT[^<]*<\/f>)<v>someone@example\.com<\/v>/g;
  expect([...xml.matchAll(cached)]).toHaveLength(2);
  zip.file(path, xml.replace(cached, '$1'));
  await page.goto('./?view=preview');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({
    name: 'uncached-formulas.xlsx', mimeType, buffer: await zip.generateAsync({ type: 'nodebuffer' })
  });
  await expect(page.locator('.xlsxv-cell[aria-colindex="2"]').filter({ hasText: 'someone@example.com' })).toHaveCount(2);
});

test('calculates shared formula followers in both axes while preserving cached values', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 900, height: 720 });
  await page.goto('./?view=preview');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({
    name: 'shared-formulas.xlsx', mimeType, buffer: Buffer.from(await createSharedFormulaWorkbook())
  });
  const grid = page.locator('.xlsxv-grid'), table = grid.locator('table');
  const at = (row: number, col: number) => table.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${col + 1}"]`);
  await expect(at(2, 4)).toHaveText('57');
  await expect(at(2, 5)).toHaveText('90');
  await expect(at(2, 6)).toHaveText('76');
  await expect(at(3, 4)).toHaveText('99');
  await expect(at(3, 5)).toBeEmpty();
  await expect(at(3, 7)).toHaveText('=UNKNOWN(A3,"A2")');
  await expect(at(3, 10)).toHaveText('42');
  await expect(at(4, 4)).toHaveText('75');

  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
  await expect(at(1048576, 16384)).toHaveText('12.00');
  await expect(at(1048576, 16384)).toBeInViewport();
  await expect(table.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
  expect(await table.locator('.xlsxv-cell').count()).toBeLessThanOrEqual(2200);

  await page.getByRole('button', { name: 'Rates 2026', exact: true }).click();
  await expect(at(2, 3)).toHaveText('14');
  await page.getByRole('button', { name: 'Summary', exact: true }).click();
  await expect(at(4, 4)).toHaveText('75');
  expect(await grid.evaluate(grid => [grid.scrollTop, grid.scrollLeft])).toEqual([0, 0]);
  expect(errors).toEqual([]);
});

test('resolves XLSX defined names in both scopes and through Excel’s final cell', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1100, height: 720 });
  await page.goto('./?view=preview');
  const input = page.getByLabel('导入文件', { exact: true });
  const source = { name: 'defined-names.xlsx', mimeType, buffer: Buffer.from(await createDefinedNameWorkbook()) };
  await input.setInputFiles(source);
  const grid = page.locator('.xlsxv-grid');
  const at = (row: number, col: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${col + 1}"]`);
  await expect(at(1, 2)).toHaveText('5');
  await expect(at(1, 3)).toHaveText('24');
  await expect(at(1, 4)).toHaveText('21');
  await expect(at(1, 7)).toHaveText('99');
  await expect(at(2, 4)).toHaveText('31');
  await expect(at(3, 3)).toHaveText('12');
  await expect(at(3, 6)).toHaveText('21');
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
  await expect(at(1048576, 16384)).toHaveText('67.50');
  await expect(at(1048576, 16384)).toBeInViewport();
  await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
  await page.getByRole('button', { name: "Rates O'Brien", exact: true }).click();
  await expect(at(1, 4)).toHaveText('3');
  await expect(at(1, 5)).toHaveText('2.5');
  await input.setInputFiles(source);
  await expect(page.getByRole('button', { name: 'Summary', exact: true })).toHaveClass(/is-active/);
  await expect(at(1, 3)).toHaveText('24');
  expect(errors).toEqual([]);
});
