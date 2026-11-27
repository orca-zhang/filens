import type { Scalar } from './formula-reader';

export type OccupiedPositions = () => Iterable<number>;
export const MAX_DENSE_ARRAY_SCAN = 262_144;
export class FormulaCalculationLimit extends Error {}
export class FormulaError extends Error {}

export interface FormulaArray {
  rows: number;
  columns: number;
  /** All positions have generated values. No sparse positions need to be enumerated to select a window. */
  dense?: boolean;
  /** Keep blank operands for calculations and display them as zero in spill cells. */
  zeroForBlanks?: boolean;
  /** Legacy scalar formulas can take the first value of a coordinate array. */
  implicitFirst?: boolean;
  /** With no position, read the common value outside the occupied positions. */
  read(position?: number): Scalar;
  occupied: readonly OccupiedPositions[];
  /** Narrow the underlying range before enumerating its positions. Offsets are zero-based. */
  slice?(firstRow: number, firstColumn: number, rows: number, columns: number): FormulaArray;
}

export function captureError<T>(read: () => T): T | FormulaError {
  try { return read(); }
  catch (error) {
    if (!(error instanceof FormulaError)) throw error;
    return error;
  }
}

export function* generatedArrayPositions(length: number): Iterable<number> {
  if (length > MAX_DENSE_ARRAY_SCAN) throw new FormulaCalculationLimit('Dense array exceeds the preview scan limit.');
  for (let index = 0; index < length; index++) yield index;
}

export function trimArrayBounds(array: FormulaArray, rowMode: number, columnMode: number) {
  const { rows, columns } = array;
  const size = rows * columns;
  let firstRow = rowMode & 1 ? rows : 0, lastRow = rowMode & 2 ? -1 : rows - 1;
  let firstColumn = columnMode & 1 ? columns : 0, lastColumn = columnMode & 2 ? -1 : columns - 1;
  const include = (first: number, last: number) => {
    const top = Math.floor(first / columns), bottom = Math.floor(last / columns);
    firstRow = Math.min(firstRow, top);
    lastRow = Math.max(lastRow, bottom);
    firstColumn = Math.min(firstColumn, top === bottom ? first % columns : 0);
    lastColumn = Math.max(lastColumn, top === bottom ? last % columns : columns - 1);
  };
  const complete = () => firstRow === 0 && lastRow === rows - 1 && firstColumn === 0 && lastColumn === columns - 1;
  if (!complete()) {
    if (captureError(() => array.read(0)) !== null) include(0, 0);
    if (!complete() && size > 1 && captureError(() => array.read(size - 1)) !== null) include(size - 1, size - 1);
  }
  if (!complete()) {
    let next = 0, filledDefault: boolean | undefined;
    const includeGap = (end: number) => {
      if (next >= end) return;
      filledDefault ??= captureError(() => array.read()) !== null;
      if (filledDefault) include(next, end - 1);
    };
    const positions = array.dense ? generatedArrayPositions(size) : mergeOccupiedPositions(array.occupied);
    for (const position of positions) {
      includeGap(position);
      if (captureError(() => array.read(position)) !== null) include(position, position);
      if (complete()) break;
      next = position + 1;
    }
    if (!complete()) includeGap(size);
  }
  // Excel arrays need at least one row and column even when every value is blank.
  if (firstRow > lastRow) firstRow = lastRow = rowMode === 1 ? rows - 1 : 0;
  if (firstColumn > lastColumn) firstColumn = lastColumn = columnMode === 1 ? columns - 1 : 0;
  return { firstRow, firstColumn, rows: lastRow - firstRow + 1, columns: lastColumn - firstColumn + 1 };
}

export interface SelectedInterval { first: number; end: number; before: number }

