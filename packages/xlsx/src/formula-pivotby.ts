import { FormulaCalculationLimit, FormulaError, MAX_DENSE_ARRAY_SCAN, type FormulaArray } from './formula-array';
import { addFieldGroups, addGroupRow, createFieldGroup, groupLabels, groupMetrics, groupValue, hasGroupHeader, orderFieldGroups,
  visitGroupingRows, type FieldGroup, type GroupAggregate, type GroupBucket, type GroupValue } from './formula-grouping';

interface PivotOptions {
  headers?: number;
  rowDepth: number;
  columnDepth: number;
  rowSort: number[];
  columnSort: number[];
  filter?: FormulaArray;
  relative: number;
  vertical: boolean;
}

const noFields: GroupValue[] = [];

export function pivotFormulaRows(rowFields: FormulaArray | undefined, columnFields: FormulaArray | undefined, values: FormulaArray,
  aggregates: GroupAggregate[], options: PivotOptions): FormulaArray {
  const { headers, rowDepth, columnDepth, rowSort, columnSort, filter, relative, vertical } = options;
  const rowKeys = rowFields?.columns ?? 0, columnKeys = columnFields?.columns ?? 0;
  const measures = values.columns, vector = aggregates.length > 1;
  const horizontalMetrics = vector && !vertical, verticalMetrics = vector && vertical;
  const width = vertical ? measures : Math.max(measures, aggregates.length);
  const left = rowKeys + Number(verticalMetrics);
  validateAxis(rowKeys, rowDepth, rowSort);
  validateAxis(columnKeys, columnDepth, columnSort);
  if (!rowKeys && !columnKeys) throw new FormulaError('#VALUE!');

  const rowRoot = createFieldGroup(), columnRoot = createFieldGroup();
  const intersections = new Map<FieldGroup, Map<FieldGroup, GroupBucket>>();
  const inputHeaders = hasGroupHeader(values, headers);
  let intersectionsLeft = MAX_DENSE_ARRAY_SCAN;
  visitGroupingRows(values, [rowFields, columnFields].filter(field => field !== undefined), filter, inputHeaders, (labels, data, count) => {
    const rows = addFieldGroups(rowRoot, rowFields ? labels[0] : noFields, data, count);
    const columns = addFieldGroups(columnRoot, columnFields ? labels[Number(Boolean(rowFields))] : noFields, data, count);
    const selectedRows = selectGroups(rows, rowDepth, rowKeys, relative === 4);
    const selectedColumns = selectGroups(columns, columnDepth, columnKeys, relative === 3);
    for (const row of selectedRows) {
      const cells = intersections.get(row) ?? new Map();
      intersections.set(row, cells);
      for (const column of selectedColumns) {
        if (--intersectionsLeft < 0) throw new FormulaCalculationLimit('Pivot groups exceed the preview limit.');
        const bucket = cells.get(column) ?? { count: 0, rows: [] };
        cells.set(column, bucket);
        addGroupRow(bucket, data, count);
      }
    }
  });
  if (!rowRoot.count) throw new FormulaError('#CALC!');

  const aggregate = groupMetrics(aggregates);
  const rowGroups = [...orderFieldGroups(rowRoot, rowKeys, rowDepth, rowSort, (group, measure) => metric(group, columnRoot, measure))];
  const columnGroups = [...orderFieldGroups(columnRoot, columnKeys, columnDepth, columnSort, (group, measure) => metric(rowRoot, group, measure))];
  const showHeaders = headers === 2 || headers === 3
    || (headers === undefined && inputHeaders && columnKeys > 0 && (width > 1 || columnKeys > 1));
  const columnNames = showHeaders ? columnKeys : 0;
  const headerRows = columnNames + columnKeys + Number(horizontalMetrics) + Number(showHeaders);
  const height = verticalMetrics ? aggregates.length : 1;
  const rows = headerRows + rowGroups.length * height, columns = left + columnGroups.length * width;
  if (rows > 1_048_576 || columns > 16_384) throw new FormulaError('#SPILL!');

  let lastRow: FieldGroup | undefined, rowLabels: GroupValue[] = [];
  let lastColumn: FieldGroup | undefined, columnLabels: GroupValue[] = [];
  return { rows, columns, dense: true, occupied: [], read(position) {
    if (position === undefined) return null;
    const row = Math.floor(position / columns), column = position % columns;
    const value = row < headerRows ? header(row, column) : body(row - headerRows, column);
    if (value instanceof FormulaError) throw value;
    return value;
  } };

  function validateAxis(keys: number, depth: number, sort: number[]) {
    if (Math.abs(depth) > keys || sort.some(index => !Number.isInteger(index) || !index
      || Math.abs(index) > keys + (sort.length > 1 ? 0 : width))) throw new FormulaError('#VALUE!');
  }

  function intersection(row: FieldGroup, column: FieldGroup): GroupBucket | undefined {
    if (!row.level) return column;
    if (!column.level) return row;
    return intersections.get(row)?.get(column);
  }

  function metric(row: FieldGroup, column: FieldGroup, slot: number, index = horizontalMetrics ? slot : 0): GroupValue {
    const measure = measures === 1 ? 0 : slot;
    if (measure >= measures || index >= aggregates.length) return new FormulaError('#N/A');
    const bucket = intersection(row, column);
    if (!bucket) return '';
    const relativeRow = relative === 1 || relative === 3 ? row : relative === 4 ? row.parent ?? row : rowRoot;
    const relativeColumn = relative === 0 || relative === 4 ? column : relative === 3 ? column.parent ?? column : columnRoot;
    return aggregate(bucket, intersection(relativeRow, relativeColumn)!, measure, index);
  }

  function fieldName(source: FormulaArray, index: number, fallback: string): GroupValue {
    return headers === 2 ? fallback : groupValue(source, 0, index) ?? '';
  }

  function header(row: number, column: number): GroupValue {
    const slot = (column - left) % width;
    if (row < columnNames) return column === left ? fieldName(columnFields!, row, `Column Field ${row + 1}`) : '';
    row -= columnNames;
    if (row < columnKeys) {
      if (column < left) return '';
      const group = columnGroups[Math.floor((column - left) / width)];
      if (lastColumn !== group) {
        lastColumn = group;
        columnLabels = groupLabels(group, columnKeys, columnDepth);
      }
      return columnLabels[row];
    }
    if (horizontalMetrics && row === columnKeys) return column < left ? '' : aggregates[slot]?.label ?? '';
    if (column < rowKeys) return fieldName(rowFields!, column, `Row Field ${column + 1}`);
    if (column < left) return '';
    const measure = measures === 1 ? 0 : slot;
    return measure >= measures ? '' : fieldName(values, measure, `Value ${measure + 1}`);
  }

  function body(row: number, column: number): GroupValue {
    const group = rowGroups[Math.floor(row / height)];
    const index = verticalMetrics ? row % height : undefined;
    if (column < rowKeys) {
      if (lastRow !== group) {
        lastRow = group;
        rowLabels = groupLabels(group, rowKeys, rowDepth);
      }
      return rowLabels[column];
    }
    if (column < left) return aggregates[index!].label;
    const field = column - left;
    return metric(group, columnGroups[Math.floor(field / width)], field % width, index);
  }
}

function selectGroups(path: FieldGroup[], depth: number, keys: number, includeParent: boolean): FieldGroup[] {
  return path.filter(group => group.level > 0 && (group.level < Math.abs(depth) || group.level === keys
    || (includeParent && group.level === keys - 1)));
}
