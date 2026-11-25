import { parseSheetRange } from './columns';
import { MAX_FORMULA_LENGTH } from './formula-reader';
import { readTextValue } from './rich-text';
import type { ConditionalComparison, ParsedCondition, ParsedConditionalRule, ParsedConditionalStyle } from './types';
import { readPath, toArray } from './xml-values';

const comparisons = new Map<string, ConditionalComparison>([
  ['equal', '='], ['notEqual', '<>'], ['lessThan', '<'], ['lessThanOrEqual', '<='], ['greaterThan', '>'],
  ['greaterThanOrEqual', '>='], ['between', 'between'], ['notBetween', 'notBetween']
]);

function readCondition(entry: unknown): ParsedCondition | 'unsupported' | undefined {
  const type = readPath(entry, ['type']);
  switch (type) {
    case 'cellIs': case 'expression': {
      const formulas = toArray(readPath(entry, ['formula'])).map(formula => readTextValue(formula).trim());
      if (formulas.some(formula => !formula || formula.length > MAX_FORMULA_LENGTH)) return undefined;
      if (type === 'expression') return formulas.length === 1 ? { type, formula: formulas[0] } : undefined;
      const operator = comparisons.get(String(readPath(entry, ['operator'])));
      if (!operator || formulas.length !== (operator === 'between' || operator === 'notBetween' ? 2 : 1)) return undefined;
      return { type, operator, formulas };
    }
    case 'containsText': case 'notContainsText': case 'beginsWith': case 'endsWith': {
      const text = readPath(entry, ['text']);
      return typeof text === 'string' && text.length <= 255 ? { type, text } : undefined;
    }
    case 'containsBlanks': case 'notContainsBlanks': case 'containsErrors': case 'notContainsErrors':
      return { type };
    default: return type ? 'unsupported' : undefined;
  }
}

export function readConditionalRules(document: unknown, styles: readonly ParsedConditionalStyle[],
  warnings: string[], sheet: string): ParsedConditionalRule[] {
  const rules: ParsedConditionalRule[] = [];
  let invalid = 0, unsupported = 0;
  for (const group of toArray(readPath(document, ['worksheet', 'conditionalFormatting']))) {
    const entries = toArray(readPath(group, ['cfRule']));
    const ranges = String(readPath(group, ['sqref']) ?? '').trim().split(/\s+/).map(parseSheetRange);
    if (!ranges.every(range => range !== undefined)) { invalid += entries.length; continue; }
    for (const entry of entries) {
      const condition = readCondition(entry);
      if (condition === 'unsupported') { unsupported++; continue; }
      const priority = Number(readPath(entry, ['priority']));
      const dxf = readPath(entry, ['dxfId']);
      const style = typeof dxf === 'string' && /^\d+$/.test(dxf) ? styles[Number(dxf)] : undefined;
      if (!condition || !Number.isSafeInteger(priority) || priority < 1 || (dxf !== undefined && !style)) {
        invalid++;
        continue;
      }
      const stop = readPath(entry, ['stopIfTrue']);
      rules.push({ ranges, priority, condition, stopIfTrue: stop === '1' || stop === 'true', ...(style ? { style } : {}) });
    }
  }
  if (invalid) warnings.push(`Ignored ${invalid} invalid conditional formatting rules in sheet ${sheet}.`);
  if (unsupported) warnings.push(`Skipped ${unsupported} unsupported conditional formatting rules in sheet ${sheet}.`);
  return rules.sort((a, b) => a.priority - b.priority);
}