export function sliceArray(source: FormulaArray, firstRow: number, firstColumn: number, rows: number, columns: number): FormulaArray {
  if (rows === source.rows && columns === source.columns) return source;
  if (source.slice) return source.slice(firstRow, firstColumn, rows, columns);
  const lastRow = firstRow + rows, lastColumn = firstColumn + columns;
  return {
    rows, columns, dense: source.dense, zeroForBlanks: source.zeroForBlanks,
    read(position) {
      if (position === undefined) return source.read();
      const row = firstRow + Math.floor(position / columns), column = firstColumn + position % columns;
      return source.read(row * source.columns + column);
    },
    occupied: source.dense ? [] : [function* () {
      for (const position of mergeOccupiedPositions(source.occupied)) {
        const row = Math.floor(position / source.columns), column = position % source.columns;
        if (row >= lastRow) break;
        if (row >= firstRow && column >= firstColumn && column < lastColumn) {
          yield (row - firstRow) * columns + column - firstColumn;
        }
      }
    }]
  };
}

export function mapFormulaArray(source: FormulaArray, read: (array: FormulaArray, position?: number) => Scalar): FormulaArray {
  return {
    ...source,
    read: position => read(source, position),
    slice: source.slice && ((row, column, rows, columns) => mapFormulaArray(source.slice!(row, column, rows, columns), read))
  };
}

export function expandFormulaArray(source: FormulaArray, rows: number, columns: number): FormulaArray {
  if (source.rows === rows && source.columns === columns) return source;
  if (source.rows === 1 && source.columns === 1) {
    return { rows, columns, zeroForBlanks: source.zeroForBlanks, read: () => source.read(0), occupied: [] };
  }
  const repeatRows = source.rows === 1 && rows > 1;
  const repeatColumns = source.columns === 1 && columns > 1;
  let result = repeatRows || repeatColumns ? repeatFormulaArray(source, repeatRows ? rows : source.rows,
    repeatColumns ? columns : source.columns, repeatRows) : source;
  if (result.rows < rows) result = stackArrays([result], false, rows);
  if (result.columns < columns) result = stackArrays([result], true, columns);
  return result;
}

function repeatFormulaArray(source: FormulaArray, rows: number, columns: number, repeatRows: boolean): FormulaArray {
  return {
    rows, columns, dense: source.dense, zeroForBlanks: source.zeroForBlanks,
    read(position) {
      if (position === undefined) return source.read();
      return source.read(repeatRows ? position % columns : Math.floor(position / columns));
    },
    occupied: source.dense ? [] : [function* () {
      let remaining = MAX_DENSE_ARRAY_SCAN;
      const positions = mergeOccupiedPositions(source.occupied);
      if (repeatRows) {
        // Only the single source row is buffered. The repeated positions are yielded on demand.
        const row = [...positions];
        if (!row.length) return;
        for (let index = 0; index < rows; index++) for (const column of row) {
          if (--remaining < 0) throw new FormulaCalculationLimit('Expanded array exceeds the preview scan limit.');
          yield index * columns + column;
        }
      } else {
        for (const row of positions) for (let column = 0; column < columns; column++) {
          if (--remaining < 0) throw new FormulaCalculationLimit('Expanded array exceeds the preview scan limit.');
          yield row * columns + column;
        }
      }
    }],
    slice(row, column, height, width) {
      const view = repeatRows ? sliceArray(source, 0, column, 1, width) : sliceArray(source, row, 0, height, 1);
      return expandFormulaArray(view, height, width);
    }
  };
}

export function transposeArray(source: FormulaArray): FormulaArray {
  const { columns: rows, rows: columns } = source;
  return {
    rows, columns, dense: source.dense,
    read(position) {
      return source.read(position === undefined ? undefined : position % columns * rows + Math.floor(position / columns)) ?? 0;
    },
    occupied: source.dense ? [] : [function* () {
      const positions = Array.from(mergeOccupiedPositions(source.occupied), position => position % rows * columns + Math.floor(position / rows));
      yield* positions.sort((a, b) => a - b);
    }],
    slice: (row, column, height, width) => transposeArray(sliceArray(source, column, row, width, height))
  };
}

