import { expect, test } from '@playwright/test';
import { createAccumulationWorkbook, createArrayPredicateWorkbook, createArraySelectionWorkbook, createArraySpillWorkbook, createBroadcastWorkbook, createChoiceCriteriaWorkbook, createConditionalReferencesWorkbook, createCoordinateFormulaWorkbook, createCountBlankWorkbook,
  createDistinctRecordWorkbook, createFlattenSpillWorkbook, createFormulaDisplayWorkbook, createGroupByWorkbook, createImplicitIntersectionWorkbook, createLambdaWorkbook, createMakeArrayWorkbook, createMapWorkbook, createOffsetWorkbook, createOrderedConditionalWorkbook, createPivotByWorkbook, createReferenceInfoWorkbook, createReferenceOperatorsWorkbook, createRegexWorkbook, createSequenceWorkbook, createSliceSpillWorkbook,
  createSortSpillWorkbook, createStackSpillWorkbook, createTextSplitWorkbook, createTrimRangeWorkbook, createWorkdayArrayWorkbook, createWrapExpandWorkbook, createXlookupSpillWorkbook, createXmatchWorkbook } from '../../../packages/xlsx/test/fixtures/array-selection-workbook.mjs';

test('loads the XLSX regex engine on demand and formats the final spill cell', async ({ page }) => {
  const engineRequests: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.endsWith('/pcre2.wasm')) engineRequests.push(request.url());
  });
  await page.goto('./?view=preview&lang=en');
  await expect(page.locator('.wb-status')).toHaveText('Preview ready');
  expect(engineRequests).toHaveLength(0);
  await page.locator('.wb-upload input[type=file]').setInputFiles({
    name: 'regex.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createRegexWorkbook())
  });
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, column: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
  await expect(cell(1, 1)).toHaveText('TRUE');
  await expect(cell(1, 2)).toHaveText('a1 b! c3');
  await expect(cell(2, 1)).toHaveText('17');
  await expect(cell(2, 2)).toHaveText('42');
  expect(engineRequests).toHaveLength(1);

  await page.locator('.xlsxv-sheet-tabs').getByRole('button', { name: 'Large Spill', exact: true }).click();
  await grid.evaluate(element => { element.scrollTop = element.scrollHeight; element.scrollLeft = element.scrollWidth; });
  const final = cell(1_048_576, 16_384);
  await expect(final).toHaveText('ID');
  await expect(final).toHaveCSS('background-color', 'rgb(220, 252, 231)');
  expect(engineRequests).toHaveLength(1);
});

test('calculates XLSX MAKEARRAY coordinates on demand through the final cell', async ({ page }) => {
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({
    name: 'makearray.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createMakeArrayWorkbook())
  });
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, column: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
  await expect(cell(1, 1)).toHaveText('15');
  await expect(cell(1, 2)).toHaveText('16');
  await expect(cell(2, 1)).toHaveText('25');
  await expect(cell(2, 2)).toHaveText('900');
  await expect(cell(1, 3)).toHaveText('956');
  await expect(cell(4, 1)).toHaveText('TRUE');
  await expect(cell(4, 2)).toBeEmpty();
  await expect(cell(5, 1)).toHaveText('#N/A');
  await expect(cell(5, 2)).toHaveText('end');
  await expect(cell(7, 1)).toHaveText('8');
  await expect(cell(7, 2)).toHaveText('-1');
  await expect(cell(7, 3)).toHaveText('2129919');

  await page.locator('.xlsxv-sheet-tabs').getByRole('button', { name: 'Large Spill', exact: true }).click();
  await grid.evaluate(root => { root.scrollTop = root.scrollHeight; root.scrollLeft = root.scrollWidth; });
  const final = cell(1_048_576, 16_384);
  await expect(final).toHaveText('1064960');
  await expect(final).toHaveCSS('background-color', 'rgb(220, 252, 231)');
  await expect(final).toBeInViewport();
  const maxColumns = await grid.evaluate(root =>
    Math.ceil(root.clientWidth / root.querySelector('.xlsxv-col-header')!.getBoundingClientRect().width) + 10);
  expect(await grid.locator('.xlsxv-col-header').count()).toBeLessThanOrEqual(maxColumns);
  expect(await grid.locator('.xlsxv-cell').count()).toBeLessThanOrEqual(maxColumns * 100);
});

