import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadXlsxWorkbook, resolveCellValue } from '../src/parser';
import { createSheetTable, SheetRowWindow } from '../src/table';
import { formatCellValue } from '../src/number-formats';
import { createNumberFormatWorkbook } from './fixtures/number-format-workbook.mjs';

beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null); });
afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

const select = (table: HTMLElement, row: number, column: number) =>
  table.querySelector(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);

describe('XLSX number formats', () => {
  it('uses source formats with both worksheet parsers, without changing stored values or types', async () => {
    const fast = await loadXlsxWorkbook(await createNumberFormatWorkbook());
    expect(await loadXlsxWorkbook(await createNumberFormatWorkbook({ general: true }))).toEqual(fast);
    const sheet = fast.sheets[0];
    const table = createSheetTable(sheet, 2);
    expect(Array.from({ length: 20 }, (_, i) => select(table, 1, i + 1)?.textContent?.trim())).toEqual([
      '1,234.50', '12.5%', '1900-02-29 12:00:00', '36:00:00', '(1,234.50)', '—', 'ID 00123', '42', '', '00123',
      '$34.50', '1 1/2', '1.23E+03', '€1,234.50', '0007', '50.0%', 'TRUE', '', 'ID <b>literal</b>', '00123'
    ]);
    expect(select(table, 1, 19)?.children).toHaveLength(0);
    expect(select(table, 2, 1)?.textContent).toBe('35.0%');
    expect(select(table, 2, 16)?.textContent).toBe('0.5');
    expect(sheet.rows[0].cells.find(cell => cell.ref === 'J1')).toMatchObject({ value: '00123', valueType: 'text' });
    expect(sheet.rows[0].cells.find(cell => cell.ref === 'B1')?.value).toBe('0.125');
    expect(sheet.rows[0].cells.find(cell => cell.ref === 'I1')?.value).toBe('35');
  });

  it.each([false, true])('uses workbook date epochs and formats cached or evaluated formulas (1904: %s)', async date1904 => {
    const sheet = (await loadXlsxWorkbook(await createNumberFormatWorkbook({ date1904, formulas: true }))).sheets[0];
    const table = createSheetTable(sheet, 2);
    expect(sheet.date1904).toBe(date1904 || undefined);
    expect(select(table, 1, 3)?.textContent).toBe(date1904 ? '1904-03-01 12:00:00' : '1900-02-29 12:00:00');
    expect(select(table, 1, 4)?.textContent).toBe('36:00:00');
    expect(Array.from({ length: 7 }, (_, i) => select(table, 2, i + 2)?.textContent)).toEqual([
      '37.6%', '2024-02-29 14:30:00', '=UNKNOWN(A1)', '#DIV/0!', 'ID 00123', '', '5.00'
    ]);
    expect(sheet.rows[1].cells.find(cell => cell.ref === 'B2')?.value).toBe('0.376');
    const last = sheet.rows.at(-1)!.cells[0];
    expect(resolveCellValue(sheet, last)).toBe('2470');
    expect(last.value).toBe('2470');
  });

  it('keeps custom format definitions isolated between workbooks with the same format ID', async () => {
    const first = (await loadXlsxWorkbook(await createNumberFormatWorkbook())).sheets[0];
    const second = (await loadXlsxWorkbook(await createNumberFormatWorkbook({ percentCode: '0.00%' }))).sheets[0];
    expect(select(createSheetTable(second, 1), 1, 2)?.textContent).toBe('12.50%');
    expect(select(createSheetTable(first, 1), 1, 2)?.textContent).toBe('12.5%');
  });

  it('formats clipped merge anchors and distant calculated cells within bounded windows', async () => {
    const sheet = (await loadXlsxWorkbook(await createNumberFormatWorkbook({ formulas: true }))).sheets[0];
    const grid = document.body.appendChild(document.createElement('div'));
    Object.defineProperty(grid, 'clientWidth', { value: 800 });
    const view = new SheetRowWindow(sheet, grid);
    try {
      grid.scrollLeft = 4400;
      grid.scrollTop = 26 * 1000;
      grid.dispatchEvent(new Event('scroll'));
      await vi.waitFor(() => expect(view.table.querySelector('[data-merge-ref="A500"]')?.textContent).toBe('(1,234.50)'));
      grid.scrollLeft = 12_000;
      grid.scrollTop = 26 * 2000;
      grid.dispatchEvent(new Event('scroll'));
      await vi.waitFor(() => expect(select(view.table, 2000, 64)?.textContent).toBe('2,470.00'));
      expect(view.table.querySelectorAll('tbody tr[aria-rowindex]')).toHaveLength(100);
      expect(sheet.rows.at(-1)!.cells[0].value).toBe('2470');
    } finally { view.destroy(); }
  });

  it('falls back safely for malformed, excessively long or non-numeric inputs', () => {
    expect(formatCellValue('0x10', undefined, 2)).toBe('0x10');
    expect(formatCellValue('2.6', undefined, '0'.repeat(256))).toBe('2.6');
    expect(formatCellValue('2024 not an ISO date', 'date', 'yyyy-mm-dd')).toBe('2024 not an ISO date');
    expect(formatCellValue('2025-02-29', 'date', 'yyyy-mm-dd')).toBe('2025-02-29');
    expect(formatCellValue('1e1000', undefined, 2)).toBe('1e1000');
    expect(formatCellValue('5', undefined, '[>2]0.0;"under"')).toBe('5.0');
    expect(formatCellValue('1', undefined, '[>2]0.0;"under"')).toBe('under');
  });
});
