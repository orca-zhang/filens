import { evaluateWorksheetFormula, readCellScalar } from './cell-value';
import { createRangeValueReader, numericCellValue, type ConditionalRangeValues } from './conditional-range-values';
import { compileVisualRule, type ConditionalAppearance } from './conditional-visuals';
import { compareFormulaValues } from './formula-reader';
import { RowRangeIndex } from './row-range-index';
import { createFormulaTranslator } from './shared-formulas';
import type { ParsedCell, ParsedConditionalRule, ParsedMerge, ParsedSheet } from './types';
import { wildcardMatcher } from './wildcard-matcher';

interface RankedRule { order: number; rule: ParsedConditionalRule }
interface RuleArea extends ParsedMerge { rules: RankedRule[] }
type RuleTest = (row: number, column: number, cell?: ParsedCell) => boolean | ConditionalAppearance;
type RangeReader = () => ConditionalRangeValues;
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
      if (area.firstColumn > right || area.lastColumn < left) return;
      const areas = groups.get(area.rules);
      if (areas) areas.push(area);
      else groups.set(area.rules, [area]);
    });
    const candidates: (RankedRule & { areas: RuleArea[] })[] = [];
    for (const [rules, areas] of groups) for (const rule of rules) candidates.push({ ...rule, areas });
    return candidates.sort((a, b) => a.rule.priority - b.rule.priority || a.order - b.order);
  };
  const visible = intersect(firstRow, lastRow, firstColumn, lastColumn);
  return (row: number, column: number, cell?: ParsedCell): ConditionalAppearance | undefined => {
    // A clipped merge can display a logical anchor outside the visible window.
    const candidates = row >= firstRow && row <= lastRow && column >= firstColumn && column <= lastColumn
      ? visible : intersect(row, row, column, column);
    let result: ConditionalAppearance | undefined;
    for (const { rule, areas } of candidates) {
      if (!areas.some(area => row >= area.firstRow && row <= area.lastRow && column >= area.firstColumn && column <= area.lastColumn)) continue;
      let test = tests.get(rule);
      if (!test) { test = compileRule(sheet, rule, rangeReaders.get(rule.ranges)); tests.set(rule, test); }
      const match = test(row, column, cell);
      if (!match) continue;
      const style = match === true ? rule.style : rule.style ? { ...rule.style, ...match } : match;
      if (style) {
        const first = result;
        result = first ? { ...style, ...first } : style;
        if (style.borders && first?.borders) result.borders = { ...style.borders, ...first.borders };
      }
      if (rule.stopIfTrue) break;
    }
    return result;
  };
}

function compileRule(sheet: ParsedSheet, rule: ParsedConditionalRule, readRange?: RangeReader): RuleTest {
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
      const cutoff = readRange!().ranks.get(condition);
      return cutoff !== undefined && (condition.bottom ? value <= cutoff : value >= cutoff);
    };
    case 'aboveAverage': return (_, __, cell) => {
      const value = numericCellValue(sheet, cell);
      if (value === undefined) return false;
      const { center, scale, mean, deviation } = readRange!().average;
      const shifted = value / scale - center;
      if (condition.equal) return condition.above ? shifted >= mean : shifted <= mean;
      const distance = deviation * condition.deviations;
      return condition.above ? shifted > mean + distance : shifted < mean - distance;
    };
    case 'duplicateValues': case 'uniqueValues': return (_, __, cell) => {
      if (!cell) return false;
      const count = readRange!().frequency(cell);
      return condition.type === 'duplicateValues' ? count > 1 : count === 1;
    };
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

function isUnresolved(cell?: ParsedCell): boolean {
  return cell?.valueType === undefined && cell?.value[0] === '=';
}