/** Flatten the source without enumerating its unstored positions. */
export function flattenArray(source: FormulaArray, toColumn: boolean, byColumn: boolean, ignore: number, limit: number): FormulaArray {
  const { rows, columns } = source;
  const size = rows * columns;
  const columnOrder = byColumn && rows > 1 && columns > 1;
  const scanIndex = (position: number) => columnOrder ? position % columns * rows + Math.floor(position / columns) : position;
  const sourceIndex = (index: number) => columnOrder ? index % rows * columns + Math.floor(index / rows) : index;
  const sourcePositions = () => source.dense ? generatedArrayPositions(size) : mergeOccupiedPositions(source.occupied);
  const keep = (value: Scalar | FormulaError) => !(value === null ? ignore & 1 : value instanceof FormulaError && (ignore & 2));
  const keepDefault = !ignore || (!source.dense && keep(captureError(() => source.read())));
  const exceptions: number[] = [];
  if (ignore) {
    for (const position of sourcePositions()) {
      if (keep(captureError(() => source.read(position))) === keepDefault) continue;
      exceptions.push(scanIndex(position));
      if (!keepDefault && exceptions.length > limit) throw new FormulaError('#NUM!');
    }
  }
  const length = keepDefault ? size - exceptions.length : exceptions.length;
  if (!length) throw new FormulaError('#CALC!');
  if (length > limit) throw new FormulaError('#NUM!');
  if (columnOrder) exceptions.sort((a, b) => a - b);
  const dense = source.dense && !ignore;
  return {
    rows: toColumn ? length : 1, columns: toColumn ? 1 : length, dense,
    read(position) {
      if (position === undefined) return keepDefault ? source.read() ?? 0 : null;
      // An excluded input shifts every subsequent output rank by one position.
      const index = keepDefault ? position + firstAfter(exceptions.length, i => exceptions[i] - i <= position) : exceptions[position];
      return source.read(sourceIndex(index)) ?? 0;
    },
    occupied: dense ? [] : [function* () {
      if (!keepDefault) {
        for (let index = 0; index < length; index++) yield index;
        return;
      }
      const positions = sourcePositions();
      const indexes = columnOrder ? Array.from(positions, scanIndex).sort((a, b) => a - b) : positions;
      let excluded = 0;
      for (const index of indexes) {
        while (exceptions[excluded] < index) excluded++;
        if (exceptions[excluded] !== index) yield index - excluded;
      }
    }]
  };
}

interface StackPart { start: number; end: number; source?: FormulaArray }

export function wrapVector(source: FormulaArray, width: number, byRow: boolean, padding?: Scalar | FormulaError): FormulaArray {
  const length = source.rows * source.columns;
  const fullRows = Math.floor(length / width), tail = length % width;
  const reshape = (first: number, rows: number, columns: number): FormulaArray => {
    const size = rows * columns;
    const vector = source.rows === 1 ? sliceArray(source, 0, first, 1, size) : sliceArray(source, first, 0, size, 1);
    return { rows, columns, dense: vector.dense, occupied: vector.occupied, read: position => vector.read(position) };
  };
  const full = reshape(0, fullRows, width);
  const wrapped = tail ? stackArrays([full, reshape(fullRows * width, 1, tail)], true, width, padding) : full;
  return byRow ? wrapped : transposeArray(wrapped);
}

