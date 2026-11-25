import { parseSheetRange } from './columns';
import { readColorScale, readDataBar, readIconSet } from './conditional-visual-rules';
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
    case 'top10': {
      const raw = readPath(entry, ['rank']);
      const percent = isTrue(readPath(entry, ['percent']));
      if (typeof raw !== 'string' || !/^\+?\d+$/.test(raw)) return undefined;
      const rank = Number(raw);
      if (percent ? rank > 100 : rank < 1 || rank > 1000) return undefined;
      return { type, rank, bottom: isTrue(readPath(entry, ['bottom'])), percent };
    }
    case 'aboveAverage': {
      const above = readPath(entry, ['aboveAverage']);
      const raw = readPath(entry, ['stdDev']) ?? '0';
      if (typeof raw !== 'string' || !/^\+?\d+$/.test(raw) || Number(raw) > 0x7fffffff) return undefined;
      return { type, above: above === undefined || isTrue(above), equal: isTrue(readPath(entry, ['equalAverage'])),
        deviations: Number(raw) };
    }
    case 'containsBlanks': case 'notContainsBlanks': case 'containsErrors': case 'notContainsErrors':
    case 'duplicateValues': case 'uniqueValues':
      return { type };
    case 'colorScale': return readColorScale(readPath(entry, ['colorScale']), color);
    case 'dataBar': return readDataBar(readPath(entry, ['dataBar']), color, rightToLeft);
    case 'iconSet': return readIconSet(readPath(entry, ['iconSet']));
    default: return type ? 'unsupported' : undefined;
  }
}

function readConditionalExtensions(worksheet: unknown) {
  const linkedBars = new Map<string, unknown>();
  const standalone: { entry: unknown; references: string }[] = [];
  for (const ext of toArray(readPath(worksheet, ['extLst', 'ext']))) {
    if (String(readPath(ext, ['uri'])).toLowerCase() !== extensionUri) continue;
    for (const group of toArray(readLocalPath(ext, ['conditionalFormattings', 'conditionalFormatting']))) {
      const references = readTextValue(readLocalPath(group, ['sqref']));
      for (const entry of toArray(readLocalPath(group, ['cfRule']))) {
        const type = readPath(entry, ['type']);
        if (type !== 'dataBar' && type !== 'iconSet') continue;
        if (readPath(entry, ['priority']) !== undefined) {
          standalone.push({ entry, references });
          continue;
        }
        const id = readPath(entry, ['id']);
        if (type === 'dataBar' && typeof id === 'string' && id) linkedBars.set(id.toLowerCase(), entry);
      }
    }
  }
  return { linkedBars, standalone };
}

function readActiveFormula(rule: unknown): string | false | undefined {
  const node = readLocalPath(rule, ['f']);
  if (node === undefined) return isTrue(readPath(rule, ['activePresent'])) ? false : undefined;
  const formula = readTextValue(node).trim();
  return formula.length > 0 && formula.length <= MAX_FORMULA_LENGTH ? formula : false;
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
  const { linkedBars, standalone } = readConditionalExtensions(worksheet);
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
      let activeFormula: string | undefined;
      if (condition.type === 'dataBar' && linkedBars.size) {
        const id = linkedDataBarId(entry);
        const extension = id ? linkedBars.get(id) : undefined;
        if (extension && id) {
          const extended = readDataBar(readLocalPath(extension, ['dataBar']), color, rightToLeft, true, condition);
          const formula = readActiveFormula(extension);
          if (extended && formula !== false) { condition = extended; activeFormula = formula; }
          else invalid++;
          linkedBars.delete(id);
        }
      }
      const stop = readPath(entry, ['stopIfTrue']);
      rules.push({ ranges, priority, condition, stopIfTrue: isTrue(stop), ...(style ? { style } : {}), ...(activeFormula ? { activeFormula } : {}) });
    }
  }
  for (const { entry, references } of standalone) {
    const priority = Number(readPath(entry, ['priority'])), ranges = readRanges(references);
    const condition = readPath(entry, ['type']) === 'iconSet'
      ? readIconSet(readLocalPath(entry, ['iconSet']), true)
      : readDataBar(readLocalPath(entry, ['dataBar']), color, rightToLeft, true);
    const activeFormula = readActiveFormula(entry);
    if (!ranges || !condition || activeFormula === false || !Number.isSafeInteger(priority) || priority < 1) { invalid++; continue; }
    rules.push({ ranges, priority, condition, stopIfTrue: isTrue(readPath(entry, ['stopIfTrue'])), ...(activeFormula ? { activeFormula } : {}) });
  }
  if (invalid) warnings.push(`Ignored ${invalid} invalid conditional formatting rules in sheet ${sheet}.`);
  if (unsupported) warnings.push(`Skipped ${unsupported} unsupported conditional formatting rules in sheet ${sheet}.`);
  return rules.sort((a, b) => a.priority - b.priority);
}
