import { evaluateWorksheetFormula, readCellScalar, resolveCellValue } from './cell-value';
import { formulaClock, withFormulaTime } from './formula-clock';
import { createRangeValueReader, numericCellValue, type ConditionalRangeValues } from './conditional-range-values';
import { compileVisualRule, type ConditionalAppearance } from './conditional-visuals';
import { compareFormulaValues } from './formula-reader';
import { excelSerialFromTimestamp } from './excel-calendar';
import { RowRangeIndex } from './row-range-index';
import { createFormulaTranslator } from './shared-formulas';
import type { ConditionalDatePeriod, ParsedCell, ParsedConditionalRule, ParsedMerge, ParsedSheet } from './types';
import { wildcardMatcher } from './wildcard-matcher';
import { cellBorders } from './cell-borders';

interface RankedRule { order: number; rule: ParsedConditionalRule }
interface RuleArea extends ParsedMerge { rules: RankedRule[] }
type RuleTest = (row: number, column: number, cell?: ParsedCell) => boolean | ConditionalAppearance;
type RangeReader = () => ConditionalRangeValues | undefined;
const indexes = new WeakMap<ParsedSheet, {
  index: RowRangeIndex<RuleArea>;
  tests: Map<ParsedConditionalRule, RuleTest>;
  rangeReaders: Map<readonly ParsedMerge[], RangeReader>;
}>();

/** Select only the declared ranges that intersect this batch of visible cells. */
export function conditionalFormattingWindow(sheet: ParsedSheet, firstRow: number, lastRow: number, firstColumn: number, lastColumn: number) {
  if (!sheet.conditionalRules?.length) return undefined;
  let state = indexes.get(sheet);
  if (!state) {
    const groups = new Map<readonly ParsedMerge[], RankedRule[]>();
    for (const [order, rule] of sheet.conditionalRules.entries()) {
      const rules = groups.get(rule.ranges);
      if (rules) rules.push({ rule, order });
      else groups.set(rule.ranges, [{ rule, order }]);
    }
    const areas: RuleArea[] = [];
    const rangeReaders = new Map<readonly ParsedMerge[], RangeReader>();
    for (const [ranges, rules] of groups) {
      for (const range of ranges) areas.push({ ...range, rules });
      const readRange = createRangeValueReader(sheet, ranges, rules.map(({ rule }) => rule.condition));
      if (readRange) rangeReaders.set(ranges, readRange);
    }
    state = { index: new RowRangeIndex(areas), tests: new Map(), rangeReaders };
    indexes.set(sheet, state);
  }
  const { index, tests, rangeReaders } = state;
  const intersect = (top: number, bottom: number, left: number, right: number) => {
    const groups = new Map<RankedRule[], RuleArea[]>();
    index.forEach(top, bottom, area => {
      const areas = groups.get(area.rules);
      if (areas) areas.push(area);
      else groups.set(area.rules, [area]);
    }, [left, right]);
    const candidates: (RankedRule & { areas: RuleArea[] })[] = [];
    for (const [rules, areas] of groups) for (const rule of rules) candidates.push({ ...rule, areas });
    return candidates.sort((a, b) => a.rule.priority - b.rule.priority || a.order - b.order);
  };
  const visible = intersect(firstRow, lastRow, firstColumn, lastColumn);
  let dateTests: Map<ParsedConditionalRule, RuleTest> | undefined;
  let today: Date | undefined;
  return (row: number, column: number, cell?: ParsedCell): ConditionalAppearance | undefined => {
    // A clipped merge can display a logical anchor outside the visible window.
    const candidates = row >= firstRow && row <= lastRow && column >= firstColumn && column <= lastColumn
      ? visible : intersect(row, row, column, column);
    if (cell && candidates.length) resolveCellValue(sheet, cell);
    let result: ConditionalAppearance | undefined;
    for (const { rule, areas } of candidates) {
      if (!areas.some(area => row >= area.firstRow && row <= area.lastRow && column >= area.firstColumn && column <= area.lastColumn)) continue;
      const testCache = rule.condition.type === 'timePeriod' ? dateTests ??= new Map() : tests;
      let test = testCache.get(rule);
      if (!test) {
        if (rule.condition.type === 'timePeriod' && !today) {
          const clock = formulaClock(sheet);
          today = new Date(clock.time ?? Date.now());
          clock.reads++;
        }
        test = compileRule(sheet, rule, rangeReaders.get(rule.ranges), today);
        testCache.set(rule, test);
      }
      const match = test(row, column, cell);
      if (!match) continue;
      const style = match === true ? rule.style : rule.style ? { ...rule.style, ...match } : match;
      if (style) {
        const first: ConditionalAppearance | undefined = result;
        const merged: ConditionalAppearance = first ? { ...style, ...first } : style;
        if (style.borders && first?.borders) {
          merged.borders = { ...style.borders, ...first.borders };
          // Resolve rule priority on the physical edges for each direction.
          if (style.rtlBorders || first.rtlBorders) merged.rtlBorders = { ...cellBorders(style, true), ...cellBorders(first, true) };
        }
        result = merged;
      }
      if (rule.stopIfTrue) break;
    }
    return result;
  };
}