export function stackArrays(inputs: readonly FormulaArray[], byRow: boolean, crossLength = 0,
  padding: Scalar | FormulaError = new FormulaError('#N/A'), minimumLength = 0): FormulaArray {
  const alongSize = (source: FormulaArray) => byRow ? source.rows : source.columns;
  const crossSize = (source: FormulaArray) => byRow ? source.columns : source.rows;
  const readPadding = () => {
    if (padding instanceof FormulaError) throw padding;
    return padding;
  };
  let length = 0;
  const parts: StackPart[] = inputs.map(source => {
    const start = length;
    length += alongSize(source);
    crossLength = Math.max(crossLength, crossSize(source));
    return { source, start, end: length };
  });
  if (minimumLength > length) parts.push({ start: length, end: minimumLength });
  return stackWindow(parts, Math.max(length, minimumLength), crossLength);

  function stackWindow(parts: readonly StackPart[], length: number, cross: number): FormulaArray {
    const rows = byRow ? length : cross, columns = byRow ? cross : length;
    let occupiedArea = 0, largestArea = 0, largest: FormulaArray | undefined;
    for (const { source } of parts) {
      if (!source) continue;
      const area = source.rows * source.columns;
      occupiedArea += area;
      if (!source.dense && area > largestArea) { largest = source; largestArea = area; }
    }
    // A uniform block or a large padding region can supply the common value without expansion.
    const readDefault = occupiedArea < rows * columns / 2 ? readPadding : () => largest?.read() ?? null;
    return {
      rows, columns, zeroForBlanks: true,
      read(position) {
        if (position === undefined) return readDefault();
        const row = Math.floor(position / columns), column = position % columns;
        const along = byRow ? row : column, across = byRow ? column : row;
        const { start, source } = parts[firstAfter(parts.length, i => parts[i].end <= along)];
        if (!source || across >= crossSize(source)) return readPadding();
        const at = along - start;
        return source.read(byRow ? at * source.columns + across : across * source.columns + at);
      },
      occupied: [occupied],
      slice(row, column, sliceRows, sliceColumns) {
        const alongStart = byRow ? row : column, acrossStart = byRow ? column : row;
        const alongCount = byRow ? sliceRows : sliceColumns, acrossCount = byRow ? sliceColumns : sliceRows;
        const next: StackPart[] = [];
        for (const part of parts) {
          const start = Math.max(alongStart, part.start), end = Math.min(alongStart + alongCount, part.end);
          if (end <= start) continue;
          const across = part.source ? Math.min(acrossCount, crossSize(part.source) - acrossStart) : 0;
          let source: FormulaArray | undefined;
          if (part.source && across > 0) {
            const offset = start - part.start, count = end - start;
            source = byRow ? sliceArray(part.source, offset, acrossStart, count, across)
              : sliceArray(part.source, acrossStart, offset, across, count);
          }
          next.push({ start: start - alongStart, end: end - alongStart, source });
        }
        return stackWindow(next, alongCount, acrossCount);
      }
    };

    function* occupied(): Iterable<number> {
      let remaining = MAX_DENSE_ARRAY_SCAN;
      const fallback = captureError(readDefault);
      const sources: OccupiedPositions[] = [];
      for (const { start, end, source } of parts) {
        const positions = byRow ? [] : sources;
        const firstRow = byRow ? start : 0, firstColumn = byRow ? 0 : start;
        const across = source ? crossSize(source) : 0;
        if (source) {
          const dense = source.dense || !sameValue(captureError(() => source.read()), fallback);
          positions.push(() => translate(firstRow, firstColumn, source.columns,
            dense ? generated(source.rows * source.columns) : mergeOccupiedPositions(source.occupied)));
        }
        if (across < cross && !sameValue(padding, fallback)) {
          const width = byRow ? cross - across : end - start;
          positions.push(() => translate(firstRow + (byRow ? 0 : across), firstColumn + (byRow ? across : 0),
            width, generated((end - start) * (cross - across))));
        }
        if (byRow) yield* mergeOccupiedPositions(positions);
      }
      if (!byRow) yield* mergeGroups(0, sources.length);

      function mergeGroups(first: number, end: number): Iterable<number> {
        if (end - first <= 2) return mergeOccupiedPositions(sources.slice(first, end));
        const middle = (first + end) >>> 1;
        return mergeOccupiedPositions([() => mergeGroups(first, middle), () => mergeGroups(middle, end)]);
      }

      function* generated(count: number): Iterable<number> {
        for (let index = 0; index < count; index++) {
          if (--remaining < 0) throw new FormulaCalculationLimit('Generated stack cells exceed the preview scan limit.');
          yield index;
        }
      }
    }

    function* translate(row: number, column: number, width: number, positions: Iterable<number>): Iterable<number> {
      for (const index of positions) yield (row + Math.floor(index / width)) * columns + column + index % width;
    }
  }
}

function sameValue(left: Scalar | FormulaError, right: Scalar | FormulaError): boolean {
  return left === right || (left instanceof FormulaError && right instanceof FormulaError && left.message === right.message);
}