test('cross-tabulates sparse XLSX columns and displays the final formatted cell', async ({ page }) => {
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({
    name: 'pivotby.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createPivotByWorkbook())
  });
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, column: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
  await expect(cell(1, 2)).toHaveText('Blue');
  await expect(cell(1, 3)).toHaveText('Red');
  await expect(cell(3, 3)).toBeEmpty();
  await expect(cell(4, 4)).toHaveText('55');
  await expect(cell(6, 1)).toHaveText('90');
  await grid.evaluate(element => { element.scrollTop = element.scrollHeight; element.scrollLeft = element.scrollWidth; });
  await expect(cell(1010, 1001)).toHaveText('7');
  await expect(cell(1010, 1000)).toBeEmpty();
  await expect(cell(1010, 1001)).toBeInViewport();
  await page.locator('.xlsxv-sheet-tabs').getByRole('button', { name: 'Large Spill', exact: true }).click();
  await grid.evaluate(element => { element.scrollTop = element.scrollHeight; element.scrollLeft = element.scrollWidth; });
  const final = cell(1_048_576, 16_384);
  await expect(final).toHaveText('45');
  await expect(final).toHaveCSS('background-color', 'rgb(220, 252, 231)');
  await expect(final).toBeInViewport();
});

test('groups sparse XLSX columns, filters rows and shows totals through the final cell', async ({ page }) => {
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({
    name: 'groupby.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createGroupByWorkbook())
  });
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, column: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
  await expect(cell(1, 1)).toHaveText('South');
  await expect(cell(1, 3)).toHaveText('45');
  await expect(cell(2, 2)).toBeEmpty();
  await expect(cell(3, 2)).toHaveText('Blue');
  await expect(cell(5, 3)).toHaveText('10');
  await expect(cell(6, 1)).toHaveText('Grand Total');
  await expect(cell(6, 3)).toHaveText('55');
  await expect(cell(8, 1)).toHaveText('90');

  await page.locator('.xlsxv-sheet-tabs').getByRole('button', { name: 'Large Spill', exact: true }).click();
  await grid.evaluate(element => { element.scrollTop = element.scrollHeight; element.scrollLeft = element.scrollWidth; });
  const final = cell(1_048_576, 16_384);
  await expect(final).toHaveText('45');
  await expect(final).toHaveCSS('background-color', 'rgb(220, 252, 231)');
  await expect(final).toBeInViewport();
});

test('recalculates XLSX running totals and array reductions through the final cell', async ({ page }) => {
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({
    name: 'accumulation.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createAccumulationWorkbook())
  });
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, column: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
  await expect(cell(2, 2)).toHaveText('10');
  await expect(cell(5, 1)).toHaveText('30');
  await expect(cell(4, 2)).toHaveText('110');
  await expect(cell(6, 1)).toHaveText('6');
  await expect(cell(6, 2)).toHaveText('22');

  await page.locator('.xlsxv-sheet-tabs').getByRole('button', { name: 'Large Spill', exact: true }).click();
  await grid.evaluate(element => { element.scrollTop = element.scrollHeight; element.scrollLeft = element.scrollWidth; });
  const final = cell(1_048_576, 16_384);
  await expect(final).toHaveText('10');
  await expect(final).toHaveCSS('background-color', 'rgb(220, 252, 231)');
  await expect(final).toBeInViewport();
});

test('recalculates XLSX trim references through the final cell', async ({ page }) => {
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({
    name: 'trim-range.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createTrimRangeWorkbook())
  });
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, column: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
  await expect(cell(1, 1)).toHaveText('6');
  await expect(cell(1, 3)).toHaveText('7');
  await expect(cell(1, 4)).toHaveText('9');
  await expect(cell(1, 5)).toHaveText('6');
  await expect(cell(2, 2)).toHaveText('TRUE');
  await expect(cell(2, 4)).toHaveText('#N/A');
  await expect(cell(3, 3)).toHaveText('22');
  await page.locator('.xlsxv-sheet-tabs').getByRole('button', { name: 'Large Spill', exact: true }).click();
  await grid.evaluate(element => { element.scrollTop = element.scrollHeight; element.scrollLeft = element.scrollWidth; });
  const final = cell(1_048_576, 16_384);
  await expect(final).toHaveText('15');
  await expect(final).toHaveCSS('background-color', 'rgb(220, 252, 231)');
  await expect(final).toBeInViewport();
});

test('recalculates XLSX lambda groups and sparse row aggregates through the final cell', async ({ page }) => {
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({
    name: 'lambda-groups.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createLambdaWorkbook())
  });
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, column: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
  await expect(cell(1, 1)).toHaveText('2');
  await expect(cell(3, 1)).toHaveText('1');
  await expect(cell(5, 3)).toHaveText('24');
  await expect(cell(7, 2)).toHaveText('120');
  await expect(cell(7, 3)).toHaveText('#NUM!');
  await expect(cell(9, 1)).toHaveText('137');
  await expect(cell(9, 2)).toHaveText('131');
  await expect(cell(9, 3)).toHaveText('130');
  await expect(cell(9, 4)).toHaveText('11');
  await expect(cell(13, 1)).toHaveText('8');
  await expect(cell(15, 1)).toHaveText('36');
  await expect(cell(15, 2)).toHaveText('30');
  await expect(cell(15, 3)).toHaveText('40');

  await page.locator('.xlsxv-sheet-tabs').getByRole('button', { name: 'Large Spill', exact: true }).click();
  await grid.evaluate(element => { element.scrollTop = element.scrollHeight; element.scrollLeft = element.scrollWidth; });
  const final = cell(1_048_576, 16_384);
  await expect(final).toHaveText('130');
  await expect(final).toHaveCSS('background-color', 'rgb(220, 252, 231)');
  await expect(final).toBeInViewport();
});

