import type { ParsedArrayFormula, ParsedCell, ParsedDefinedName, ParsedMerge, ParsedSheet, ParsedTableRange, ParsedWorkbook } from './types';
import { WorksheetCellIndex } from './cell-index';
import { captureError, FormulaCalculationLimit, MAX_DENSE_ARRAY_SCAN, mergeOccupiedPositions, sliceArray, type FormulaArray } from './formula-array';
import { containsNestedAggregate, FormulaError, FormulaReader, isLambda, type FormulaLambda, type FormulaOperand, type Scalar } from './formula-reader';
import { excelDateSerial, excelLocalDateSerial } from './excel-calendar';
import { formulaClock, shareFormulaClock, type FormulaClock } from './formula-clock';
import { RowRangeIndex } from './row-range-index';
import { resolveSharedFormula } from './shared-formulas';
import type { TableReferenceSource } from './structured-references';
import { sheetTracks } from './visible-tracks';
import { WorksheetValueCell } from './worksheet-cell';

const MAX_DEPENDENCY_DEPTH = 64;
const MAX_NAME_EXPANSIONS = 1024;
const cellIndexes = new WeakMap<ParsedSheet, WorksheetCellIndex>();
const formulaWorkbooks = new WeakMap<ParsedSheet, FormulaWorkbook>();
const calculatedAt = new WeakMap<ParsedCell, number>();
const spillIndexes = new WeakMap<ParsedSheet, RowRangeIndex<SpillRange>>();
class CircularReference extends Error {}

interface SpillRange extends ParsedArrayFormula {
  anchor: ParsedCell;
  overlaps?: boolean;
  plan?: SpillPlan;
}

interface SpillPlan {
  time: number;
  current?: Calculation;
  array?: FormulaArray;
  error?: FormulaError;
  volatile: boolean;
}

interface FormulaWorkbook {
  sheets: Map<string, ParsedSheet>;
  names: Map<string | undefined, Map<string, ParsedDefinedName | null>>;
  tables: Map<string, { sheet: ParsedSheet; table: ParsedTableRange } | null>;
}

interface Calculation {
  active: Set<ParsedCell | ParsedDefinedName | string>;
  remainingNames: number;
  remainingDenseSpillCells: number;
  lambdaDepth: number;
  clock: FormulaClock;
  time: number;
}

type CellPosition = Pick<ParsedCell, 'row' | 'column'>;

/** Associate sibling sheets and name scopes without adding graph edges to the public model. */
export function registerWorkbookFormulas({ sheets, definedNames }: ParsedWorkbook): void {
  shareFormulaClock(sheets);
  if (sheets.length < 2 && !definedNames?.length && !sheets.some(sheet => sheet.tables?.length)) return;
  const workbook: FormulaWorkbook = {
    sheets: new Map(sheets.map(sheet => [sheet.name.toLowerCase(), sheet])), names: new Map(), tables: new Map()
  };
  for (const name of definedNames ?? []) {
    const scope = name.sheet?.toLowerCase(), key = name.name.toLowerCase();
    let names = workbook.names.get(scope);
    if (!names) { names = new Map(); workbook.names.set(scope, names); }
    names.set(key, names.has(key) ? null : name);
  }
  for (const sheet of sheets) {
    formulaWorkbooks.set(sheet, workbook);
    for (const table of sheet.tables ?? []) {
      const name = table.name.toLowerCase();
      workbook.tables.set(name, workbook.tables.has(name) ? null : { sheet, table });
    }
  }
}

export function resolveCellValue(sheet: ParsedSheet, cell: ParsedCell, resolving?: Set<string>): string {
  const previous = calculatedAt.get(cell);
  if (!cell.needsCalculation && previous === undefined) return cell.value;
  const calculation = newCalculation(sheet, resolving);
  if (previous !== undefined) {
    calculation.clock.reads++;
    if (previous === calculation.time && !cell.needsCalculation) return cell.value;
  }
  const formula = cell.formula ?? resolveSharedFormula(sheet, cell);
  if (!formula) return cell.value;
  if (resolving?.has(cell.ref)) return '=' + formula;
  evaluateCell(sheet, cell, formula, calculation, true);
  return cell.value;
}