export function chooseValueArray(selector: FormulaArray, choices: readonly FormulaArray[], pick: (value: Scalar) => number): FormulaArray {
  const rows = choices.reduce((max, input) => Math.max(max, input.rows), selector.rows);
  const columns = choices.reduce((max, input) => Math.max(max, input.columns), selector.columns);
  const missing = new FormulaError('#N/A');
  const vector = selector.rows === 1 || selector.columns === 1;
  const byRow = selector.columns === 1;
  return choiceWindow(0, 0, rows, columns);

  function select(row: number, column: number): FormulaArray {
    return choices[pick(readAt(selector, row, column))];
  }

  function readAt(source: FormulaArray, row: number, column: number): Scalar {
    if (source.rows === 1) row = 0;
    if (source.columns === 1) column = 0;
    if (row >= source.rows || column >= source.columns) throw missing;
    return source.read(row * source.columns + column);
  }

  function choiceWindow(firstRow: number, firstColumn: number, rows: number, columns: number): FormulaArray {
    const along = byRow ? rows : columns, across = byRow ? columns : rows;
    const compact = vector && along <= MAX_DENSE_ARRAY_SCAN;
    let stacked: FormulaArray | undefined;
    const stack = () => stacked ??= stackArrays(Array.from({ length: along }, (_, index) => lane(index)), byRow, across);
    return {
      rows, columns, dense: !compact, zeroForBlanks: true,
      read(position) {
        if (position === undefined) return compact ? stack().read() : null;
        const row = firstRow + Math.floor(position / columns), column = firstColumn + position % columns;
        return readAt(select(row, column), row, column);
      },
      occupied: compact ? [() => mergeOccupiedPositions(stack().occupied)] : [],
      slice: (row, column, length, width) => choiceWindow(firstRow + row, firstColumn + column, length, width)
    };

    function lane(index: number): FormulaArray {
      const row = firstRow + (byRow ? index : 0), column = firstColumn + (byRow ? 0 : index);
      const constant = (read: () => Scalar): FormulaArray => ({
        rows: byRow ? 1 : across, columns: byRow ? across : 1, read, occupied: []
      });
      const choice = captureError(() => select(row, column));
      if (choice instanceof FormulaError) return constant(() => { throw choice; });
      const alongSize = byRow ? choice.rows : choice.columns, acrossSize = byRow ? choice.columns : choice.rows;
      const at = alongSize === 1 ? 0 : byRow ? row : column;
      const start = byRow ? firstColumn : firstRow;
      if (at >= alongSize || (acrossSize > 1 && start >= acrossSize)) return constant(() => { throw missing; });
      if (acrossSize === 1) return constant(() => readAt(choice, row, column));
      const length = Math.min(across, acrossSize - start);
      return byRow ? sliceArray(choice, at, start, 1, length) : sliceArray(choice, start, at, length, 1);
    }
  }
}

/** Remap rows or columns while retaining the source's default and sparse data. */
export function filterArray(source: FormulaArray, byRow: boolean, count: number, runs: readonly SelectedInterval[]): FormulaArray {
  return selectAxis(source, byRow, count, index => {
    const run = runs[firstAfter(runs.length, at => runs[at].before + runs[at].end - runs[at].first <= index)];
    return run.first + index - run.before;
  }, function* (columns) {
    for (const position of mergeOccupiedPositions(source.occupied)) {
      const row = Math.floor(position / source.columns), column = position % source.columns;
      const index = byRow ? row : column;
      const run = runs[firstAfter(runs.length, at => runs[at].end <= index)];
      if (!run || index < run.first) continue;
      const selected = run.before + index - run.first;
      yield byRow ? selected * columns + column : row * columns + selected;
    }
  });
}

export function chooseArray(source: FormulaArray, byRow: boolean, indexes: readonly number[]): FormulaArray {
  return selectAxis(source, byRow, indexes.length, index => indexes[index], byRow ? selectedRows : selectedColumns);

  function* selectedRows(columns: number): Iterable<number> {
    const cells = new Map<number, number[]>();
    for (const row of indexes) if (!cells.has(row)) cells.set(row, []);
    for (const position of mergeOccupiedPositions(source.occupied)) {
      cells.get(Math.floor(position / source.columns))?.push(position % source.columns);
    }
    for (let row = 0; row < indexes.length; row++) {
      for (const column of cells.get(indexes[row])!) yield row * columns + column;
    }
  }

  function* selectedColumns(columns: number): Iterable<number> {
    const outputs = new Map<number, number[]>();
    indexes.forEach((column, index) => {
      const positions = outputs.get(column) ?? [];
      positions.push(index);
      outputs.set(column, positions);
    });
    let row = -1;
    let positions: number[] = [];
    for (const position of mergeOccupiedPositions(source.occupied)) {
      const selected = outputs.get(position % source.columns);
      if (!selected) continue;
      const nextRow = Math.floor(position / source.columns);
      if (nextRow !== row) {
        yield* positions.sort((a, b) => a - b);
        row = nextRow;
        positions = [];
      }
      for (const column of selected) positions.push(row * columns + column);
    }
    yield* positions.sort((a, b) => a - b);
  }
}