test('maps XLSX cell references and sparse arrays through the final cell', async ({ page }) => {
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({
    name: 'map.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createMapWorkbook())
  });
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, column: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
  await expect(cell(3, 1)).toHaveText('2');
  await expect(cell(2, 2)).toHaveText('0');
  await expect(cell(1, 3)).toHaveText('6');
  await expect(cell(5, 1)).toHaveText('68719477020');
  await expect(cell(5, 2)).toHaveText('1064960');

  await page.locator('.xlsxv-sheet-tabs').getByRole('button', { name: 'Large Spill', exact: true }).click();
  await grid.evaluate(element => { element.scrollTop = element.scrollHeight; element.scrollLeft = element.scrollWidth; });
  const final = cell(1_048_576, 16_384);
  await expect(final).toHaveText('264');
  await expect(final).toHaveCSS('background-color', 'rgb(220, 252, 231)');
  await expect(final).toBeInViewport();
});

test('wraps vectors and expands sparse XLSX arrays through the final Excel cell', async ({ page }) => {
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({
    name: 'wrap-and-expand.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createWrapExpandWorkbook())
  });
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, column: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
  await expect(cell(2, 3)).toBeEmpty();
  await expect(cell(4, 2)).toHaveText('#REF!');
  await expect(cell(6, 2)).toHaveText('#N/A');
  await expect(cell(10, 3)).toHaveText('FALSE');
  await expect(cell(12, 1)).toHaveText('50');
  await expect(cell(12, 2)).toHaveText(String((1_048_576 * 16_384 - 4) * 9 + 14));
  await expect(cell(13, 2)).toHaveText('36');

  for (const [sheet, value] of [['Large Spill', '7'], ['Expand Spill', '9']]) {
    await page.locator('.xlsxv-sheet-tabs').getByRole('button', { name: sheet, exact: true }).click();
    await grid.evaluate(element => { element.scrollTop = element.scrollHeight; element.scrollLeft = element.scrollWidth; });
    const final = cell(1_048_576, 16_384);
    await expect(final).toHaveText(value);
    await expect(final).toHaveCSS('background-color', 'rgb(220, 252, 231)');
    await expect(final).toBeInViewport();
  }
});

test('flattens sparse XLSX arrays in either order and displays the final Excel cell', async ({ page }) => {
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({
    name: 'flatten-arrays.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createFlattenSpillWorkbook())
  });
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, column: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
  await expect(cell(1, 2)).toHaveText('#DIV/0!');
  await expect(cell(3, 2)).toBeEmpty();
  await expect(cell(3, 3)).toHaveText('#DIV/0!');
  await expect(cell(6, 1)).toHaveText('0');
  await expect(cell(9, 1)).toHaveText('TRUE');
  await expect(cell(5, 8)).toHaveText('-7');
  await expect(cell(10, 1)).toHaveText('4');
  await expect(cell(10, 2)).toHaveText('6');

  await page.locator('.xlsxv-sheet-tabs').getByRole('button', { name: 'Large Spill' }).click();
  await expect(cell(1, 1)).toHaveText('38');
  await expect(cell(1, 2)).toHaveText('1048573');
  await grid.evaluate(element => { element.scrollTop = element.scrollHeight; element.scrollLeft = element.scrollWidth; });
  const final = cell(1_048_576, 16_384);
  await expect(final).toHaveText('33');
  await expect(final).toHaveCSS('background-color', 'rgb(220, 252, 231)');
  await expect(final).toBeInViewport();
  await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
});

test('expands mismatched XLSX arrays and reads a sparse result through the final cell', async ({ page }) => {
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({
    name: 'broadcast-arrays.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createBroadcastWorkbook())
  });
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, column: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
  await expect(cell(1, 2)).toHaveText('10');
  await expect(cell(3, 2)).toHaveText('30');
  await expect(cell(6, 2)).toHaveText('1100');
  await expect(cell(6, 3)).toHaveText('#N/A');
  await expect(cell(9, 3)).toHaveText('osl');

  await page.locator('.xlsxv-sheet-tabs').getByRole('button', { name: 'Large Spill' }).click();
  await expect(cell(1, 1)).toHaveText('1080');
  await expect(cell(2, 1)).toHaveText('1064');
  await expect(cell(3, 1)).toHaveText('1080');
  await expect(cell(4, 1)).toHaveText(String(7 * 1_048_576 * 16_384));
  await grid.evaluate(element => { element.scrollTop = element.scrollHeight; element.scrollLeft = element.scrollWidth; });
  await expect(cell(1048576, 16383)).toHaveText('16');
  await expect(cell(1048576, 16384)).toHaveText('1064');
  await expect(cell(1048576, 16384)).toBeInViewport();
  await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
});

