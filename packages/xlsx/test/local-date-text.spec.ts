import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveCellValue } from '../src/cell-value';
import { parseFormulaDateText } from '../src/local-date-text';
import { loadXlsxWorkbook } from '../src/parser';
import { createLocaleDateWorkbook } from './fixtures/locale-date-workbook.mjs';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('regional XLSX date and time text', () => {
  it.each([
    ['en-US', '02/29/24'], ['en-GB', '29/02/24'], ['en-US', 'Feb. 29, 2024'],
    ['de-DE', '29. Februar 2024'], ['de-DE', '29.02.2024'], ['fr-FR', '29 févr. 2024'],
    ['es-ES', '29 de febrero de 2024'], ['ru-RU', '29 февраля 2024 г.'],
    ['ko-KR', '2024년 2월 29일'], ['zh-CN', '２０２４年２月２９日'],
    ['ar-EG', '٢٩/٢/٢٠٢٤'], ['ja-JP', '24/2/29'], ['fr-FR', '2024-2-29']
  ])('recognizes a leap day in %s from %s', (locale, value) => {
    const readYear = vi.fn(() => 2030);
    expect(parseFormulaDateText(value, false, readYear, false, locale)?.day).toBe(45351);
    expect(readYear).not.toHaveBeenCalled();
  });

  it.each([
    ['en-US', 45293], ['en-GB', 45323]
  ])('uses the local numeric order in %s', (locale, expected) => {
    expect(parseFormulaDateText('01/02/2024', false, () => 2024, false, locale)?.day).toBe(expected);
  });

  it.each([
    ['es-ES', '29 de febrero de 2024 4:30 p. m.'],
    ['ja-JP', '2024年2月29日午後4:30'],
    ['ar-EG', '٢٩/٢/٢٠٢٤ ٤:٣٠ م'],
    ['en-GB', '29 February 2024 16:30'],
    ['en-US', '2/29/2024, 4:30 PM'], ['fr-CA', '29 février 2024 16 h 30'],
    ['en-US', '2024-02-29T11:30:00-05:00']
  ])('recognizes date with time in %s from %s', (locale, text) => {
    expect(parseFormulaDateText(text, true, () => 2024, true, locale)).toMatchObject({ day: 43889, time: 16.5 / 24 });
  });

  it.each(['31/02/2024', '29/02/2023', '2024-13-01', 'x 2 Feb 2024',
    '13:92', '07:12 AM PM', '29//2/2024', '02/29/2024T25:01:00'])('rejects malformed date or time text: %s', text => {
    expect(parseFormulaDateText(text, false, () => 2024, false, 'en-GB')).toBeUndefined();
  });

  it('handles omitted years, the two-digit cutoff and locale time separators', () => {
    const year = vi.fn(() => 2024);
    expect(parseFormulaDateText('29-Feb', false, year, false, 'en-GB')?.day).toBe(45351);
    expect(year).toHaveBeenCalledOnce();
    expect(parseFormulaDateText('29-Feb', false, () => 2025, false, 'en-GB')).toBeUndefined();
    expect(parseFormulaDateText('2024-02', false, year, false, 'en-GB')?.day).toBe(45323);
    expect(parseFormulaDateText('1/1/30', false, year, false, 'en-US')?.day).toBe(10959);
    expect(parseFormulaDateText('16.45', false, year, true, 'fi-FI')).toEqual({ time: 16.75 / 24 });
    expect(parseFormulaDateText('١٦:٤٥:٣٠٫٥', false, year, true, 'ar-EG')?.time).toBe(60_330.5 / 86_400);
  });

  it.each([false, true])('calculates regional dates through workbook formulas and clock changes (1904=%s)', async date1904 => {
    const workbook = await loadXlsxWorkbook(await createLocaleDateWorkbook(date1904));
    const [sheet] = workbook.sheets;
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-GB');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2024, 0, 1));
    const dayOffset = date1904 ? 1462 : 0;
    const row = (index: number) => sheet.rows[index].cells.map(cell => resolveCellValue(sheet, cell));
    expect(row(0)).toEqual([
      String(45323 - dayOffset), String(16.5 / 24), '29', String(45355 - dayOffset),
      String(45351 - dayOffset + 16.5 / 24), String(45292 - dayOffset)
    ]);
    expect(row(1)).toEqual([String(45351 - dayOffset), '1', '#VALUE!', '#VALUE!', 'TRUE', '4']);
    expect(row(2)).toEqual([String(45323 - dayOffset)]);
    vi.setSystemTime(new Date(2025, 0, 1));
    expect(row(1)).toEqual(['#VALUE!', '0', '#VALUE!', '#VALUE!', 'TRUE', '4']);
  });
});