function compileRule(sheet: ParsedSheet, rule: ParsedConditionalRule, readRange?: RangeReader, today?: Date): RuleTest {
  const { condition } = rule;
  const origin = rule.ranges[0];
  const expression = (source: string) => {
    const trimmed = source.replace(/^=\s*/, '');
    if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) {
      const number = Number(trimmed);
      return () => Number.isFinite(number) ? number : undefined;
    }
    const translate = createFormulaTranslator(source);
    return (row: number, column: number) => evaluateWorksheetFormula(sheet,
      translate(row - origin.firstRow, column - origin.firstColumn), { row, column });
  };
  const isTrue = (value: ReturnType<typeof evaluateWorksheetFormula>) => value === true || typeof value === 'number' && value !== 0;
  switch (condition.type) {
    case 'colorScale': case 'dataBar': case 'iconSet': {
      const format = compileVisualRule(sheet, condition, origin, readRange!);
      if (!rule.activeFormula) return format;
      const active = expression(rule.activeFormula);
      return (row, column, cell) => isTrue(active(row, column)) && format(row, column, cell);
    }
    case 'expression': {
      const evaluate = expression(condition.formula);
      return (row, column) => isTrue(evaluate(row, column));
    }
    case 'cellIs': {
      const [lower, upper] = condition.formulas.map(expression);
      const { operator } = condition;
      return (row, column, cell) => {
        let value;
        try { value = readCellScalar(sheet, cell); }
        catch { return false; }
        const first = lower(row, column);
        if (first === undefined) return false;
        value ??= typeof first === 'string' ? '' : typeof first === 'boolean' ? false : 0;
        if (typeof value !== typeof first) return operator === '<>';
        if (operator !== 'between' && operator !== 'notBetween') return compareFormulaValues(value, first, operator);
        const last = upper(row, column);
        if (last === undefined || typeof value !== typeof last) return false;
        const [min, max] = compareFormulaValues(first, last, '<=') ? [first, last] : [last, first];
        const inside = compareFormulaValues(value, min, '>=') && compareFormulaValues(value, max, '<=');
        return operator === 'between' ? inside : !inside;
      };
    }
    case 'containsBlanks': return (_, __, cell) => /^ *$/.test(cell?.value ?? '');
    case 'notContainsBlanks': return (_, __, cell) => !isUnresolved(cell) && !/^ *$/.test(cell?.value ?? '');
    case 'containsErrors': return (_, __, cell) => cell?.valueType === 'error';
    case 'notContainsErrors': return (_, __, cell) => !isUnresolved(cell) && cell?.valueType !== 'error';
    case 'top10': return (_, __, cell) => {
      if (!condition.rank) return false;
      const value = numericCellValue(sheet, cell);
      if (value === undefined) return false;
      const cutoff = readRange!()?.ranks.get(condition);
      return cutoff !== undefined && (condition.bottom ? value <= cutoff : value >= cutoff);
    };
    case 'aboveAverage': return (_, __, cell) => withFormulaTime(sheet, () => {
      const value = numericCellValue(sheet, cell);
      const stats = value === undefined ? undefined : readRange!();
      if (value === undefined || !stats) return false;
      if (!condition.equal && condition.deviations) return stats.matchesDeviation!(value, condition.above, condition.deviations);
      const { center, scale, mean } = stats.average;
      const shifted = value / scale - center;
      if (condition.equal) return condition.above ? shifted >= mean : shifted <= mean;
      return condition.above ? shifted > mean : shifted < mean;
    });
    case 'duplicateValues': case 'uniqueValues': return (_, __, cell) => {
      if (!cell) return false;
      const count = readRange!()?.frequency(cell) ?? 0;
      return condition.type === 'duplicateValues' ? count > 1 : count === 1;
    };
    case 'timePeriod': {
      const [start, end] = datePeriodBounds(condition.period, today!, sheet.date1904);
      return (_, __, cell) => {
        const value = numericCellValue(sheet, cell);
        return value !== undefined && value >= start && value < end;
      };
    }
    default: {
      const text = condition.text.toLowerCase();
      const search = condition.type === 'containsText' || condition.type === 'notContainsText' ? wildcardMatcher(text, true) : undefined;
      return (_, __, cell) => {
        let value;
        try { value = readCellScalar(sheet, cell); }
        catch { return false; }
        const input = value === null ? '' : String(value).toLowerCase();
        if (condition.type === 'beginsWith') return input.startsWith(text);
        if (condition.type === 'endsWith') return input.endsWith(text);
        return search!(input) === (condition.type === 'containsText');
      };
    }
  }
}

function datePeriodBounds(period: ConditionalDatePeriod, today: Date, date1904?: boolean): [number, number] {
  const year = today.getFullYear(), month = today.getMonth(), day = today.getDate();
  // Use the local calendar date with UTC arithmetic so DST cannot shift the serial boundaries.
  const serial = (monthIndex: number, dayIndex: number) =>
    excelSerialFromTimestamp(Date.UTC(year, monthIndex, dayIndex), date1904);
  switch (period) {
    case 'yesterday': return [serial(month, day - 1), serial(month, day)];
    case 'today': return [serial(month, day), serial(month, day + 1)];
    case 'tomorrow': return [serial(month, day + 1), serial(month, day + 2)];
    case 'last7Days': return [serial(month, day - 6), serial(month, day + 1)];
    case 'lastWeek': case 'thisWeek': case 'nextWeek': {
      const sunday = day - today.getDay() + (period === 'lastWeek' ? -7 : period === 'nextWeek' ? 7 : 0);
      return [serial(month, sunday), serial(month, sunday + 7)];
    }
    case 'lastMonth': case 'thisMonth': case 'nextMonth': {
      const first = month + (period === 'lastMonth' ? -1 : period === 'nextMonth' ? 1 : 0);
      return [serial(first, 1), serial(first + 1, 1)];
    }
  }
}

function isUnresolved(cell?: ParsedCell): boolean {
  return cell?.valueType === undefined && cell?.value[0] === '=';
}
