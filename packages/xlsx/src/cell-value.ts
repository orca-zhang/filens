import type { ParsedCell, ParsedDefinedName, ParsedMerge, ParsedSheet, ParsedWorkbook } from './types';
import { WorksheetCellIndex } from './cell-index';
import { FormulaError, FormulaReader, type FormulaOperand, type Scalar } from './formula-reader';
import { excelDateSerial } from './number-formats';
import { resolveSharedFormula } from './shared-formulas';

const MAX_DEPENDENCY_DEPTH = 64;
const MAX_NAME_EXPANSIONS = 1024;
const cellIndexes = new WeakMap<ParsedSheet, WorksheetCellIndex>();
const formulaWorkbooks = new WeakMap<ParsedSheet, FormulaWorkbook>();
class DependencyLimit extends Error {}

interface FormulaWorkbook {
  sheets: Map<string, ParsedSheet>;
  names: Map<string | undefined, Map<string, ParsedDefinedName | null>>;
}

interface Calculation {
  active: Set<ParsedCell | ParsedDefinedName | string>;
  remainingNames: number;
}

type CellPosition = Pick<ParsedCell, 'row' | 'column'>;

/** Associate sibling sheets and name scopes without adding graph edges to the public model. */
export function registerWorkbookFormulas({ sheets, definedNames }: ParsedWorkbook): void {
  if (sheets.length < 2 && !definedNames?.length) return;
  const workbook: FormulaWorkbook = { sheets: new Map(sheets.map(sheet => [sheet.name.toLowerCase(), sheet])), names: new Map() };
  for (const name of definedNames ?? []) {
    const scope = name.sheet?.toLowerCase(), key = name.name.toLowerCase();
    let names = workbook.names.get(scope);
    if (!names) { names = new Map(); workbook.names.set(scope, names); }
    names.set(key, names.has(key) ? null : name);
  }
  for (const sheet of sheets) formulaWorkbooks.set(sheet, workbook);
}

export function resolveCellValue(sheet: ParsedSheet, cell: ParsedCell, resolving?: Set<string>): string {
  if (!cell.needsCalculation) return cell.value;
  const formula = cell.formula ?? resolveSharedFormula(sheet, cell);
  if (!formula) return cell.value;
  if (resolving?.has(cell.ref)) return '=' + formula;
  evaluateCell(sheet, cell, formula, { active: resolving ?? new Set(), remainingNames: MAX_NAME_EXPANSIONS }, true);
  return cell.value;
}

export function evaluateWorksheetFormula(sheet: ParsedSheet, formula: string, position: CellPosition): Scalar | undefined {
  try {
    return formulaReader(sheet, formula, { active: new Set(), remainingNames: MAX_NAME_EXPANSIONS }, sheet, position).read();
  } catch {
    return undefined;
  }
}

export function forEachWorksheetRangeCell(sheet: ParsedSheet, range: ParsedMerge, visit: (cell: ParsedCell) => void): void {
  formulaIndex(sheet).forEachInRange(range.firstRow, range.lastRow, range.firstColumn, range.lastColumn, visit);
}

function evaluateCell(sheet: ParsedSheet, cell: ParsedCell, formula: string, calculation: Calculation, root = false): void {
  calculation.active.add(cell);
  let cacheResult = true;
  try {
    const value = formulaReader(sheet, formula, calculation, sheet, cell).read();
    if (typeof value === 'boolean') {
      cell.valueType = 'boolean';
      cell.value = value ? 'TRUE' : 'FALSE';
    } else if (typeof value === 'string') {
      cell.valueType = 'text';
      cell.value = value;
    } else {
      delete cell.valueType;
      cell.value = String(value ?? 0);
    }
  } catch (error) {
    if (error instanceof DependencyLimit && !root) {
      cacheResult = false;
      throw error;
    }
    if (error instanceof FormulaError) {
      cell.value = error.message;
      cell.valueType = 'error';
    } else {
      cell.value = '=' + formula.replace(/^=/, '');
      delete cell.valueType;
    }
  } finally {
    calculation.active.delete(cell);
    if (cacheResult) cell.needsCalculation = false;
  }
}

