import { parseSheetRange } from './columns';
import { readColorScale, readDataBar } from './conditional-visual-rules';
import { MAX_FORMULA_LENGTH } from './formula-reader';
import { readTextValue } from './rich-text';
import type { colorReader } from './style-appearance';
import type { ConditionalComparison, ParsedCondition, ParsedConditionalRule, ParsedConditionalStyle } from './types';
import { readLocalPath, readPath, toArray } from './xml-values';

const comparisons = new Map<string, ConditionalComparison>([
  ['equal', '='], ['notEqual', '<>'], ['lessThan', '<'], ['lessThanOrEqual', '<='], ['greaterThan', '>'],
  ['greaterThanOrEqual', '>='], ['between', 'between'], ['notBetween', 'notBetween']
]);

type ReadColor = ReturnType<typeof colorReader>;
const extensionUri = '{78c0d931-6437-407d-a8ee-f0aad7539e65}';
const ruleExtensionUri = '{b025f937-c7b1-47d3-b67f-a62eff666e3e}';
const isTrue = (value: unknown) => value === '1' || value === 'true';

function readCondition(entry: unknown, color: ReadColor, rightToLeft: boolean): ParsedCondition | 'unsupported' | undefined {
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
    case 'colorScale': return readColorScale(readPath(entry, ['colorScale']), color);
    case 'dataBar': return readDataBar(readPath(entry, ['dataBar']), color, rightToLeft);
    default: return type ? 'unsupported' : undefined;
  }
}

function readDataBarExtensions(worksheet: unknown) {
  const extensions = new Map<string, { entry: unknown; references: string }>();
  for (const ext of toArray(readPath(worksheet, ['extLst', 'ext']))) {
    if (String(readPath(ext, ['uri'])).toLowerCase() !== extensionUri) continue;
    for (const group of toArray(readLocalPath(ext, ['conditionalFormattings', 'conditionalFormatting']))) {
      const references = readTextValue(readLocalPath(group, ['sqref']));
      for (const entry of toArray(readLocalPath(group, ['cfRule']))) {
        if (readPath(entry, ['type']) !== 'dataBar') continue;
        const id = readPath(entry, ['id']);
        if (typeof id === 'string' && id) extensions.set(id.toLowerCase(), { entry, references });
      }
    }
  }
  return extensions;
}

function linkedDataBarId(rule: unknown): string | undefined {
  for (const extension of toArray(readPath(rule, ['extLst', 'ext']))) {
    if (String(readPath(extension, ['uri'])).toLowerCase() !== ruleExtensionUri) continue;
    const id = readTextValue(readLocalPath(extension, ['id'])).trim();
    if (id) return id.toLowerCase();
  }
}

function readRanges(ref: string) {
  const ranges = ref.trim().split(/\s+/).map(parseSheetRange);
  return ranges.every(range => range !== undefined) ? ranges : undefined;
}

export function readConditionalRules(document: unknown, styles: readonly ParsedConditionalStyle[],
  color: ReadColor, warnings: string[], sheet: string): ParsedConditionalRule[] {
  const rules: ParsedConditionalRule[] = [];
  const worksheet = readPath(document, ['worksheet']);
  const rightToLeft = isTrue(readPath(toArray(readPath(worksheet, ['sheetViews', 'sheetView']))[0], ['rightToLeft']));
  const extensions = readDataBarExtensions(worksheet);
  let invalid = 0, unsupported = 0;
  for (const group of toArray(readPath(worksheet, ['conditionalFormatting']))) {
    const entries = toArray(readPath(group, ['cfRule']));
    const ranges = readRanges(String(readPath(group, ['sqref']) ?? ''));
    if (!ranges) { invalid += entries.length; continue; }
    for (const entry of entries) {
      let condition = readCondition(entry, color, rightToLeft);
      if (condition === 'unsupported') { unsupported++; continue; }
      const priority = Number(readPath(entry, ['priority']));
      const dxf = readPath(entry, ['dxfId']);
      const style = typeof dxf === 'string' && /^\d+$/.test(dxf) ? styles[Number(dxf)] : undefined;
      if (!condition || !Number.isSafeInteger(priority) || priority < 1 || (dxf !== undefined && !style)) {
        invalid++;
        continue;
      }
      if (condition.type === 'dataBar' && extensions.size) {
        const id = linkedDataBarId(entry);
        const extension = id ? extensions.get(id) : undefined;
        if (extension && id) {
          const extended = readDataBar(readLocalPath(extension.entry, ['dataBar']), color, rightToLeft, true, condition);
          if (extended) condition = extended;
          else invalid++;
          extensions.delete(id);
        }
      }
      const stop = readPath(entry, ['stopIfTrue']);
      rules.push({ ranges, priority, condition, stopIfTrue: isTrue(stop), ...(style ? { style } : {}) });
    }
  }
  for (const { entry, references } of extensions.values()) {
    const rawPriority = readPath(entry, ['priority']);
    if (rawPriority === undefined) continue;
    const priority = Number(rawPriority), ranges = readRanges(references);
    const condition = readDataBar(readLocalPath(entry, ['dataBar']), color, rightToLeft, true);
    if (!ranges || !condition || !Number.isSafeInteger(priority) || priority < 1) { invalid++; continue; }
    rules.push({ ranges, priority, condition, stopIfTrue: isTrue(readPath(entry, ['stopIfTrue'])) });
  }
  if (invalid) warnings.push(`Ignored ${invalid} invalid conditional formatting rules in sheet ${sheet}.`);
  if (unsupported) warnings.push(`Skipped ${unsupported} unsupported conditional formatting rules in sheet ${sheet}.`);
  return rules.sort((a, b) => a.priority - b.priority);
}