export function uniqueArray(source: FormulaArray, byRow: boolean, exactlyOnce: boolean): FormulaArray {
  type Entry = [offset: number, key: string];
  const length = byRow ? source.rows : source.columns;
  if (length === 1) return { ...source, zeroForBlanks: true };
  const fallback = source.dense ? uniqueKey(null) : uniqueKey(captureError(() => source.read()));
  const groups = new Map<string, { index: number; count: number }>();
  let seen = 0, next = 0, firstGap: number | undefined;
  for (const [index, entries] of byRow ? rowRecords() : columnRecords()) {
    if (index > next && firstGap === undefined) firstGap = next;
    next = index + 1;
    seen++;
    const key = JSON.stringify(entries), group = groups.get(key);
    if (group) group.count++;
    else groups.set(key, { index, count: 1 });
  }
  if (seen < length) groups.set('[]', { index: firstGap ?? next, count: length - seen });
  const selected = [...groups.values()].filter(group => !exactlyOnce || group.count === 1)
    .map(group => group.index).sort((first, second) => first - second);
  if (!selected.length) throw new FormulaError('#CALC!');
  const runs: SelectedInterval[] = [];
  selected.forEach((index, before) => {
    const last = runs.at(-1);
    if (last?.end === index) last.end++;
    else runs.push({ first: index, end: index + 1, before });
  });
  const first = runs[0].first;
  const result = runs.length === 1
    ? (byRow ? sliceArray(source, first, 0, selected.length, source.columns)
      : sliceArray(source, 0, first, source.rows, selected.length))
    : filterArray(source, byRow, selected.length, runs);
  return { ...result, zeroForBlanks: true };

  function* values() {
    const positions = source.dense ? generatedArrayPositions(source.rows * source.columns) : mergeOccupiedPositions(source.occupied);
    for (const position of positions) {
      const key = uniqueKey(captureError(() => source.read(position)));
      if (key !== fallback) yield { row: Math.floor(position / source.columns), column: position % source.columns, key };
    }
  }

  function* rowRecords(): Iterable<[number, Entry[]]> {
    let index = -1, entries: Entry[] = [];
    for (const { row, column, key } of values()) {
      if (row !== index) {
        if (entries.length) yield [index, entries];
        index = row;
        entries = [];
      }
      entries.push([column, key]);
    }
    if (entries.length) yield [index, entries];
  }

  function* columnRecords(): Iterable<[number, Entry[]]> {
    const records = new Map<number, Entry[]>();
    for (const { row, column, key } of values()) {
      let entries = records.get(column);
      if (!entries) records.set(column, entries = []);
      entries.push([row, key]);
    }
    for (const column of [...records.keys()].sort((first, second) => first - second)) yield [column, records.get(column)!];
  }
}

export function uniqueKey(value: Scalar | FormulaError): string {
  if (value instanceof FormulaError) return 'error:' + value.message.toUpperCase();
  if (typeof value === 'string') return 'text:' + value.toUpperCase();
  if (typeof value === 'number') return 'number:' + value;
  return String(value);
}

export function formulaSortComparator(): (a: Scalar | FormulaError, b: Scalar | FormulaError, order: number) => number {
  let collator: Intl.Collator | undefined;
  const type = (value: Exclude<Scalar, null> | FormulaError) =>
    typeof value === 'number' && Number.isFinite(value) ? 0 : typeof value === 'string' ? 1 : typeof value === 'boolean' ? 2 : 3;
  return (a, b, order) => {
    if (a === b) return 0;
    if (a === null || b === null) return a === null ? 1 : -1;
    const aType = type(a), bType = type(b);
    if (aType !== bType) return (aType - bType) * order;
    if (aType === 3) return 0;
    const sign = typeof a === 'string' && typeof b === 'string'
      ? (collator ??= new Intl.Collator(undefined, { sensitivity: 'accent' })).compare(a, b)
      : a < b ? -1 : a > b ? 1 : 0;
    return sign * order;
  };
}

