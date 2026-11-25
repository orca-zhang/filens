import { evaluateWorksheetFormula, readCellScalar } from './cell-value';
import { compareFormulaValues } from './formula-reader';
import { RowRangeIndex } from './row-range-index';
import { createFormulaTranslator } from './shared-formulas';
import type { ParsedCell, ParsedConditionalRule, ParsedConditionalStyle, ParsedMerge, ParsedSheet } from './types';

interface RankedRule { order: number; rule: ParsedConditionalRule }
interface RuleArea extends ParsedMerge { rules: RankedRule[] }
type RuleTest = (row: number, column: number, cell?: ParsedCell) => boolean;
const indexes = new WeakMap<ParsedSheet, { index: RowRangeIndex<RuleArea>; tests: Map<ParsedConditionalRule, RuleTest> }>();

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
    for (const [ranges, rules] of groups) for (const range of ranges) areas.push({ ...range, rules });
    state = { index: new RowRangeIndex(areas), tests: new Map() };
    indexes.set(sheet, state);
  }
  const { index, tests } = state;
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
  return (row: number, column: number, cell?: ParsedCell): ParsedConditionalStyle | undefined => {
    // A clipped merge can display a logical anchor outside the visible window.
    const candidates = row >= firstRow && row <= lastRow && column >= firstColumn && column <= lastColumn
      ? visible : intersect(row, row, column, column);
    let result: ParsedConditionalStyle | undefined;
    for (const { rule, areas } of candidates) {
      if (!areas.some(area => row >= area.firstRow && row <= area.lastRow && column >= area.firstColumn && column <= area.lastColumn)) continue;
      let test = tests.get(rule);
      if (!test) { test = compileRule(sheet, rule); tests.set(rule, test); }
      if (!test(row, column, cell)) continue;
      if (rule.style) {
        const first = result;
        result = first ? { ...rule.style, ...first } : rule.style;
        if (rule.style.borders && first?.borders) result.borders = { ...rule.style.borders, ...first.borders };
      }
      if (rule.stopIfTrue) break;
    }
    return result;
  };
}

function compileRule(sheet: ParsedSheet, rule: ParsedConditionalRule): RuleTest {
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
  switch (condition.type) {
    case 'expression': {
      const evaluate = expression(condition.formula);
      return (row, column) => {
        const value = evaluate(row, column);
        return value === true || typeof value === 'number' && value !== 0;
      };
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
    default: {
      const text = condition.text.toLowerCase();
      const search = condition.type === 'containsText' || condition.type === 'notContainsText' ? textSearch(text) : undefined;
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

function textSearch(pattern: string): (input: string) => boolean {
  if (!/[*?~]/.test(pattern)) return input => input.includes(pattern);
  const literals = new Map<string, bigint>();
  let stars = 0n, wildcards = 0n, state = 1n, previousStar = false;
  const tokens = Array.from(pattern);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === '*') {
      if (previousStar) continue;
      stars |= state;
    } else if (token === '?') wildcards |= state;
    else {
      const literal = token === '~' && /[*?~]/.test(tokens[i + 1] ?? '') ? tokens[++i] : token;
      literals.set(literal, (literals.get(literal) ?? 0n) | state);
    }
    previousStar = token === '*';
    state <<= 1n;
  }
  const accept = state;
  return input => {
    // Advance all wildcard states together, including a fresh search at each character.
    let active = 1n | ((1n & stars) << 1n);
    for (const char of input) {
      if (active & accept) return true;
      const matches = wildcards | (literals.get(char) ?? 0n);
      const next = ((active & matches) << 1n) | (active & stars) | 1n;
      active = next | ((next & stars) << 1n);
    }
    return (active & accept) !== 0n;
  };
}