export function evaluateWorksheetFormula(sheet: ParsedSheet, formula: string, position: CellPosition): Scalar | undefined {
  try {
    const calculation = newCalculation(sheet);
    return formulaReader(sheet, formula, () => calculation, sheet, position).read();
  } catch {
    return undefined;
  }
}

export function wasCalculatedWithClock(cell: ParsedCell): boolean { return calculatedAt.has(cell); }

function newCalculation(sheet: ParsedSheet, active?: Calculation['active']): Calculation {
  const clock = formulaClock(sheet);
  return { active: active ?? new Set(), remainingNames: MAX_NAME_EXPANSIONS, remainingDenseSpillCells: MAX_DENSE_ARRAY_SCAN, lambdaDepth: 0,
    clock, time: clock.time ?? Date.now() };
}

export function displaySpillCell(sheet: ParsedSheet, row: number, column: number, cell?: ParsedCell): ParsedCell | undefined {
  if (!sheet.arrayFormulas?.length || hasSourceValue(cell)) return cell;
  const spill = spillAt(sheet, row, column);
  return spill ? projectedCell(sheet, row, column, cell, newCalculation(sheet), spill, true) : cell;
}

export function forEachWorksheetRangeValue(sheet: ParsedSheet, range: ParsedMerge, visit: (value: Scalar, weight: number) => void): boolean {
  const calculation = newCalculation(sheet);
  const gaps = sheet.arrayFormulas?.length ? new Map<SpillRange, number>() : undefined;
  try {
    visitRangeCells(sheet, range, calculation, (cell, row, column, spill) => {
      const resolved = spill ? projectedCell(sheet, row, column, cell, calculation, spill) : cell;
      const value = resolved && resolvedCellScalar(sheet, resolved);
      if (value != null) visit(value, 1);
    }, false, formulaIndex(sheet), gaps);
    if (gaps) for (const [spill, weight] of gaps) {
      if (!weight) continue;
      let value: Scalar;
      try { value = readSpillDefault(sheet, spill, calculation); }
      catch (error) {
        if (error instanceof FormulaError) continue;
        throw error;
      }
      if (value !== null) visit(value, weight);
    }
    return true;
  } catch (error) {
    if (error instanceof FormulaCalculationLimit || error instanceof CircularReference) return false;
    throw error;
  }
}

export function resolvedCellScalar(sheet: ParsedSheet, cell: ParsedCell): Scalar | undefined {
  resolveCellValue(sheet, cell);
  try { return readCellScalar(sheet, cell); }
  catch { return undefined; }
}