/** Move the sorted exceptions around an unchanged run of equal keys. */
export function reorderArray(source: FormulaArray, byRow: boolean, ordered: readonly number[], leading: number): FormulaArray {
  if (!ordered.length) return source;
  const count = byRow ? source.rows : source.columns;
  const unchanged = count - ordered.length;
  const originals = unchanged ? [...ordered].sort((a, b) => a - b) : [];
  return selectAxis(source, byRow, count, index => {
    if (index < leading) return ordered[index];
    if (index >= leading + unchanged) return ordered[index - unchanged];
    const offset = index - leading;
    return offset + firstAfter(originals.length, at => originals[at] - at <= offset);
  }, function* (columns) {
    const destinations = new Map<number, number>();
    ordered.forEach((position, index) => destinations.set(position, index < leading ? index : index + unchanged));
    const outputIndex = (index: number) => destinations.get(index)
      ?? leading + index - firstAfter(originals.length, at => originals[at] < index);
    let positions: number[] = [], previousRow = -1;
    for (const position of mergeOccupiedPositions(source.occupied)) {
      const row = Math.floor(position / source.columns), column = position % source.columns;
      if (!byRow && row !== previousRow) {
        yield* positions.sort((a, b) => a - b);
        positions = [];
        previousRow = row;
      }
      positions.push(byRow ? outputIndex(row) * columns + column : row * columns + outputIndex(column));
    }
    yield* positions.sort((a, b) => a - b);
  });
}

function selectAxis(source: FormulaArray, byRow: boolean, count: number, indexAt: (index: number) => number,
  occupied: (columns: number) => Iterable<number>): FormulaArray {
  const rows = byRow ? count : source.rows, columns = byRow ? source.columns : count;
  return {
    rows, columns, dense: source.dense, zeroForBlanks: source.zeroForBlanks,
    read: position => {
      if (position === undefined) return source.read();
      const row = Math.floor(position / columns), column = position % columns;
      return source.read((byRow ? indexAt(row) : row) * source.columns + (byRow ? column : indexAt(column)));
    },
    occupied: source.dense ? [] : [() => occupied(columns)]
  };
}

export function firstAfter(length: number, before: (index: number) => boolean): number {
  let low = 0, high = length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (before(mid)) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** Find ranks in an ordered sample with repeated values stored separately. */
export function weightedRankReader(sorted: ArrayLike<number>, repeats: ReadonlyMap<number, number>): (rank: number) => number {
  if (!repeats.size) return rank => sorted[rank];
  let offset = 0;
  const spans = [...repeats].sort(([left], [right]) => left - right).map(([value, weight]) => {
    const first = firstAfter(sorted.length, index => sorted[index] < value) + offset;
    const span = { value, first, end: first + weight, before: offset };
    offset += weight;
    return span;
  });
  return rank => {
    const next = spans[firstAfter(spans.length, index => spans[index].end <= rank)];
    return next && rank >= next.first ? next.value : sorted[rank - (next?.before ?? offset)];
  };
}

export function* mergeOccupiedPositions(sources: readonly OccupiedPositions[], reverse = false): Iterable<number> {
  const cursors = [...new Set(sources)].map(source => {
    const iterator = source()[Symbol.iterator]();
    return { iterator, next: iterator.next() };
  });
  for (;;) {
    let first = reverse ? -Infinity : Infinity;
    for (const cursor of cursors) if (!cursor.next.done) first = reverse ? Math.max(first, cursor.next.value) : Math.min(first, cursor.next.value);
    if (!Number.isFinite(first)) return;
    yield first;
    for (const cursor of cursors) {
      if (!cursor.next.done && cursor.next.value === first) cursor.next = cursor.iterator.next();
    }
  }
}