function formulaReader(sheet: ParsedSheet, formula: string, calculation: Calculation, caller: ParsedSheet,
  cell: CellPosition, definition = false): FormulaReader {
  return new FormulaReader(formula, ref => {
    const target = referenceSheet(sheet, ref.sheet);
    return readValue(target, formulaIndex(target).get(ref.firstRow, ref.firstColumn), calculation);
  }, (ref, visit) => {
    const target = referenceSheet(sheet, ref.sheet);
    formulaIndex(target).forEachInRange(ref.firstRow, ref.lastRow, ref.firstColumn, ref.lastColumn, dependency => {
      let value: Scalar | FormulaError;
      try { value = readValue(target, dependency, calculation); }
      catch (error) {
        if (!(error instanceof FormulaError)) throw error;
        value = error;
      }
      visit(value);
    });
  }, (name, qualifier) => readDefinedName(sheet, name, qualifier, calculation, caller, cell),
  definition ? { sheet: sheet.name, currentSheet: caller.name, row: cell.row, column: cell.column } : undefined);
}

function readDefinedName(sheet: ParsedSheet, name: string, qualifier: string | null | undefined, calculation: Calculation,
  caller: ParsedSheet, cell: CellPosition): FormulaOperand | undefined {
  const workbook = formulaWorkbooks.get(sheet);
  if (!workbook?.names.size) return undefined;
  const key = name.toLowerCase();
  const scope = qualifier?.toLowerCase() ?? sheet.name.toLowerCase();
  const local = workbook.names.get(scope)?.get(key);
  const definition = qualifier === null || (local === undefined && qualifier === undefined) ? workbook.names.get(undefined)?.get(key) : local;
  if (definition === undefined) return undefined;
  if (!definition) throw new Error('Ambiguous defined name.');
  if (calculation.active.has(definition)) throw new Error('Circular defined name.');
  if (calculation.active.size >= MAX_DEPENDENCY_DEPTH || calculation.remainingNames-- <= 0) {
    throw new DependencyLimit('Defined names exceed the preview calculation limit.');
  }
  const target = referenceSheet(sheet, definition.sheet);
  calculation.active.add(definition);
  try { return formulaReader(target, definition.formula, calculation, caller, cell, true).readDefinition(); }
  finally { calculation.active.delete(definition); }
}

function referenceSheet(sheet: ParsedSheet, name?: string): ParsedSheet {
  if (!name || name.toLowerCase() === sheet.name.toLowerCase()) return sheet;
  const target = formulaWorkbooks.get(sheet)?.sheets.get(name.toLowerCase());
  if (!target) throw new FormulaError('#REF!');
  return target;
}

function formulaIndex(sheet: ParsedSheet): WorksheetCellIndex {
  let index = cellIndexes.get(sheet);
  if (!index) {
    index = new WorksheetCellIndex(sheet);
    cellIndexes.set(sheet, index);
  }
  return index;
}

function readValue(sheet: ParsedSheet, cell: ParsedCell | undefined, calculation: Calculation): Scalar {
  if (!cell) return null;
  if (cell.needsCalculation) {
    if (calculation.active.has(cell) || calculation.active.has(cell.ref)) throw new Error('Circular formula reference.');
    if (calculation.active.size >= MAX_DEPENDENCY_DEPTH) throw new DependencyLimit('Formula dependencies exceed the preview limit.');
    const formula = cell.formula ?? resolveSharedFormula(sheet, cell);
    if (formula) evaluateCell(sheet, cell, formula, calculation);
  }
  return readCellScalar(sheet, cell);
}

export function readCellScalar(sheet: ParsedSheet, cell?: ParsedCell): Scalar {
  if (!cell) return null;
  if (cell.valueType) {
    switch (cell.valueType) {
      case 'error': throw new FormulaError(cell.value);
      case 'text': return cell.value;
      case 'date': return excelDateSerial(cell.value, sheet.date1904) ?? cell.value;
      case 'boolean': return cell.value === 'TRUE';
    }
  }
  const value = cell.value.trim();
  if (!value) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  // Public callers can still supply untyped sheets with the previous boolean representation.
  if (/^true$/i.test(value)) return 1;
  if (/^false$/i.test(value)) return 0;
  throw new Error('Unrecognized formula value.');
}
