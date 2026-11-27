import { describe, expect, it, vi } from 'vitest';
import { conditionalFormattingWindow } from '../src/conditional-formatting';
import { loadXlsxWorkbook } from '../src/parser';
import { createConditionalDateWorkbook } from './fixtures/conditional-date-workbook.mjs';

describe('XLSX date-period conditions', () => {
  it.each([false, true])('uses calendar boundaries and date system 1904=%s', async date1904 => {
    const workbook = await loadXlsxWorkbook(await createConditionalDateWorkbook(date1904));
    expect(workbook.warnings).toEqual([]);
    const sheet = workbook.sheets[0];
    expect(sheet.conditionalRules).toHaveLength(10);
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date(2024, 0, 1, 23, 30));
      const format = conditionalFormattingWindow(sheet, 1, 25, 1, 10)!;
      const hits = (column: number) => sheet.rows.filter(row => format(row.index, column, row.cells[column - 1])).map(row => row.index);
      expect(Array.from({ length: 10 }, (_, i) => hits(i + 1))).toEqual([
        [8], [9, 10, 24], [11], [6, 7, 8, 9, 10, 24], [4, 5, 6, 7], [8, 9, 10, 11, 12, 24], [13, 14],
        [2, 3, 4, 5, 6, 7, 8], [9, 10, 11, 12, 13, 14, 15, 16, 24], [17, 18]
      ]);
      expect(format(25, 2)).toBeUndefined();
      vi.setSystemTime(new Date(2024, 0, 2));
      const nextWindow = conditionalFormattingWindow(sheet, 9, 24, 1, 10)!;
      expect(nextWindow(9, 2, sheet.rows[8].cells[1])).toBeUndefined();
      expect(nextWindow(11, 2, sheet.rows[10].cells[1])?.fill?.color).toBe('#DCFCE7');
    } finally {
      vi.useRealTimers();
    }
  });
});
