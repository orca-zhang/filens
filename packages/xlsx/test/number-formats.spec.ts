import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadXlsxWorkbook, resolveCellValue } from '../src/parser';
import { createSheetTable, SheetRowWindow } from '../src/table';
import { formatCellValue as format } from '../src/number-formats';
import { clonePreviewWorkbook } from '../src/workbook-cache';
import { createNumberFormatWorkbook } from './fixtures/number-format-workbook.mjs';
import { createSystemDateFormatWorkbook } from './fixtures/system-date-format-workbook.mjs';
import { createExtendedLocaleWorkbook } from './fixtures/extended-locale-workbook.mjs';

beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null); });
afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

const select = (table: HTMLElement, row: number, column: number) =>
  table.querySelector<HTMLTableCellElement>(`tr[aria-rowindex="${row + 1}"] td[aria-colindex="${column + 1}"]`);
const formatCellValue = (...args: Parameters<typeof format>) => format(...args).text;

describe('XLSX number formats', () => {
  it.each([
    ['10', '[DBNum1][$-411]General', '十'],
    ['10', '[DBNum1][$-411]0', '一〇'],
    ['1012', '[DBNum1][$-411]General', '千十二'],
    ['1000000000000', '[DBNum1][$-411]General', '一兆'],
    ['1012', '[DBNum2][$-411]General', '壱阡壱拾弐'],
    ['1010', '[DBNum1][$-804]General', '一千〇一十'],
    ['110001010', '[DBNum1][$-804]General', '一亿一千万一千〇一十'],
    ['1012', '[DBNum2][$-804]General', '壹仟零壹拾贰'],
    ['1012', '[DBNum2][$-404]General', '壹仟零壹拾貳'],
    ['1000', '[DBNum2][$-412]General', '壹阡'],
    ['110', '[DBNum2][$-412]General', '壹百壹拾'],
    ['1234567890', '[DBNum3][$-412]General', '十２億３千４百５十６万７千８百９十'],
    ['1012', '[DBNum4][$-412]General', '일천일십이'],
    ['10', '[DBNum3][$-404]0', '１０'],
    ['0', '[DBNum1][$-804]General', '〇'],
    ['-12', '[DBNum1][$-411]General', '-十二'],
    ['123.456', '[DBNum3][$-411]"Q2 "000.00\\7', 'Q2 １２３.４６7'],
    ['12.34567', '[DBNum3][$-411]000,000.000##', '０００,０１２.３４５６７'],
    ['12', '[DBNum3][$T1-411]0', 'T1１２'],
    ['0.125', '[DBNum3][$-411]0.0%', '１２.５%'],
    ['-12', '[DBNum1][$-411]General;[DBNum2][$-804](General)', '(壹拾贰)'],
  ])('renders %s with %s', (value, mask, expected) => {
    expect(formatCellValue(value, undefined, mask)).toBe(expected);
  });

  it('resolves DBNum from the selected section and keeps layout markers, literal digits and types', () => {
    expect(format('1200', undefined, '[DBNum3][$-411]"V2 "0.0?e+?0_7')).toEqual({
      text: 'V2 １.２ e+ ３ ', alignRight: true,
      spacing: [{ kind: 'pad', glyph: '０', offset: 6 }, { kind: 'pad', glyph: '０', offset: 9 },
        { kind: 'pad', glyph: '7', offset: 11 }]
    });
    const sections = '[>=100][Blue][DBNum2][$-804]General;[DBNum1][$-411]General;0;"ID 3 "@';
    expect(format('120', undefined, sections)).toEqual({ text: '壹佰贰拾', color: '#0000FF' });
    expect(formatCellValue('10', undefined, sections)).toBe('十');
    expect(formatCellValue('10', 'text', sections)).toBe('ID 3 10');
    expect(formatCellValue('1', 'boolean', sections)).toBe('1');
    expect(formatCellValue('#VALUE!', 'error', sections)).toBe('#VALUE!');
    expect(formatCellValue('-12', undefined, 'General;[DBNum3][$-411](0)')).toBe('(１２)');
    expect(formatCellValue('12', undefined, '[DBNum1][$-409]0')).toBe('12');
    expect(formatCellValue('45351', undefined, '[DBNum1][$-804]yyyy-mm-dd')).toBe('二〇二四-二-二十九');
    const dateSections = '[>=45000][Blue][DBNum1][$-804]yyyy年m月d日;[DBNum3][$-411]yyyy-mm-dd_7';
    expect(format('45351', undefined, dateSections)).toEqual({ text: '二〇二四年二月二十九日', color: '#0000FF' });
    expect(format('37972', undefined, dateSections)).toEqual({ text: '２００３-１２-１７ ',
      spacing: [{ kind: 'pad', glyph: '7', offset: 10 }] });
  });

  it.each([
    ['37972', '[DBNum1][$-411]yyyy"年"', false, '二〇〇三年'],
    ['42736', '[DBNum2][$-ja-JP]yyyy年m月d日', false, '弐〇壱七年壱月壱日'],
    ['41423', '[$-804][DBNum2]yyyy年m月d日', false, '贰零壹叁年伍月贰拾玖日'],
    ['45351', '[DBNum2][$-404]yyyy年m月d日', false, '貳零貳肆年貳月貳拾玖日'],
    ['45351', '[DBNum4][$-412]yyyy년 m월 d일', false, '이영이사년 이월 이십구일'],
    ['39817', '[DBNum3][$-411]yyyy"年"mm"月"dd"日"', false, '２００９年０１月０４日'],
    ['39817', '[DBNum3][$-411]ggge年m月d日', false, '平成２１年１月４日'],
    ['37972', '[DBNum1][$-411]ggge年m月d日', false, '平成十五年十二月十七日'],
    ['43585', '[DBNum1][$-411]ggge年m月d日', false, '平成三十一年四月三十日'],
    ['43586', '[DBNum1][$-411]ggge年m月d日', false, '令和一年五月一日'],
    ['0.13055555555555556', '[DBNum3][$-411]hh"時"mm"分"', false, '０３時０８分'],
    ['45000.6', '[DBNum1][$-804]yyyy年m月d日 上午/下午h:mm:ss', false, '二〇二三年三月十五日 下午二:二四:〇〇'],
    ['45000.6', '上午/下午h时mm分ss秒', false, '下午2时24分00秒'],
    ['2', '[DBNum3][$-411]"FY 2 "yyyy-mm-dd\\1', true, 'FY 2 １９０４-０１-０３1'],
    ['60', '[DBNum3][$-411]yyyy-mm-dd', false, '１９００-０２-２９'],
    ['0.000171875', '[DBNum3][$-411][ss].000', false, '１４.８５０'],
  ] as const)('localizes date and time fields in %s with %s', (value, mask, date1904, expected) => {
    expect(formatCellValue(value, undefined, mask, date1904)).toBe(expected);
  });

  it('uses the browser locale for DBNum without an explicit locale tag', () => {
    const language = vi.spyOn(navigator, 'language', 'get');
    for (const [tag, expected] of [['zh-CN', '壹佰贰拾 '], ['zh-Hant', '壹佰貳拾 '], ['en-US', '120 ']]) {
      language.mockReturnValue(tag);
      expect(formatCellValue('120', undefined, '[DBNum2]General\\ ')).toBe(expected);
    }
    language.mockReturnValue('ja-JP');
    expect(formatCellValue('39817', undefined, '[DBNum3]m"月"d"日"')).toBe('１月４日');
  });

  it('reuses grouped decimal formatters across amounts and equivalent currency masks', () => {
    const NativeNumberFormat = Intl.NumberFormat;
    const numberFormat = vi.spyOn(Intl, 'NumberFormat').mockImplementation(function (locale, options) {
      return new NativeNumberFormat(locale, options);
    });
    expect(formatCellValue('12.34', undefined, '000,000.00##')).toBe('000,012.34');
    expect(formatCellValue('-1234.56784', undefined, '$000,000.00##')).toBe('-$001,234.5678');
    expect(formatCellValue('12', undefined, '000,000.00##')).toBe('000,012.00');
    expect(formatCellValue('12.3499', undefined, '000,000.00#')).toBe('000,012.35');
    expect(numberFormat).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['8.9', '0.0?', '8.9 ', [3]], ['88.99', '0.0?', '88.99', []],
    ['44.398', '???.???', ' 44.398', [0]], ['102.65', '???.???', '102.65 ', [6]],
    ['2.8', '???.???', '  2.8  ', [0, 1, 5, 6]], ['0', '0.???', '0.   ', [2, 3, 4]],
    ['1234.5', '#,##0.??', '1,234.5 ', [7]], ['12200500', '#.0?,', '12200.5 ', [7]],
    ['0.0899', '0.0? %', '8.99 %', []], ['0.089', '0.0?%', '8.9 %', [3]],
    ['-8.9', '"USD "0.0?;@', '-USD 8.9 ', [8]], ['-8.9', '0.0?;(0.0?)', '(8.9 )', [4]],
    ['5.25', '# ???/???', '5   1/4  ', [2, 3, 7, 8]], ['5.3', '# ???/???', '5   3/10 ', [2, 3, 8]],
    ['0.125', '# ?/?', ' 1/8', []], ['-1.75', '??/??', '- 7/4 ', [1, 5]],
    ['5.25', '# ??/16', '5  4/16', [2]], ['0.25', '? ?/??', '  1/4 ', [0, 5]],
    [String(Math.PI), '0.00E+?0', '3.14E+ 0', [6]], [String(Math.PI), '0.00E+??', '3.14E+ 0', [6]],
    ['1200', '0.0?E+?0', '1.2 E+ 3', [3, 6]], ['12300000000', '0.0?E+?0', '1.23E+10', []],
    ['-0.0012', '0.0?e-?0', '-1.2 e- 3', [4, 7]], ['0', '0.0?E+?0', '0.0 E+ 0', [3, 6]],
    ['0.00123454', '??0.00E+00', '  1.23E-03', [0, 1]], ['999.995', '??0.00E+?0', '  1.00E+ 3', [0, 1, 8]]
  ])('formats digit reservations in %s with %s', (value, code, expected, offsets) => {
    const result = format(value, undefined, code);
    expect(result.text).toBe(expected);
    expect(result.alignRight).toBe(true);
    expect((result.spacing ?? []).map(item => item.offset)).toEqual(offsets);
    expect((result.spacing ?? []).every(item => item.kind === 'pad' && item.glyph === '0')).toBe(true);
  });

  it('reserves the missing fraction glyphs while retaining literal spaces and section colors', () => {
    expect(format('5', undefined, '# ??/16')).toEqual({ text: '5      ', alignRight: true, spacing: [
      { kind: 'pad', glyph: '0', offset: 2 }, { kind: 'pad', glyph: '0', offset: 3 },
      { kind: 'pad', glyph: '/', offset: 4 }, { kind: 'pad', glyph: '1', offset: 5 }, { kind: 'pad', glyph: '6', offset: 6 }
    ] });
    const result = format('-12.3', undefined, '[Red][<0](0.0?);[Blue]0.0?;0;"ID "@');
    expect(result).toMatchObject({ text: '(12.3 )', color: '#FF0000', spacing: [{ kind: 'pad', glyph: '0', offset: 5 }] });
    expect(format('0', undefined, '0.00;(0.00);"–"??_);@')).toEqual({ text: '–   ', alignRight: true, spacing: [
      { kind: 'pad', glyph: '0', offset: 1 }, { kind: 'pad', glyph: '0', offset: 2 }, { kind: 'pad', glyph: ')', offset: 3 }
    ] });
    expect(format('x', 'text', '0.0?;0;0;"ID ? "@')).toEqual({ text: 'ID ? x' });
    expect(format('10', undefined, '0" literal ?"')).toEqual({ text: '10 literal ?' });
    expect(format('1234.5', undefined, '0.??E+00')).toEqual({ text: '1.23E+03', alignRight: true });
  });

  it.each([
    [99.995, '100.00E+00'], [100, '100.00E+00'], [199.99, '199.99E+00'], [1000, '1.00E+03'],
    [0.000894549, '894.55E-06'], [0.000999991, '999.99E-06'], [0.000999999, '1.00E-03']
  ])('rounds engineering values without losing their exponent group (%s)', (value, expected) => {
    expect(formatCellValue(String(value), undefined, '##0.00E+00')).toBe(expected);
    expect(formatCellValue(String(-value), undefined, '##0.00E+00')).toBe('-' + expected);
  });

  it('honors the exponent marker, its sign rule and the active format section', () => {
    expect(formatCellValue('12200000', undefined, '#0.0E+0')).toBe('12.2E+6');
    expect(formatCellValue('0.01', undefined, '0E-0')).toBe('1E-2');
    expect(formatCellValue('1200', undefined, '0e-00')).toBe('1e03');
    expect(formatCellValue('1e-310', undefined, '0.0?E+?0')).toBe('1.0 E-310');
    expect(format('-1200', undefined, '0.0?E+?0;[Red](0.0?E+?0);0')).toMatchObject({ text: '(1.2 E+ 3)', color: '#FF0000' });
    expect(formatCellValue('1200', undefined, '0" e+00 literal"')).toBe('1200 e+00 literal');
  });

  it('retains the active accounting section as plain text and width directives', () => {
    expect(format('1234.5', undefined, 44)).toEqual({ text: ' $1,234.50 ', spacing: [
      { kind: 'pad', glyph: '(', offset: 0 }, { kind: 'fill', glyph: ' ', offset: 2 }, { kind: 'pad', glyph: ')', offset: 10 }
    ] });
    expect(formatCellValue('-1234.5', undefined, 44)).toBe(' $(1,234.50)');
    expect(format('0', undefined, 44)).toEqual({ text: ' $-   ', alignRight: true, spacing: [
      { kind: 'pad', glyph: '(', offset: 0 }, { kind: 'fill', glyph: ' ', offset: 2 },
      { kind: 'pad', glyph: '0', offset: 3 }, { kind: 'pad', glyph: '0', offset: 4 }, { kind: 'pad', glyph: ')', offset: 5 }
    ] });
    expect(formatCellValue('label', 'text', 44)).toBe(' label ');
    expect(format('5', undefined, '[Blue][>0]0*🙂;[Red](0)*·;0;"ID "@_W')).toEqual({
      text: '5', color: '#0000FF', spacing: [{ kind: 'fill', glyph: '🙂', offset: 1 }]
    });
    expect(format('label', 'text', '0*.;0;0;"ID "@_W')).toEqual({
      text: 'ID label ', spacing: [{ kind: 'pad', glyph: 'W', offset: 8 }]
    });
    expect(format('10', undefined, '0" *_ literal"\\*_W')).toEqual({
      text: '10 *_ literal* ', spacing: [{ kind: 'pad', glyph: 'W', offset: 14 }]
    });
  });

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
    expect(select(table, 1, 5)?.style.color).toBe('rgb(255, 0, 0)');
    expect(select(table, 2, 1)?.textContent).toBe('35.0%');
    expect(select(table, 2, 9)?.textContent).toBe('jeudi 29 février 2024');
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
    expect(select(table, 2, 9)?.textContent).toBe('jeudi 29 février 2024');
    expect(select(table, 2, 10)?.textContent).toBe('2024年3月 金曜日 午後 2:30');
    expect(sheet.rows[1].cells.find(cell => cell.ref === 'B2')?.value).toBe('0.376');
    const last = sheet.rows.at(-1)!.cells[0];
    expect(resolveCellValue(sheet, last)).toBe('2470');
    expect(last.value).toBe('2470');
  });

  it('keeps custom format definitions isolated between workbooks with the same format ID', async () => {
    const first = await loadXlsxWorkbook(await createNumberFormatWorkbook());
    const second = await loadXlsxWorkbook(await createNumberFormatWorkbook({ percentCode: '0.00%', paletteColor: 'FF995533' }));
    const secondTable = createSheetTable(second.sheets[0], 2);
    const firstTable = createSheetTable(clonePreviewWorkbook(first).sheets[0], 2);
    expect(select(secondTable, 1, 2)?.textContent).toBe('12.50%');
    expect(select(firstTable, 1, 2)?.textContent).toBe('12.5%');
    expect(select(secondTable, 2, 11)?.style.color).toBe('rgb(153, 85, 51)');
    expect(select(firstTable, 2, 11)?.style.color).toBe('rgb(21, 122, 110)');
  });

  it('applies selected section colors to formulas, rich runs and conditional number formats', async () => {
    const sheet = (await loadXlsxWorkbook(await createNumberFormatWorkbook({ formulas: true }))).sheets[0];
    const table = createSheetTable(sheet, 2);
    expect(select(table, 2, 2)?.style.color).toBe('rgb(0, 255, 0)');
    expect(select(table, 2, 10)?.style.color).toBe('rgb(255, 0, 255)');
    expect(select(table, 2, 12)?.style.color).toBe('rgb(0, 0, 255)');
    const conditional = select(table, 2, 13);
    expect(conditional?.textContent).toBe('0.00');
    expect(conditional?.style.color).toBe('rgb(102, 51, 153)');
    const rich = select(table, 2, 14);
    expect(rich?.textContent).toBe('ID Abcd');
    expect(rich?.style.color).toBe('rgb(0, 255, 255)');
    expect(rich?.querySelector<HTMLElement>('span[style]')?.style.color).toBe('');
    expect(select(table, 2, 15)?.style.color).toBe('rgb(255, 0, 0)');
    sheet.showFormulas = true;
    const formula = select(createSheetTable(sheet, 2), 2, 10);
    expect(formula?.textContent).toBe('=I2+1');
    expect(formula?.style.color).toBe('');
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
      await vi.waitFor(() => {
        const anchor = view.table.querySelector<HTMLElement>('[data-merge-ref="A500"]');
        expect(anchor?.textContent).toBe('(1,234.50)');
        expect(anchor?.style.color).toBe('rgb(255, 0, 0)');
      });
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

  it('localizes date names within the selected format section and preserves quoted text', () => {
    const code = '[>=45000][$-407]dddd "mmmm" d mmmm yyyy;[$-040C]dddd d mmmm yyyy';
    expect(formatCellValue('2024-02-29', 'date', code)).toBe('Donnerstag mmmm 29 Februar 2024');
    expect(formatCellValue('60.5', undefined, code)).toBe('mercredi 29 février 1900');
    expect(formatCellValue('60.5', undefined, code, true)).toBe('mardi 1 mars 1904');
    expect(formatCellValue('2024-07-04', 'date', '[$-00000804]mmmmm')).toBe('七');
    expect(formatCellValue('60.5', undefined, '[$-FFFF]"[$-411]" d mmmm')).toBe('[$-411] 29 February');
    expect(formatCellValue('1234.5', undefined, '[$€-407]#,##0.00')).toBe('€1,234.50');
  });

  it.each([
    ['2024-05-28', 'date', '[$-ja-JP-x-gannen]ggge"年"m"月"d"日";@', false, '令和6年5月28日'],
    ['2019-05-01', 'date', '[$-ja-JP-x-gannen]ggge"年"m"月"d"日"', false, '令和元年5月1日'],
    ['2019-04-30', 'date', '[$-411]ggge"年"m"月"d"日"', false, '平成31年4月30日'],
    ['2020-02-11', 'date', '[$-1030411]dd\\-mm\\-ee', false, '11-02-02'],
    ['2020-02-11', 'date', '[$-1B030411]dd\\-mm\\-ee', false, '十一-二-二'],
    ['2020-02-11', 'date', '[$-107041E]dd\\-mm\\-yyyy', false, '11-02-2563'],
    ['2020-02-11', 'date', '[$-D07041E]dd\\-mm\\-yyyy', false, '๑๑-๐๒-๒๕๖๓'],
    ['2020-02-11', 'date', '[$-th-TH,0D07]dd\\-mm\\-yyyy', true, '๑๑-๐๒-๒๕๖๓'],
    ['2020-02-11', 'date', '[$-1050412]yyyy/mm/dd', false, '4353/02/11'],
    ['2024-02-29', 'date', '[$-1040404]ggge"年"m"月"d"日"', true, '民國113年2月29日'],
    ['60', undefined, '[$-107041E]yyyy-mm-dd', false, '2443-02-29'],
    ['60', undefined, '[$-107041E]yyyy-mm-dd', true, '2447-03-01'],
    ['1234.5', undefined, '[$-409]#,##0.00', false, '1,234.50'],
    ['1234.5', undefined, '[$-de-DE]#,##0.00', false, '1,234.50'],
    ['1234.5', undefined, '[$T1-th-TH,D00]#,##0.00', false, 'T1๑,๒๓๔.๕๐'],
    ['-12', undefined, '[$-th-TH,D00]0;[Red][$-ar-SA,200]"V2 "0\\7', false, 'V2 ١٢7'],
    ['0.5', undefined, '[$-th-TH,D00]hh:mm:ss "Q2"', false, '๑๒:๐๐:๐๐ Q2'],
  ] as const)('renders calendar and numeral directives for %s with %s', (value, type, code, date1904, expected) => {
    expect(formatCellValue(value, type, code, date1904)).toBe(expected);
  });

  it.each([false, true])('uses formatCode16 with styles, TEXT and original serials (1904: %s)', async date1904 => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-GB');
    const sheet = (await loadXlsxWorkbook(await createExtendedLocaleWorkbook(date1904))).sheets[0];
    const table = createSheetTable(sheet, 2);
    expect(Array.from({ length: 6 }, (_, i) => select(table, 1, i + 1)?.textContent)).toEqual([
      '令和元年5月1日', '๑๑-๐๒-๒๕๖๓', '令和元', 'Thursday, 29 February 2024', '14:30:45', '42.00'
    ]);
    expect(select(table, 1, 5)?.style.color).toBe('rgb(0, 0, 255)');
    expect(select(table, 2, 1)?.textContent).toBe('平成31年4月30日');
    expect(select(table, 2, 2)?.textContent).toBe(date1904 ? '42411' : '43873');
    expect(select(table, 2, 3)?.textContent).toBe('๑๑-๐๒-๒๕๖๓');
  });

  it.each([false, true])('renders system formats from the workbook and differential styles (1904: %s)', async date1904 => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-GB');
    const sheet = (await loadXlsxWorkbook(await createSystemDateFormatWorkbook(date1904))).sheets[0];
    const table = createSheetTable(sheet, 1);
    expect(Array.from({ length: 4 }, (_, i) => select(table, 1, i + 1)?.textContent)).toEqual([
      date1904 ? 'Tuesday, 1 March 1904' : 'Wednesday, 29 February 1900', '14:30:45',
      'Thursday, 29 February 2024', '02:30:45'
    ]);
    expect(select(table, 1, 4)?.style.color).toBe('rgb(0, 0, 255)');
    expect(resolveCellValue(sheet, sheet.rows[0].cells[2])).toBe(date1904 ? '43889' : '45351');
  });

  it('uses only the active system directive and preserves Excel calendar boundaries', () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-GB');
    const date = '[$-F800]', time = '[$-00f400]';
    const code = `[Blue][>=100]${time}h:mm:ss AM/PM;[Red][>0]${date}dddd, mmmm d, yyyy;0;[Cyan]"ID "@`;
    expect(format('100.5', undefined, code)).toEqual({ text: '12:00:00', color: '#0000FF' });
    expect(format('60.5', undefined, code)).toEqual({ text: 'Wednesday, 29 February 1900', color: '#FF0000' });
    expect(format('0', undefined, code)).toEqual({ text: '0' });
    expect(format('001', 'text', code)).toEqual({ text: 'ID 001', color: '#00FFFF' });
    expect(formatCellValue('3', undefined, `"${date}" 0`)).toBe('[$-F800] 3');
    expect(formatCellValue('0', undefined, date)).toBe('Saturday, 0 January 1900');
    expect(formatCellValue('1', undefined, date)).toBe('Sunday, 1 January 1900');
    expect(formatCellValue('0', undefined, date, true)).toBe('Friday, 1 January 1904');
    expect(formatCellValue('2958465.999999', undefined, date)).toBe('Friday, 31 December 9999');
    expect(formatCellValue('2958465.999999', undefined, time)).toBe('00:00:00');
    expect(formatCellValue('2958466', undefined, date)).toBe('2958466');
  });

  it('keeps literal brackets and scientific notation intact when selecting colors', () => {
    const code = '[Red][<=100]0.0;[Blue][>100]0.0;[Color56]0;[Magenta]"ID "@';
    expect(format('100', undefined, code)).toEqual({ text: '100.0', color: '#FF0000' });
    expect(format('101', undefined, code)).toEqual({ text: '101.0', color: '#0000FF' });
    expect(format('004', 'text', code)).toEqual({ text: 'ID 004', color: '#FF00FF' });
    expect(format('-10.05', undefined, '[Red][<=100];[Blue][>100]')).toEqual({ text: '-10.05', color: '#FF0000' });
    expect(format('101', undefined, '[Red][<=100];[Blue][>100]')).toEqual({ text: '101', color: '#0000FF' });
    expect(format('20', undefined, '[Color56]0')).toEqual({ text: '20', color: '#333333' });
    expect(format('25', undefined, '"[Red]" 0')).toEqual({ text: '[Red] 25' });
    expect(format('25', undefined, '[Red]"unterminated')).toEqual({ text: '25' });
    expect(format('-123.5', undefined, '[Red]0.00E+00')).toEqual({ text: '-1.24E+02', color: '#FF0000' });
  });
});