function evaluateCell(sheet: ParsedSheet, cell: ParsedCell, formula: string, calculation: Calculation, root = false): void {
  const clockReads = calculation.clock.reads;
  let cacheResult = true;
  try {
    const spill = spillAt(sheet, cell.row, cell.column);
    let value = spill?.anchor === cell ? readSpill(sheet, spill, cell.row, cell.column, calculation) : undefined;
    if (value === undefined) {
      calculation.active.add(cell);
      value = formulaReader(sheet, formula, () => calculation, sheet, cell).read();
    }
    writeValue(cell, value ?? 0);
  } catch (error) {
    if (error instanceof FormulaCalculationLimit && !root) {
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
    if (cacheResult) {
      if (calculation.clock.reads !== clockReads) calculatedAt.set(cell, calculation.time);
      else calculatedAt.delete(cell);
      cell.needsCalculation = false;
    }
  }
}

function formulaReader(sheet: ParsedSheet, formula: string, current: () => Calculation, caller: ParsedSheet,
  cell: CellPosition, definition = false): FormulaReader {
  return new FormulaReader(formula, ref => {
    const target = referenceSheet(sheet, ref.sheet);
    return readPosition(target, ref.firstRow, ref.firstColumn, current());
  }, (ref, visit, matches, reverse, filter) => {
    const target = referenceSheet(sheet, ref.sheet);
    const calculation = current();
    const visibleRows = (filter?.skipHidden || filter?.skipFiltered) && target.hiddenRows?.length ? sheetTracks(target).rows : undefined;
    visitRangeCells(target, ref, calculation, (dependency, row, column, spill) => {
      if (matches && !matches(row, column)) return;
      if (visibleRows && !visibleRows.includes(row) && (filter?.skipHidden || filterCoversRow(target, row))) return;
      if (filter?.skipNested && dependency) {
        const formula = dependency.formula ?? resolveSharedFormula(target, dependency);
        if (formula && containsNestedAggregate(formula, filter.skipNested === 'both')) return;
      }
      let value: Scalar | FormulaError;
      try {
        const projected = spill && readSpill(target, spill, row, column, calculation);
        value = projected === undefined ? readValue(target, dependency, calculation) : projected;
      }
      catch (error) {
        if (!(error instanceof FormulaError)) throw error;
        value = error;
      }
      return visit(value, row, column);
    }, reverse);
  }, (name, qualifier) => readDefinedName(sheet, name, qualifier, current, caller, cell),
  definition ? { sheet: sheet.name, currentSheet: caller.name, row: cell.row, column: cell.column } : undefined,
  name => referenceSheet(sheet, name).name.toLowerCase(), sheet.date1904, dayOnly => {
    const calculation = current();
    calculation.clock.reads++;
    return excelLocalDateSerial(new Date(calculation.time), dayOnly, sheet.date1904);
  }, (ref, includeLegacyArray) => {
    const target = referenceSheet(sheet, ref.sheet);
    const source = formulaIndex(target).get(ref.firstRow, ref.firstColumn);
    const formula = source ? source.formula ?? resolveSharedFormula(target, source) : undefined;
    if (formula !== undefined || !includeLegacyArray) return formula;
    const spill = spillAt(target, ref.firstRow, ref.firstColumn);
    return spill && !spill.dynamic ? spill.anchor.formula : undefined;
  }, (name, qualifier) => readTableSource(sheet, caller, cell, name, qualifier), cell, (ref, compactOnly) =>
    formulaRangeArray(referenceSheet(sheet, ref.sheet), ref, current, compactOnly), ref => {
    const target = referenceSheet(sheet, ref.sheet);
    const spill = spillAt(target, ref.firstRow, ref.firstColumn);
    if (!spill?.dynamic || spill.firstRow !== ref.firstRow || spill.firstColumn !== ref.firstColumn) return undefined;
    return { ...ref, lastRow: spill.lastRow, lastColumn: spill.lastColumn };
  }, (first, last) => referenceSheetSpan(sheet, first, last), (ref, visit) =>
    visitDisplayedRangeValues(referenceSheet(sheet, ref.sheet), ref, current(), visit));
}

function filterCoversRow(sheet: ParsedSheet, row: number): boolean {
  const inRange = (range?: ParsedSheet['autoFilterRows']) => range !== undefined && row >= range.first && row <= range.last;
  return inRange(sheet.autoFilterRows) || (sheet.tables?.some(table => inRange(table.autoFilterRows)) ?? false);
}

function readTableSource(sheet: ParsedSheet, caller: ParsedSheet, cell: CellPosition,
  name?: string, qualifier?: string): TableReferenceSource | undefined {
  const qualifiedSheet = qualifier === undefined ? undefined : referenceSheet(sheet, qualifier);
  if (name === undefined) {
    const target = qualifiedSheet ?? caller;
    const { row, column } = cell;
    let found: ParsedTableRange | undefined;
    for (const table of target.tables ?? []) {
      if (row < table.firstRow || row > table.lastRow || column < table.firstColumn || column > table.lastColumn) continue;
      if (found) throw new FormulaError('#REF!');
      found = table;
    }
    return found ? { table: found, sheet: target.name, row, column, sameSheet: target === caller } : undefined;
  }
  const workbook = formulaWorkbooks.get(sheet);
  const key = name.toLowerCase();
  const entry = workbook?.tables.get(key);
  if (entry === null) throw new FormulaError('#REF!');
  if (entry) {
    return !qualifiedSheet || qualifiedSheet === entry.sheet
      ? { table: entry.table, sheet: entry.sheet.name, row: cell.row, column: cell.column, sameSheet: entry.sheet === caller } : undefined;
  }
  if (workbook) return undefined;
  const target = qualifiedSheet ?? sheet;
  const table = target.tables?.find(table => table.name.toLowerCase() === key);
  return table ? { table, sheet: target.name, row: cell.row, column: cell.column, sameSheet: target === caller } : undefined;
}

function readDefinedName(sheet: ParsedSheet, name: string, qualifier: string | null | undefined, current: () => Calculation,
  caller: ParsedSheet, cell: CellPosition): FormulaOperand | undefined {
  const workbook = formulaWorkbooks.get(sheet);
  if (!workbook?.names.size) return undefined;
  const key = name.toLowerCase();
  const scope = qualifier?.toLowerCase() ?? sheet.name.toLowerCase();
  const local = workbook.names.get(scope)?.get(key);
  const definition = qualifier === null || (local === undefined && qualifier === undefined) ? workbook.names.get(undefined)?.get(key) : local;
  if (definition === undefined) return undefined;
  if (!definition) throw new Error('Ambiguous defined name.');
  const calculation = current();
  if (calculation.active.has(definition)) throw new Error('Circular defined name.');
  if (calculation.active.size >= MAX_DEPENDENCY_DEPTH || calculation.remainingNames-- <= 0) {
    throw new FormulaCalculationLimit('Defined names exceed the preview calculation limit.');
  }
  const target = referenceSheet(sheet, definition.sheet);
  calculation.active.add(definition);
  try {
    const value = formulaReader(target, definition.formula, current, caller, cell, true).readDefinition();
    if (isLambda(value)) return scopedLambda(value, current);
    return value !== null && typeof value === 'object' && 'occupied' in value ? scopedNameArray(value) : value;
  }
  finally { calculation.active.delete(definition); }

  function scopedNameArray(array: FormulaArray): FormulaArray {
    const read = <T>(run: () => T): T => {
      const calculation = current();
      if (calculation.active.has(definition!)) throw new Error('Circular defined name.');
      if (calculation.active.size >= MAX_DEPENDENCY_DEPTH) throw new FormulaCalculationLimit('Defined names exceed the preview calculation limit.');
      calculation.active.add(definition!);
      try { return run(); }
      finally { calculation.active.delete(definition!); }
    };
    return {
      ...array,
      read: position => read(() => array.read(position)),
      occupied: array.occupied.map(positions => function* () {
        const iterator = read(() => positions()[Symbol.iterator]());
        for (let next = read(() => iterator.next()); !next.done; next = read(() => iterator.next())) yield next.value;
      }),
      slice: array.slice && ((row, column, rows, columns) =>
        scopedNameArray(read(() => array.slice!(row, column, rows, columns))))
    };
  }
}

function scopedLambda(lambda: FormulaLambda, current: () => Calculation): FormulaLambda {
  return { ...lambda, invoke(args) {
    const calculation = current();
    if (calculation.lambdaDepth >= MAX_DEPENDENCY_DEPTH) throw new FormulaError('#NUM!');
    calculation.lambdaDepth++;
    try {
      const result = lambda.invoke(args);
      return isLambda(result) ? scopedLambda(result, current) : result;
    } finally { calculation.lambdaDepth--; }
  } };
}

function referenceSheet(sheet: ParsedSheet, name?: string): ParsedSheet {
  if (!name || name.toLowerCase() === sheet.name.toLowerCase()) return sheet;
  const target = formulaWorkbooks.get(sheet)?.sheets.get(name.toLowerCase());
  if (!target) throw new FormulaError('#REF!');
  return target;
}

function referenceSheetSpan(sheet: ParsedSheet, first: string, last: string): string[] {
  const workbook = formulaWorkbooks.get(sheet);
  const names = workbook ? [...workbook.sheets.keys()] : [sheet.name.toLowerCase()];
  const start = names.indexOf(first.toLowerCase()), end = names.indexOf(last.toLowerCase());
  if (start < 0 || end < 0) throw new FormulaError('#REF!');
  return names.slice(Math.min(start, end), Math.max(start, end) + 1);
}

function formulaIndex(sheet: ParsedSheet): WorksheetCellIndex {
  let index = cellIndexes.get(sheet);
  if (!index) {
    index = new WorksheetCellIndex(sheet);
    cellIndexes.set(sheet, index);
  }
  return index;
}

function spillIndex(sheet: ParsedSheet): RowRangeIndex<SpillRange> | undefined {
  if (!sheet.arrayFormulas?.length) return undefined;
  let spills = spillIndexes.get(sheet);
  if (!spills) {
    const index = formulaIndex(sheet);
    const ranges: SpillRange[] = [];
    for (const range of sheet.arrayFormulas) {
      const { firstRow, lastRow, firstColumn, lastColumn } = range;
      if (![firstRow, lastRow, firstColumn, lastColumn].every(Number.isSafeInteger) || firstRow < 1 || firstColumn < 1
        || lastRow < firstRow || lastRow > 1_048_576 || lastColumn < firstColumn || lastColumn > 16_384) continue;
      const anchor = index.get(firstRow, firstColumn);
      if (!anchor?.formula || (!anchor.needsCalculation && anchor.valueType === 'error' && anchor.value === '#SPILL!')) continue;
      ranges.push({ ...range, anchor });
    }
    spills = new RowRangeIndex(ranges);
    spillIndexes.set(sheet, spills);
  }
  return spills;
}

function intersectSpills(sheet: ParsedSheet, { firstRow, lastRow, firstColumn, lastColumn }: ParsedMerge,
  visit: (spill: SpillRange) => void): void {
  const index = spillIndex(sheet);
  index?.forEach(firstRow, lastRow, spill => {
    if (spill.firstColumn > lastColumn || spill.lastColumn < firstColumn || spill.overlaps) return;
    if (spill.overlaps === undefined) {
      spill.overlaps = false;
      index.forEach(spill.firstRow, spill.lastRow, other => {
        if (other !== spill && other.firstColumn <= spill.lastColumn && other.lastColumn >= spill.firstColumn) {
          other.overlaps = spill.overlaps = true;
        }
      });
    }
    if (!spill.overlaps) visit(spill);
  });
}

function spillAt(sheet: ParsedSheet, row: number, column: number): SpillRange | undefined {
  if (!sheet.arrayFormulas?.length) return undefined;
  let result: SpillRange | undefined;
  intersectSpills(sheet, { firstRow: row, lastRow: row, firstColumn: column, lastColumn: column }, spill => { result = spill; });
  return result;
}

export function hasSourceValue(cell?: ParsedCell): boolean {
  return cell !== undefined && (cell.formula !== undefined || cell.sharedFormulaId !== undefined ||
    (!cell.missingValue && Boolean(cell.valueType || cell.value.trim())));
}

function withSpill<T>(sheet: ParsedSheet, spill: SpillRange, calculation: Calculation, read: (plan: SpillPlan) => T): T {
  requireInactive(spill.anchor, calculation);
  const previous = spill.plan;
  const fresh = !previous || (previous.volatile && previous.time !== calculation.time);
  const plan: SpillPlan = fresh ? { time: calculation.time, volatile: false } : previous;
  if (plan.volatile) calculation.clock.reads++;
  const reads = calculation.clock.reads;
  calculation.active.add(spill.anchor);
  plan.current = calculation;
  try {
    if (fresh) {
      try {
        const value = formulaReader(sheet, spill.anchor.formula!, () => plan.current!, sheet, spill.anchor).readResult(true);
        if (value !== null && typeof value === 'object') {
          const rows = spill.lastRow - spill.firstRow + 1, columns = spill.lastColumn - spill.firstColumn + 1;
          if (value.rows === rows && value.columns === columns) plan.array = value;
          else if (!spill.dynamic && value.rows >= rows && value.columns >= columns) {
            // Legacy array formulas display only the portion that fits the declared cells.
            plan.array = sliceArray(value, 0, 0, rows, columns);
          }
        } else if (spill.firstRow === spill.lastRow && spill.firstColumn === spill.lastColumn) {
          plan.array = { rows: 1, columns: 1, occupied: [], read: () => value ?? 0 };
        }
      } catch (error) {
        if (error instanceof FormulaCalculationLimit || error instanceof CircularReference) throw error;
        if (error instanceof FormulaError) plan.error = error;
      }
      spill.plan = plan;
    }
    return read(plan);
  } finally {
    // Deferred LET bindings can reuse a previously read position in the same render.
    if (calculation.clock.reads !== reads) plan.volatile = true;
    plan.time = calculation.time;
    plan.current = undefined;
    calculation.active.delete(spill.anchor);
  }
}

function readSpill(sheet: ParsedSheet, spill: SpillRange, row: number, column: number, calculation: Calculation,
  forDisplay = false): Scalar | undefined {
  return withSpill(sheet, spill, calculation, ({ array, error }) => {
    if (error && row === spill.firstRow && column === spill.firstColumn) throw error;
    if (array) {
      return readSpillValue(array, (row - spill.firstRow) * array.columns + column - spill.firstColumn, forDisplay);
    }
  });
}

function readSpillValue(array: FormulaArray, position?: number, forDisplay = false): Scalar {
  const value = array.read(position);
  if (typeof value === 'number' && !Number.isFinite(value)) throw new FormulaError('#NUM!');
  return value === null && forDisplay && array.zeroForBlanks ? 0 : value;
}

function readSpillDefault(sheet: ParsedSheet, spill: SpillRange, calculation: Calculation, forDisplay = false): Scalar {
  return withSpill(sheet, spill, calculation, ({ array }) => array && !array.dense ? readSpillValue(array, undefined, forDisplay) : null);
}

function writeValue(cell: ParsedCell, value: Scalar): void {
  if (typeof value === 'boolean') {
    cell.valueType = 'boolean';
    cell.value = value ? 'TRUE' : 'FALSE';
  } else if (typeof value === 'string') {
    cell.valueType = 'text';
    cell.value = value;
  } else {
    delete cell.valueType;
    cell.value = value === null ? '' : String(value);
  }
}

function projectedCell(sheet: ParsedSheet, row: number, column: number, cell: ParsedCell | undefined,
  calculation: Calculation, spill: SpillRange, forDisplay = false): ParsedCell | undefined {
  let value: Scalar | FormulaError | undefined;
  try {
    value = readSpill(sheet, spill, row, column, calculation, forDisplay);
  } catch (error) {
    if (!(error instanceof FormulaError)) return cell;
    value = error;
  }
  if (value === undefined || (value === null && !cell)) return cell;
  const output: ParsedCell = cell ? { ...cell, ref: cell.ref } : new WorksheetValueCell(row, column, '');
  if (value instanceof FormulaError) {
    output.value = value.message;
    output.valueType = 'error';
  } else writeValue(output, value);
  delete output.missingValue;
  return output;
}

function spillsInRange(sheet: ParsedSheet, range: ParsedMerge, index: WorksheetCellIndex): SpillRange[] {
  const spills: SpillRange[] = [];
  intersectSpills(sheet, range, spill => {
    const { firstRow, lastRow, firstColumn, lastColumn } = clipToSpill(range, spill);
    const width = lastColumn - firstColumn + 1;
    let saved = 0;
    index.forEachInRange(firstRow, lastRow, firstColumn, lastColumn, (cell, row, column) => {
      if ((row - firstRow) * width + column - firstColumn !== saved || !hasSourceValue(cell)) return false;
      saved++;
    });
    if (saved !== (lastRow - firstRow + 1) * width) spills.push(spill);
  });
  return spills;
}

function clipToSpill(range: ParsedMerge, spill: SpillRange): ParsedMerge {
  return {
    firstRow: Math.max(range.firstRow, spill.firstRow), lastRow: Math.min(range.lastRow, spill.lastRow),
    firstColumn: Math.max(range.firstColumn, spill.firstColumn), lastColumn: Math.min(range.lastColumn, spill.lastColumn)
  };
}

function formulaRangeArray(sheet: ParsedSheet, range: ParsedMerge, current: () => Calculation, compactOnly = false): FormulaArray | undefined {
  const { firstRow, firstColumn, lastRow, lastColumn } = range;
  const start = spillAt(sheet, firstRow, firstColumn);
  // A single spill covering the range supplies one default for every unstored position.
  const compactSpill = start && start.lastRow >= lastRow && start.lastColumn >= lastColumn ? start : undefined;
  if (compactOnly && !compactSpill) return undefined;
  const columns = lastColumn - firstColumn + 1;
  return {
    rows: lastRow - firstRow + 1,
    columns,
    read(position) {
      if (position !== undefined) {
        return readPosition(sheet, firstRow + Math.floor(position / columns), firstColumn + position % columns, current());
      }
      if (!compactSpill) return null;
      return readSpillDefault(sheet, compactSpill, current());
    },
    occupied: [() => rangePositions(sheet, range, current(), { compact: Boolean(compactSpill) })],
    slice(rowOffset, columnOffset, rows, columns) {
      const row = firstRow + rowOffset, column = firstColumn + columnOffset;
      return formulaRangeArray(sheet, { firstRow: row, lastRow: row + rows - 1, firstColumn: column, lastColumn: column + columns - 1 }, current)!;
    }
  };
}

interface RangePositionOptions {
  reverse?: boolean;
  index?: WorksheetCellIndex;
  spills?: SpillRange[];
  compact?: boolean;
}

function rangePositions(sheet: ParsedSheet, range: ParsedMerge, calculation: Calculation, {
  reverse = false, index = formulaIndex(sheet), spills = spillsInRange(sheet, range, index), compact = false
}: RangePositionOptions = {}): Iterable<number> {
  const { firstRow, lastRow, firstColumn, lastColumn } = range;
  const stored = () => index.occupiedPositions(firstRow, lastRow, firstColumn, lastColumn, reverse);
  if (!spills.length) return stored();
  const sources = [stored, ...spills.map(spill => () => spillPositions(sheet, spill, range, calculation, reverse, index, compact))];
  // Balance iterator merges so visiting many independent declarations stays proportional to their stored results.
  function merge(first: number, end: number): Iterable<number> {
    if (end - first === 1) return sources[first]();
    const middle = (first + end) >>> 1;
    return mergeOccupiedPositions([() => merge(first, middle), () => merge(middle, end)], reverse);
  }
  return merge(0, sources.length);
}

function* spillPositions(sheet: ParsedSheet, spill: SpillRange, range: ParsedMerge, calculation: Calculation,
  reverse: boolean, index: WorksheetCellIndex, compact: boolean): Iterable<number> {
  const { firstRow, lastRow, firstColumn, lastColumn } = clipToSpill(range, spill);
  const width = range.lastColumn - range.firstColumn + 1;
  const offset = (row: number, column: number) => (row - range.firstRow) * width + column - range.firstColumn;
  const source = withSpill(sheet, spill, calculation, ({ array }) => {
    if (!array) return undefined;
    let dense: boolean;
    // A short clipped range is cheaper to read directly than scanning the source from its first occupied cell.
    try {
      dense = Boolean(array.dense) || (lastRow - firstRow + 1) * (lastColumn - firstColumn + 1) <= 256 || (!compact && array.read() !== null);
    }
    catch (error) {
      if (!(error instanceof FormulaError)) throw error;
      dense = true;
    }
    return { dense, columns: array.columns, positions: mergeOccupiedPositions(array.occupied)[Symbol.iterator]() };
  });
  if (!source) return;
  if (source.dense) {
    const step = reverse ? -1 : 1;
    const endRow = reverse ? firstRow - 1 : lastRow + 1, endColumn = reverse ? firstColumn - 1 : lastColumn + 1;
    for (let row = reverse ? lastRow : firstRow; row !== endRow; row += step) {
      for (let column = reverse ? lastColumn : firstColumn; column !== endColumn; column += step) {
        if (hasSourceValue(index.get(row, column))) continue;
        if (--calculation.remainingDenseSpillCells < 0) {
          throw new FormulaCalculationLimit('Dense array formula range exceeds the preview scan limit.');
        }
        yield offset(row, column);
      }
    }
    return;
  }
  const reversed: number[] = [];
  for (;;) {
    const next = withSpill(sheet, spill, calculation, () => source.positions.next());
    if (next.done) break;
    const row = spill.firstRow + Math.floor(next.value / source.columns);
    if (row > lastRow) break;
    const column = spill.firstColumn + next.value % source.columns;
    if (row < firstRow || column < firstColumn || column > lastColumn) continue;
    if (reverse) reversed.push(offset(row, column));
    else yield offset(row, column);
  }
  for (let at = reversed.length - 1; at >= 0; at--) yield reversed[at];
}

function visitRangeCells(sheet: ParsedSheet, range: ParsedMerge, calculation: Calculation,
  visit: (cell: ParsedCell | undefined, row: number, column: number, spill?: SpillRange) => unknown,
  reverse = false, index = formulaIndex(sheet), gaps?: Map<SpillRange, number>): void {
  const spills = spillsInRange(sheet, range, index);
  const { firstRow, lastRow, firstColumn, lastColumn } = range;
  if (!spills.length) {
    index.forEachInRange(firstRow, lastRow, firstColumn, lastColumn, visit, reverse);
    return;
  }
  if (gaps) for (const spill of spills) {
    const clipped = clipToSpill(range, spill);
    gaps.set(spill, (clipped.lastRow - clipped.firstRow + 1) * (clipped.lastColumn - clipped.firstColumn + 1));
  }
  const width = lastColumn - firstColumn + 1;
  for (const position of rangePositions(sheet, range, calculation, { reverse, index, spills, compact: Boolean(gaps) })) {
    const row = firstRow + Math.floor(position / width), column = firstColumn + position % width;
    const cell = index.get(row, column);
    const saved = hasSourceValue(cell);
    const spill = saved && !gaps ? undefined : spillAt(sheet, row, column);
    if (spill && gaps) {
      const remaining = gaps.get(spill);
      if (remaining !== undefined) gaps.set(spill, remaining - 1);
    }
    if (visit(cell, row, column, saved ? undefined : spill) === false) return;
  }
}

function visitDisplayedRangeValues(sheet: ParsedSheet, range: ParsedMerge, calculation: Calculation,
  visit: (value: Scalar | FormulaError, weight: number) => void): void {
  const gaps = sheet.arrayFormulas?.length ? new Map<SpillRange, number>() : undefined;
  visitRangeCells(sheet, range, calculation, (cell, row, column, spill) => {
    const value = captureError(() => {
      const projected = spill && readSpill(sheet, spill, row, column, calculation, true);
      return projected === undefined ? readValue(sheet, cell, calculation) : projected;
    });
    visit(value, 1);
  }, false, formulaIndex(sheet), gaps);
  if (gaps) for (const [spill, weight] of gaps) {
    if (weight) visit(captureError(() => readSpillDefault(sheet, spill, calculation, true)), weight);
  }
}

function readPosition(sheet: ParsedSheet, row: number, column: number, calculation: Calculation): Scalar {
  const cell = formulaIndex(sheet).get(row, column);
  if (sheet.arrayFormulas?.length && !hasSourceValue(cell)) {
    const spill = spillAt(sheet, row, column);
    if (spill) {
      const value = readSpill(sheet, spill, row, column, calculation);
      if (value !== undefined) return value;
    }
  }
  return readValue(sheet, cell, calculation);
}

function requireInactive(cell: ParsedCell, calculation: Calculation): void {
  if (calculation.active.has(cell) || (calculation.active.size && calculation.active.has(cell.ref))) {
    throw new CircularReference('Circular formula reference.');
  }
  if (calculation.active.size >= MAX_DEPENDENCY_DEPTH) throw new FormulaCalculationLimit('Formula dependencies exceed the preview limit.');
}

function readValue(sheet: ParsedSheet, cell: ParsedCell | undefined, calculation: Calculation): Scalar {
  if (!cell) return null;
  const previous = calculatedAt.get(cell);
  if (previous !== undefined) calculation.clock.reads++;
  if (cell.needsCalculation || (previous !== undefined && previous !== calculation.time)) {
    requireInactive(cell, calculation);
    const formula = cell.formula ?? resolveSharedFormula(sheet, cell);
    if (formula) evaluateCell(sheet, cell, formula, calculation);
  }
  return readCellScalar(sheet, cell);
}

export function readCellScalar(sheet: ParsedSheet, cell?: ParsedCell): Scalar {
  if (!cell || cell.missingValue) return null;
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