test('recalculates IFS and SWITCH through the final Excel cell', async ({ page }) => {
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({
    name: 'ordered-conditions.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createOrderedConditionalWorkbook())
  });
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, column: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
  const expected = [['first', 'red', '42'], ['FALSE', 'TRUE'], ['#N/A', '#N/A'], ['#N/A', 'missing']];
  for (const [row, values] of expected.entries()) {
    for (const [column, value] of values.entries()) await expect(cell(row + 1, column + 1)).toHaveText(value);
  }

  await page.locator('.xlsxv-sheet-tabs').getByRole('button', { name: 'Large Spill' }).click();
  await expect(cell(1, 1)).toHaveText(String((1_048_576 * 16_383 - 2) * 3 + 77 + 99));
  await grid.evaluate(element => { element.scrollTop = element.scrollHeight; element.scrollLeft = element.scrollWidth; });
  const last = cell(1_048_576, 16_384);
  await expect(last).toHaveText('99');
  await expect(last).toHaveCSS('background-color', 'rgb(220, 252, 231)');
  await expect(last).toBeInViewport();
});

test('recalculates reference and error information and aggregates a full-height XLSX spill', async ({ page }) => {
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({
    name: 'reference-info.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createReferenceInfoWorkbook())
  });
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, column: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
  const expected = [['TRUE', '2', 'TRUE'], ['64', '4', '53'], ['4', '#N/A', '7']];
  for (const [row, values] of expected.entries()) {
    for (const [column, value] of values.entries()) await expect(cell(row + 1, column + 1)).toHaveText(value);
  }

  await page.locator('.xlsxv-sheet-tabs').getByRole('button', { name: 'Large Spill' }).click();
  await expect(cell(1, 2)).toHaveText('9');
  await grid.evaluate(element => { element.scrollTop = element.scrollHeight; element.scrollLeft = element.scrollWidth; });
  const last = cell(1_048_576, 16_384);
  await expect(last).toHaveText(String((1_048_576 * 16_382 - 2) * 4 + 81 + 441 + 66));
  await expect(last).toBeInViewport();
});

test('intersects sparse XLSX spill and union references through the final Excel cell', async ({ page }) => {
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({
    name: 'reference-operators.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createReferenceOperatorsWorkbook())
  });
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, column: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
  const expected = [[String(2 * 1_048_575 + 21), '1', '2', '7'], ['#NULL!', '#REF!']];
  for (const [row, values] of expected.entries()) {
    for (const [column, value] of values.entries()) await expect(cell(row + 1, column + 1)).toHaveText(value);
  }

  await page.locator('.xlsxv-sheet-tabs').getByRole('button', { name: 'Large Spill' }).click();
  await expect(cell(1, 2)).toHaveText('9');
  await grid.evaluate(element => { element.scrollTop = element.scrollHeight; element.scrollLeft = element.scrollWidth; });
  const last = cell(1_048_576, 16_384);
  await expect(last).toHaveText(String((1_048_576 * 16_382 - 2) * 2 + 39));
  await expect(last).toBeInViewport();
});

test('uses XLSX conditional references in range operators through the final Excel cell', async ({ page }) => {
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({
    name: 'conditional-references.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createConditionalReferencesWorkbook())
  });
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, column: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
  const spillTotal = (1_048_576 * 16_382 - 2) * 2 + 30;
  const expected = [[String(spillTotal + 9), '7', 'TRUE'], [String(spillTotal), '2', '=NOTIMPLEMENTED(1)']];
  for (const [row, values] of expected.entries()) {
    for (const [column, value] of values.entries()) await expect(cell(row + 1, column + 1)).toHaveText(value);
  }

  await page.locator('.xlsxv-sheet-tabs').getByRole('button', { name: 'Large Spill' }).click();
  await expect(cell(1, 2)).toHaveText('9');
  await grid.evaluate(element => { element.scrollTop = element.scrollHeight; element.scrollLeft = element.scrollWidth; });
  const last = cell(1_048_576, 16_384);
  await expect(last).toHaveText(String(2 * 1_048_575 + 40));
  await expect(last).toBeInViewport();
});

test('selects the formula row or column with implicit intersection through the final Excel cell', async ({ page }) => {
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({
    name: 'implicit-intersection.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createImplicitIntersectionWorkbook())
  });
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, column: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
  const expected = [['#VALUE!', '8', '#N/A', '0'], ['12', '8', '12', '19'], ['42']];
  for (const [row, values] of expected.entries()) {
    for (const [column, value] of values.entries()) await expect(cell(row + 1, column + 1)).toHaveText(value);
  }

  await page.locator('.xlsxv-sheet-tabs').getByRole('button', { name: 'Large Spill' }).click();
  await expect(cell(2, 1)).toHaveText('12');
  await expect(cell(2, 2)).toHaveText('12');
  await expect(cell(2, 3)).toHaveText('12');
  await grid.evaluate(element => { element.scrollTop = element.scrollHeight; element.scrollLeft = element.scrollWidth; });
  const last = cell(1_048_576, 16_384);
  await expect(last).toHaveText('40');
  await expect(last).toBeInViewport();
});

