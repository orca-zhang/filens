import { columnIndexToName, columnNameToIndex } from './columns';
import { readPath } from './xml-values';
import { structuredBracketEnd } from './structured-references';
import type { ParsedCell, ParsedRow, ParsedSharedFormula, ParsedSheet } from './types';

const MAX_ROW = 1_048_576;
const MAX_COLUMN = 16_384;
const MAX_FORMULA_LENGTH = 8192;
const cellAddress = /^(\$?)([A-Z]{1,3})(\$?)([1-9]\d*)$/i;
const rowAddress = /^(\$?)([1-9]\d*)$/;
const columnAddress = /^(\$?)([A-Z]{1,3})$/i;

export class SharedFormulaReader {
  private readonly groups = new Map<number, ParsedSharedFormula>();
  private readonly masters = new Set<number>();
  private hasFollowers = false;
  private invalid = 0;

  add(node: unknown, cell: ParsedCell, uncached: boolean): void {
    const si = readPath(node, ['si']);
    const id = typeof si === 'string' && /^\d+$/.test(si) ? Number(si) : NaN;
    if (!Number.isSafeInteger(id) || id > 0xffffffff) {
      if (uncached && !cell.formula) delete cell.valueType;
      this.invalid++;
      return;
    }
    if (!cell.formula?.trim()) {
      delete cell.formula;
      cell.sharedFormulaId = id;
      cell.needsCalculation = uncached;
      this.hasFollowers = true;
      return;
    }

    const ref = String(readPath(node, ['ref']) ?? '');
    const [start, end = start, extra] = ref.trim().split(':');
    const first = parseAddress(start), last = parseAddress(end);
    const anchor = parseAddress(cell.ref);
    if (this.masters.has(id)) {
      this.groups.delete(id);
      this.invalid++;
    } else if (extra !== undefined || !first || !last || !anchor || cell.formula.length > MAX_FORMULA_LENGTH
      || anchor.row < first.row || anchor.row > last.row || anchor.column < first.column || anchor.column > last.column) {
      this.invalid++;
    } else {
      this.groups.set(id, { ...anchor, formula: cell.formula, firstRow: first.row, lastRow: last.row,
        firstColumn: first.column, lastColumn: last.column });
    }
    this.masters.add(id);
  }

  finish(rows: readonly ParsedRow[], warnings: string[], name: string): ParsedSheet['sharedFormulas'] {
    if (this.hasFollowers) {
      for (const row of rows) for (const cell of row.cells) {
        if (cell.sharedFormulaId === undefined) continue;
        const group = this.groups.get(cell.sharedFormulaId);
        if (group && cell.row >= group.firstRow && cell.row <= group.lastRow
          && cell.column >= group.firstColumn && cell.column <= group.lastColumn) continue;
        if (cell.needsCalculation) delete cell.valueType;
        delete cell.sharedFormulaId;
        delete cell.needsCalculation;
        this.invalid++;
      }
    }
    if (this.invalid) warnings.push('Ignored ' + this.invalid + ' invalid shared formula entries in sheet ' + name + '.');
    return this.groups.size ? Object.fromEntries(this.groups) : undefined;
  }
}

type Axis = { value: number; fixed: boolean };
type FormulaPart = string | { token: string; row?: Axis; column?: Axis };
const translators = new WeakMap<ParsedSharedFormula, ReturnType<typeof createFormulaTranslator>>();

export function resolveSharedFormula(sheet: ParsedSheet, cell: ParsedCell): string | undefined {
  const group = cell.sharedFormulaId === undefined ? undefined : sheet.sharedFormulas?.[cell.sharedFormulaId];
  if (!group) return undefined;
  const rows = cell.row - group.row, columns = cell.column - group.column;
  if (!rows && !columns) return group.formula;
  let translate = translators.get(group);
  if (!translate) {
    translate = createFormulaTranslator(group.formula);
    translators.set(group, translate);
  }
  return translate(rows, columns);
}

export function createFormulaTranslator(formula: string): (rows: number, columns: number) => string {
  const plan = translationPlan(formula);
  return (rows, columns) => !rows && !columns ? formula : plan.map(part => {
    if (typeof part === 'string') return part;
    const row = part.row && part.row.value + (part.row.fixed ? 0 : rows);
    const column = part.column && part.column.value + (part.column.fixed ? 0 : columns);
    if ((row !== undefined && (row < 1 || row > MAX_ROW))
      || (column !== undefined && (column < 1 || column > MAX_COLUMN))) return '#REF!';
    if (row === part.row?.value && column === part.column?.value) return part.token;
    return (column === undefined ? '' : (part.column?.fixed ? '$' : '') + columnIndexToName(column))
      + (row === undefined ? '' : (part.row?.fixed ? '$' : '') + row);
  }).join('');
}

function parseAddress(value: string): { row: number; column: number } | undefined {
  const match = cellAddress.exec(value);
  if (!match) return undefined;
  const column = columnNameToIndex(match[2]), row = Number(match[4]);
  return row <= MAX_ROW && column <= MAX_COLUMN ? { row, column } : undefined;
}

function translationPlan(source: string): FormulaPart[] {
  // Keep quoted text, sheet names and structured/external bracket contents opaque.
  const tokens: string[] = [];
  const lexer = /"(?:[^"]|"")*"|'(?:[^']|'')*'|\.:\.?|:\.|(?:[\p{L}\p{N}_$\\]|\.(?!:))+|\s+|./suy;
  while (lexer.lastIndex < source.length) {
    const start = lexer.lastIndex;
    if (source[start] === '[') {
      lexer.lastIndex = structuredBracketEnd(source, start) ?? source.length;
      tokens.push(source.slice(start, lexer.lastIndex));
    } else {
      const match = lexer.exec(source);
      if (!match) break;
      tokens.push(match[0]);
    }
  }
  const parts: FormulaPart[] = [...tokens];
  const next = (at: number, step: 1 | -1) => {
    at += step;
    while (tokens[at] !== undefined && /^\s+$/.test(tokens[at])) at += step;
    return at;
  };
  const axis = (value: number, fixed: string): Axis => ({ value, fixed: Boolean(fixed) });
  const rangeOperator = /^\.?:\.?$/;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i], after = next(i, 1), afterColon = next(after, 1);
    if (tokens[after] === '!' || tokens[after] === '(' || tokens[after]?.startsWith('[')
      || (tokens[after] === ':' && tokens[next(afterColon, 1)] === '!')) continue;
    const cell = cellAddress.exec(token);
    if (cell) {
      const coords = parseAddress(token);
      if (coords) parts[i] = { token, row: axis(coords.row, cell[3]), column: axis(coords.column, cell[1]) };
      continue;
    }
    const before = next(i, -1);
    const paired = rangeOperator.test(tokens[after] ?? '') ? tokens[afterColon]
      : rangeOperator.test(tokens[before] ?? '') ? tokens[next(before, -1)] : undefined;
    if (!paired) continue;
    const row = rowAddress.exec(token);
    if (row && rowAddress.test(paired) && Number(row[2]) <= MAX_ROW) parts[i] = { token, row: axis(Number(row[2]), row[1]) };
    const column = columnAddress.exec(token);
    if (column && columnAddress.test(paired)) {
      const index = columnNameToIndex(column[2]);
      if (index <= MAX_COLUMN) parts[i] = { token, column: axis(index, column[1]) };
    }
  }
  return parts;
}
