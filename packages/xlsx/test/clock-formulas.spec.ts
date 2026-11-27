import { afterEach, describe, expect, it, vi } from 'vitest';
import { evaluateWorksheetFormula, resolveCellValue } from '../src/cell-value';
import { conditionalFormattingWindow } from '../src/conditional-formatting';
import { createXlsxPreviewDriver } from '../src/preview-driver';
import { createSheetTable } from '../src/table';
import { loadXlsxWorkbook } from '../src/parser';
import { clonePreviewWorkbook } from '../src/workbook-cache';
import type { ParsedSheet } from '../src/types';
import { createClockFormulaWorkbook } from './fixtures/clock-formula-workbook.mjs';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('XLSX clock formulas', () => {
  it.each([false, true])('refreshes clock dependencies, errors and conditional caches (1904=%s)', async date1904 => {
    const workbook = await loadXlsxWorkbook(await createClockFormulaWorkbook(date1904));
    const [sheet, source] = workbook.sheets;
    const [today, now, named, cached, gated, savedTime] = sheet.rows[0].cells;
    const [jan1, jan2, expression, rank, scale] = sheet.rows[1].cells;
    const [, distantDate, distantTime] = sheet.rows.at(-1)!.cells;
    const day = date1904 ? 43830 : 45292;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2024, 0, 1, 23, 59, 55, 250));
    expect(resolveCellValue(sheet, today)).toBe(String(day));
    expect(Number(resolveCellValue(sheet, now))).toBeCloseTo(day + 86_395_250 / 86_400_000, 9);
    expect(resolveCellValue(sheet, named)).toBe(String(day + 1));
    expect(resolveCellValue(sheet, cached)).toBe(String(day - 1));
    expect(resolveCellValue(sheet, gated)).toBe('#DIV/0!');
    expect(resolveCellValue(sheet, savedTime)).toBe(String(day - 0.75));
    expect(resolveCellValue(sheet, distantDate)).toBe(String(day));
    expect(resolveCellValue(sheet, distantTime)).toBe(source.rows[0].cells[1].value);
    const format = () => conditionalFormattingWindow(sheet, 1, 4, 1, 8)!;
    const before = format();
    expect(before(2, 1, jan1)?.color).toBe('#008000');
    expect(before(2, 2, jan2)).toBeUndefined();
    expect(before(2, 3, expression)).toBeUndefined();
    expect(before(2, 4, rank)?.color).toBe('#008000');
    expect(before(2, 5, scale)?.fill).toEqual({ type: 'solid', color: '#808080' });

    const copied = clonePreviewWorkbook(workbook).sheets;
    vi.setSystemTime(new Date(2024, 0, 2, 0, 0, 4));
    expect(resolveCellValue(sheet, distantDate)).toBe(String(day + 1));
    expect(Number(resolveCellValue(sheet, distantTime))).toBeCloseTo(day + 1 + 4 / 86_400, 9);
    expect(resolveCellValue(sheet, named)).toBe(String(day + 2));
    expect(resolveCellValue(sheet, cached)).toBe(String(day - 1));
    expect(resolveCellValue(sheet, savedTime)).toBe(String(day - 0.75));
    expect(resolveCellValue(sheet, gated)).toBe('42');
    expect(gated.valueType).toBeUndefined();
    expect(resolveCellValue(copied[0], copied[0].rows.at(-1)!.cells[1])).toBe(String(day + 1));

    const after = format();
    expect(after(2, 1, jan1)).toBeUndefined();
    expect(after(2, 2, jan2)?.color).toBe('#008000');
    expect(after(2, 3, expression)?.color).toBe('#008000');
    expect(after(2, 4, rank)).toBeUndefined();
    expect(after(2, 5, scale)?.fill).toEqual({ type: 'solid', color: '#000000' });
  });

  it('shares one clock across a calculation and leaves untouched branches static', () => {
    const sheet: ParsedSheet = { id: 's', name: 'S', rowCount: 1, columnCount: 1, rows: [] };
    let sample = new Date(2024, 0, 1, 23, 59, 59, 999).getTime();
    const now = vi.spyOn(Date, 'now').mockImplementation(() => sample++);
    const pos = { row: 1, column: 1 };
    expect(evaluateWorksheetFormula(sheet, 'NOW()=NOW()', pos)).toBe(true);
    expect(evaluateWorksheetFormula(sheet, 'IF(FALSE,NOW(),3)', pos)).toBe(3);
    expect(now).toHaveBeenCalledTimes(2);
    expect(evaluateWorksheetFormula(sheet, 'NOW(1)', pos)).toBeUndefined();
  });

  it('shares one snapshot across separate cells in an unhosted table render', async () => {
    const { sheets: [sheet] } = await loadXlsxWorkbook(await createClockFormulaWorkbook());
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    let sample = new Date(2024, 0, 1, 23, 59, 59, 900).getTime();
    vi.spyOn(Date, 'now').mockImplementation(() => { const now = sample; sample += 200; return now; });
    const table = createSheetTable(sheet, 2);
    expect(table.querySelector('tbody tr[aria-rowindex="2"]')?.textContent).toContain('2024-01-012024-01-01');
  });

  it('releases the midnight timer when a session is replaced or destroyed', async () => {
    const source = await createClockFormulaWorkbook();
    const host = document.body.appendChild(document.createElement('div'));
    const session = createXlsxPreviewDriver().createSession(host);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date(2024, 0, 1, 23, 59, 55));
    const watch = vi.spyOn(document, 'addEventListener'), unwatch = vi.spyOn(document, 'removeEventListener');
    const scheduled = vi.spyOn(globalThis, 'setTimeout'), clear = vi.spyOn(globalThis, 'clearTimeout');
    try {
      await session.load(source, { descriptor: { source, extension: 'xlsx' } });
      expect(watch.mock.calls.filter(([event]) => event === 'visibilitychange')).toHaveLength(1);
      const midnight = scheduled.mock.calls.findIndex(([, delay]) => delay === 5000);
      expect(midnight).toBeGreaterThanOrEqual(0);
      const csv = new TextEncoder().encode('static,value');
      await session.load(csv, { descriptor: { source: csv, extension: 'csv' } });
      expect(unwatch.mock.calls.filter(([event]) => event === 'visibilitychange')).toHaveLength(1);
      expect(clear).toHaveBeenCalledWith(scheduled.mock.results[midnight].value);
      const table = host.querySelector('.xlsxv-table');
      await vi.advanceTimersByTimeAsync(5500);
      expect(host.querySelector('.xlsxv-table')).toBe(table);
      expect(host.querySelector('.xlsxv-cell')?.textContent).toBe('static');
      session.destroy();
      expect(unwatch.mock.calls.filter(([event]) => event === 'visibilitychange')).toHaveLength(2);
    } finally { session.destroy(); }
  });
});