test('renders Excel formula text from shared records and spilled references through the final cell', async ({ page }) => {
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({
    name: 'formula-display.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createFormulaDisplayWorkbook())
  });
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, column: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
  await expect(cell(1, 1)).toHaveText('=@$G$7:$G$9');
  await expect(cell(1, 2)).toHaveText('=SORT($G$7:$G$10)');
  await expect(cell(2, 1)).toHaveText('=@(B1#%)');
  await expect(cell(2, 2)).toHaveText('=FUTURE("_xlpm.x",Table[_xlfn.SINGLE])');
  await expect(cell(3, 1)).toHaveText('=LET(x,C5:C8,x)');

  await page.locator('.xlsxv-sheet-tabs').getByRole('button', { name: 'Large Spill' }).click();
  await grid.evaluate(element => { element.scrollTop = element.scrollHeight; element.scrollLeft = element.scrollWidth; });
  const last = cell(1_048_576, 16_384);
  await expect(last).toHaveText('=@$G$7:$G$9');
  await expect(last).toBeInViewport();
});

test('recalculates COUNTBLANK and formats the final Excel cell', async ({ page }) => {
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({
    name: 'countblank.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createCountBlankWorkbook())
  });
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, column: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
  const size = 1_048_576 * 16_384;
  const expected = [['4', '1048572', '3', '1'], ['1', '1048574', String(size - 1_048_578)]];
  for (const [row, values] of expected.entries()) {
    for (const [column, value] of values.entries()) await expect(cell(row + 1, column + 1)).toHaveText(value);
  }

  await page.locator('.xlsxv-sheet-tabs').getByRole('button', { name: 'Large Spill', exact: true }).click();
  await grid.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(cell(1_048_576, 2)).toHaveText('0');
  await expect(cell(1_048_576, 3)).toHaveText('19');
  await grid.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  const last = cell(1_048_576, 16_384);
  await expect(last).toHaveText(String(size - 6));
  await expect(last).toHaveCSS('background-color', 'rgb(220, 252, 231)');
  await expect(last).toBeInViewport();
});

test('recalculates transpose and XMATCH arrays through the final Excel cell', async ({ page }) => {
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({
    name: 'lookup-arrays.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createXmatchWorkbook())
  });
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, column: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
  await expect(cell(1, 2)).toHaveText('East');
  await expect(cell(1, 5)).toHaveText('2');
  await expect(cell(2, 2)).toHaveText('0');
  await expect(cell(2, 3)).toHaveText('TRUE');
  await expect(cell(4, 2)).toHaveText('#N/A');
  await expect(cell(5, 1)).toHaveText('1048576');
  await expect(cell(7, 2)).toHaveText('5');

  await page.locator('.xlsxv-sheet-tabs').getByRole('button', { name: 'Large Spill' }).click();
  await expect(cell(1, 1)).toHaveText(String((1_048_576 * 16_383 - 3) * 4 + 1_048_576));
  await grid.evaluate(element => { element.scrollTop = element.scrollHeight; element.scrollLeft = element.scrollWidth; });
  const final = cell(1_048_576, 16_384);
  await expect(final).toHaveText('1048576');
  await expect(final).toHaveCSS('background-color', 'rgb(220, 252, 231)');
  await expect(final).toBeInViewport();
  await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
});

test('spills TEXTSPLIT fields and padding through the final Excel cell', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 730 });
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({
    name: 'text-split.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createTextSplitWorkbook())
  });
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, column: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
  await expect(cell(2, 5)).toHaveText('sku/saved/Harbor/Latitude//62/single/pad/pad');
  await expect(cell(2, 3)).toHaveText('saved');
  await expect(cell(3, 3)).toBeEmpty();
  await expect(cell(3, 5)).toHaveText('2');
  await expect(cell(4, 4)).toHaveText('pad');
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
  await expect(cell(1_048_576, 16_383)).toHaveText('Station');
  const final = cell(1_048_576, 16_384);
  await expect(final).toHaveText('End');
  await expect(final).toHaveCSS('background-color', 'rgb(220, 252, 231)');
  await expect(final).toBeInViewport();
  await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
});

test('evaluates XLSX formulas that consume FILTER and selected rows or columns through the final cell', async ({ page }) => {
  await page.setViewportSize({ width: 1370, height: 800 });
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({
    name: 'array-selection.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createArraySelectionWorkbook())
  });
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, column: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
  for (const [index, expected] of ['28', '5', '2|3|2|5|7|5', '-', '90', '8'].entries()) {
    await expect(cell(1, index + 1)).toHaveText(expected);
  }
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
  const final = cell(1_048_576, 16_384);
  await expect(final).toHaveText('14');
  await expect(final).toBeInViewport();
  await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
});

test('shows uncached XLSX array results in the visible grid and at the final coordinate', async ({ page }) => {
  await page.setViewportSize({ width: 1370, height: 800 });
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({
    name: 'array-spill.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createArraySpillWorkbook())
  });
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, column: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
  await expect(cell(1, 1)).toHaveText('3');
  await expect(cell(1, 2)).toHaveText('saved');
  await expect(cell(1, 5)).toHaveText('42');
  await expect(cell(2, 1)).toHaveText('8');
  await expect(cell(2, 1)).toHaveCSS('background-color', 'rgb(46, 46, 46)');
  await expect(cell(2, 2)).toHaveText('North');
  await expect(cell(2, 3)).toHaveText('-');
  await expect(cell(2, 5)).toHaveText('42');
  await expect(cell(2, 6)).toHaveText('North');
  await expect(cell(2, 7)).toHaveText('14');
  await expect(cell(4, 1)).toHaveText('999');
  await expect(cell(4, 2)).toHaveText('4.00');
  await expect(cell(4, 5)).toHaveText('#N/A');
  await page.locator('.xlsxv-sheet-tabs').getByRole('button', { name: 'Large Spill' }).click();
  await expect(cell(1, 1)).toHaveText('35');
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
  const final = cell(1_048_576, 16_384);
  await expect(final).toHaveText('14');
  await expect(final).toBeInViewport();
  await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
});

test('calculates XLSX SEQUENCE spills through the final coordinate without expanding the worksheet', async ({ page }) => {
  await page.setViewportSize({ width: 1370, height: 800 });
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({
    name: 'sequences.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createSequenceWorkbook())
  });
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, column: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
  await expect(cell(1, 1)).toHaveText('1');
  await expect(cell(1, 6)).toHaveText('210');
  await expect(cell(4, 5)).toHaveText('20');
  await expect(cell(6, 1)).toHaveText('700');
  await expect(cell(6, 4)).toHaveText('727.5');
  await expect(cell(7, 3)).toHaveText('4.5');
  await expect(cell(11, 1)).toHaveText('18');
  await page.locator('.xlsxv-sheet-tabs').getByRole('button', { name: 'Large Spill' }).click();
  await expect(cell(1, 1)).toHaveText('17178820608');
  await expect(cell(2, 1)).toHaveText('34357641215');
  await expect(cell(3, 1)).toHaveText('1048576');
  await expect(cell(4, 1)).toHaveText('34357641215');
  await expect(cell(5, 1)).toHaveText('34357641215');
  await expect(cell(6, 1)).toHaveText('TRUE|TRUE');
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
  const final = cell(1_048_576, 16_384);
  await expect(final).toHaveText('17178820608');
  await expect(final).toBeInViewport();
  await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
});

test('slices XLSX arrays and projects sparse DROP results through the last row and column', async ({ page }) => {
  await page.setViewportSize({ width: 1370, height: 800 });
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({
    name: 'take-drop.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createSliceSpillWorkbook())
  });
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, column: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
  await expect(cell(1, 3)).toHaveText('1|South|6|Saved');
  await expect(cell(2, 2)).toHaveText('Saved');
  await expect(cell(5, 2)).toHaveText('South');
  await expect(cell(6, 1)).toHaveText('8');
  await expect(cell(8, 1)).toHaveText('#CALC!');
  await page.locator('.xlsxv-sheet-tabs').getByRole('button', { name: 'Large Spill' }).click();
  await expect(cell(1, 1)).toHaveText('35');
  await expect(cell(2, 1)).toHaveText(String(1_048_576 * 16_383 - 5));
  await expect(cell(3, 1)).toHaveText('14');
  await expect(cell(4, 1)).toHaveText('21');
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
  const final = cell(1_048_576, 16_384);
  await expect(final).toHaveText('14');
  await expect(final).toBeInViewport();
  await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
});

test('stacks XLSX arrays and reads padded and sparse spill values through the final cell', async ({ page }) => {
  await page.setViewportSize({ width: 1370, height: 800 });
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({
    name: 'stack.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createStackSpillWorkbook())
  });
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, column: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
  await expect(cell(1, 4)).toHaveText('3|North|10|7|South|99|8|North|pad');
  await expect(cell(2, 3)).toHaveText('99');
  await expect(cell(3, 3)).toHaveText('#N/A');
  await expect(cell(6, 2)).toHaveText('#N/A');
  await expect(cell(11, 1)).toHaveText('0');
  await expect(cell(14, 1)).toHaveText('');
  await expect(cell(17, 1)).toHaveText('4');
  await expect(cell(18, 1)).toHaveText('0');
  await page.locator('.xlsxv-sheet-tabs').getByRole('button', { name: 'Large Spill' }).click();
  for (const [index, value] of ['35', '6', '14', '17'].entries()) await expect(cell(index + 1, 1)).toHaveText(value);
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
  const final = cell(1_048_576, 16_384);
  await expect(final).toHaveText('14');
  await expect(final).toBeInViewport();
  await expect(cell(1_048_576, 16_383)).toHaveText('0');
  await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
});

test('deduplicates XLSX rows across a sheet span and spills sparse records to the final column', async ({ page }) => {
  await page.setViewportSize({ width: 1370, height: 800 });
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({
    name: 'distinct-records.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createDistinctRecordWorkbook())
  });
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, column: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
  for (const [index, value] of ['jeans', 'Shirt', 'coat', 'Hat'].entries()) await expect(cell(index + 1, 1)).toHaveText(value);
  for (const [index, value] of ['19', '15', '#REF!', 'jeans|JEANS|Hat', 'jeans|JEANS|Hat'].entries()) {
    await expect(cell(1, index + 4)).toHaveText(value);
  }
  await expect(cell(7, 1)).toHaveText('coat');
  await expect(cell(8, 1)).toHaveText('Hat');
  await expect(cell(8, 4)).toHaveText('HAt');
  await page.locator('.xlsxv-sheet-tabs').getByRole('button', { name: 'Large Spill' }).click();
  await expect(cell(9, 1)).toHaveText('17');
  await grid.evaluate(grid => { grid.scrollLeft = grid.scrollWidth; });
  await expect(cell(6, 16_384)).toHaveText('0');
  await expect(cell(7, 16_384)).toHaveText('14');
  await expect(cell(7, 16_384)).toBeInViewport();
});

test('counts array criteria and chooses sparse columns through the final Excel cell', async ({ page }) => {
  await page.setViewportSize({ width: 1370, height: 800 });
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({
    name: 'choice-criteria.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createChoiceCriteriaWorkbook())
  });
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, column: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
  await expect(cell(1, 1)).toHaveText('3');
  await expect(cell(2, 1)).toHaveText('7');
  await expect(cell(5, 4)).toHaveText('North');
  await expect(cell(5, 5)).toHaveText('6');
  await page.locator('.xlsxv-sheet-tabs').getByRole('button', { name: 'Large Spill' }).click();
  for (const [index, value] of ['11', '49', '1', '1048576', '1'].entries()) await expect(cell(index + 1, 1)).toHaveText(value);
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
  await expect(cell(1_048_576, 16_383)).toHaveText('0');
  await expect(cell(1_048_576, 16_384)).toHaveText('14');
  await expect(cell(1_048_576, 16_384)).toBeInViewport();
  await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
});

test('spills typed XLOOKUP results for scalar and array keys through the last cell', async ({ page }) => {
  await page.setViewportSize({ width: 1370, height: 800 });
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({
    name: 'lookup-spill.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createXlookupSpillWorkbook())
  });
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, column: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
  for (const [index, expected] of ['Bea', 'Saved dept', 'FALSE', '0'].entries()) {
    await expect(cell(1, index + 1)).toHaveText(expected);
  }
  await expect(cell(1, 6)).toHaveText('Bea|Saved dept|FALSE|0');
  for (const [index, expected] of ['West', '9', '#N/A'].entries()) {
    await expect(cell(index + 3, 1)).toHaveText(expected);
  }
  await expect(cell(4, 6)).toHaveText('88');
  await expect(cell(5, 6)).toHaveText('Ops');
  await expect(cell(7, 2)).toHaveText('record');
  await expect(cell(9, 2)).toHaveText('FALSE');
  await expect(cell(9, 3)).toHaveText('missing');
  await expect(cell(10, 4)).toHaveText('#DIV/0!');
  await expect(cell(12, 1)).toHaveText('unlisted');
  await expect(cell(12, 2)).toHaveText('131');
  await expect(cell(16, 1)).toHaveText('Cy');
  await page.locator('.xlsxv-sheet-tabs').getByRole('button', { name: 'Large Spill' }).click();
  await expect(cell(1, 1)).toHaveText('138');
  await expect(cell(2, 1)).toHaveText('131');
  await expect(cell(3, 1)).toHaveText('7');
  await expect(cell(4, 1)).toHaveText('138');
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
  const final = cell(1_048_576, 16_384);
  await expect(final).toHaveText('131');
  await expect(final).toBeInViewport();
  await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
});

test('combines XLSX array predicates and recalculates months across a sparse spill', async ({ page }) => {
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({
    name: 'array-predicates.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createArrayPredicateWorkbook())
  });
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, column: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
  for (const [index, expected] of ['X3000-050', 'East', '43962', '4500'].entries()) {
    await expect(cell(1, index + 1)).toHaveText(expected);
  }
  await expect(cell(3, 1)).toHaveText('TRUE');
  await expect(cell(3, 3)).toHaveText('#N/A');
  await page.locator('.xlsxv-sheet-tabs').getByRole('button', { name: 'Large Spill' }).click();
  await expect(cell(1, 1)).toHaveText(String(1_048_576 * 16_380 + 4));
  await expect(cell(1, 2)).toHaveText('1');
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
  await expect(cell(1_048_576, 16_384)).toHaveText('5');
  await expect(cell(1_048_576, 16_384)).toBeInViewport();
  await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
});

test('recalculates XLSX workday arrays and reaches the final Excel cell', async ({ page }) => {
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({
    name: 'workday-arrays.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createWorkdayArrayWorkbook(true))
  });
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, column: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
  for (const [column, expected] of ['43992', '43986', '43990'].entries()) {
    await expect(cell(1, column + 1)).toHaveText(expected);
  }
  for (const [column, expected] of ['2', '-1', '2', '0'].entries()) {
    await expect(cell(4, column + 1)).toHaveText(expected);
  }
  await page.locator('.xlsxv-sheet-tabs').getByRole('button', { name: 'Large Spill' }).click();
  await expect(cell(1, 1)).toHaveText('4');
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
  await expect(cell(1_048_576, 16_384)).toHaveText('4');
  await expect(cell(1_048_576, 16_384)).toBeInViewport();
  await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
});

test('spills row and column coordinates and resolves cell addresses through the final Excel cell', async ({ page }) => {
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({
    name: 'coordinate-arrays.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createCoordinateFormulaWorkbook())
  });
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, column: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
  await expect(cell(1, 3)).toHaveText('6');
  await expect(cell(2, 1)).toHaveText('22');
  await expect(cell(2, 2)).toHaveText('2');
  await expect(cell(3, 1)).toHaveText('Ledger!R1048576C16384');
  await expect(cell(3, 2)).toHaveText('131');
  await expect(cell(3, 3)).toHaveText('16384');
  await expect(cell(3, 4)).toHaveText('131');
  await expect(cell(4, 5)).toHaveText('16384');
  await expect(cell(6, 1)).toHaveText('1048576');
  await expect(cell(6, 7)).toHaveText('XFD1048576');
  await page.locator('.xlsxv-sheet-tabs').getByRole('button', { name: 'Large Spill' }).click();
  await expect(cell(1, 1)).toHaveText('2097151');
  await expect(cell(2, 1)).toHaveText('32767');
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; });
  await expect(cell(1_048_576, 4)).toHaveText('1048576');
  await grid.evaluate(grid => { grid.scrollLeft = grid.scrollWidth; });
  await expect(cell(1_048_576, 16_384)).toHaveText('16384');
  await expect(cell(1_048_576, 16_384)).toBeInViewport();
  await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
});

test('resolves XLSX OFFSET names and spills at the final Excel cell', async ({ page }) => {
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({
    name: 'offset.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createOffsetWorkbook())
  });
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, column: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
  await expect(cell(1, 1)).toHaveText('255');
  await expect(cell(1, 2)).toHaveText('135');
  await expect(cell(2, 1)).toHaveText('10');
  await expect(cell(2, 4)).toHaveText('20');
  await page.locator('.xlsxv-sheet-tabs').getByRole('button', { name: 'Large Spill' }).click();
  await expect(cell(1, 1)).toHaveText('135');
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
  await expect(cell(1_048_575, 16_384)).toHaveText('Station');
  await expect(cell(1_048_576, 16_383)).toHaveText('0');
  await expect(cell(1_048_576, 16_384)).toHaveText('131');
  await expect(cell(1_048_576, 16_384)).toBeInViewport();
  await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
});

test('spills XLSX SORT and SORTBY results and reorders sparse full-height arrays', async ({ page }) => {
  await page.setViewportSize({ width: 1370, height: 800 });
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({
    name: 'sort-spill.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await createSortSpillWorkbook())
  });
  const grid = page.locator('.xlsxv-grid');
  const cell = (row: number, column: number) => grid.locator(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
  await expect(cell(1, 5)).toHaveText('Cy|Di|Ana|Bea|Eva');
  await expect(cell(5, 1)).toHaveText('0');
  await expect(cell(9, 3)).toHaveText('three');
  await expect(cell(13, 3)).toHaveText('Ana');
  await expect(cell(18, 3)).toHaveText('one');
  await page.locator('.xlsxv-sheet-tabs').getByRole('button', { name: 'Large Spill' }).click();
  await expect(cell(1, 1)).toHaveText('149');
  await expect(cell(1, 5)).toHaveText('8');
  await expect(cell(2, 1)).toHaveText('131');
  const size = 1_048_576 * 16_380;
  for (const [index, expected] of [149, size, size + 149, size - 4, 149].entries()) {
    await expect(cell(index + 5, 1)).toHaveText(String(expected));
  }
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
  const final = cell(1_048_576, 16_384);
  await expect(final).toHaveText('131');
  await expect(final).toBeInViewport();
  await expect(grid.locator('tbody tr[aria-rowindex]')).toHaveCount(100);
});
