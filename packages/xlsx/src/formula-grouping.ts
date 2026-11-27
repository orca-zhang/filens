import { captureError, firstAfter, FormulaCalculationLimit, FormulaError, formulaSortComparator, generatedArrayPositions,
  MAX_DENSE_ARRAY_SCAN, mergeOccupiedPositions, uniqueKey, type FormulaArray } from './formula-array';
import type { Scalar } from './formula-reader';

export type GroupValue = Scalar | FormulaError;

export interface GroupAggregate {
  label: string;
  run(group: FormulaArray, total: FormulaArray): Scalar;
}

export interface GroupBucket {
  count: number;
  rows: { end: number; values: GroupValue[] }[];
  columns?: Map<number, FormulaArray>;
  results?: Map<number, GroupValue>;
}

export interface FieldGroup extends GroupBucket {
  parent?: FieldGroup;
  label: GroupValue;
  level: number;
  children?: Map<string, FieldGroup>;
}

const maxText = 4 * 1024 * 1024;

export function groupValue(array: FormulaArray, row: number | undefined, column: number): GroupValue {
  return captureError(() => array.read(row === undefined ? undefined : row * array.columns + column));
}

export function hasGroupHeader(values: FormulaArray, headers?: number): boolean {
  return headers === 1 || headers === 3 || (headers === undefined && values.rows > 1
    && typeof groupValue(values, 0, 0) === 'string' && typeof groupValue(values, 1, 0) === 'number');
}

export function visitGroupingRows(values: FormulaArray, fields: FormulaArray[], filter: FormulaArray | undefined,
  hasHeader: boolean, visit: (fields: GroupValue[][], data: GroupValue[], count: number) => void): void {
  const { rows } = values;
  if (fields.some(array => array.rows !== rows) || (filter && (filter.rows !== rows || filter.columns !== 1))) {
    throw new FormulaError('#VALUE!');
  }
  const sources = filter ? [...fields, values, filter] : [...fields, values];
  const width = fields.reduce((sum, field) => sum + field.columns, values.columns);
  let positionsLeft = MAX_DENSE_ARRAY_SCAN, cellsLeft = MAX_DENSE_ARRAY_SCAN, textLength = 0;
  const positions = sources.some(source => source.dense) ? generatedArrayPositions(rows)
    : mergeOccupiedPositions(sources.map(source => () => occupiedRows(source)));
  let next = Number(hasHeader);
  for (const row of positions) {
    if (row < next) continue;
    if (row > next) add(undefined, row - next);
    add(row, 1);
    next = row + 1;
  }
  if (rows > next) add(undefined, rows - next);

  function add(row: number | undefined, count: number) {
    if (filter) {
      const include = groupValue(filter, row, 0);
      if (include instanceof FormulaError) throw include;
      if (typeof include === 'string') throw new FormulaError('#VALUE!');
      if (!include) return;
    }
    if ((cellsLeft -= width) < 0) throw new FormulaCalculationLimit('Grouping exceeds the preview scan limit.');
    const labels = fields.map(field => readRow(field, row));
    visit(labels, readRow(values, row), count);
  }

  function readRow(source: FormulaArray, row: number | undefined): GroupValue[] {
    return Array.from({ length: source.columns }, (_, column) => {
      const value = groupValue(source, row, column);
      if (typeof value === 'string' && (textLength += value.length) > maxText) {
        throw new FormulaCalculationLimit('Grouping text exceeds the preview limit.');
      }
      return value;
    });
  }

  function* occupiedRows(source: FormulaArray): Iterable<number> {
    let previous = -1;
    for (const position of mergeOccupiedPositions(source.occupied)) {
      if (--positionsLeft < 0) throw new FormulaCalculationLimit('Grouping exceeds the preview scan limit.');
      const row = Math.floor(position / source.columns);
      if (row !== previous) yield previous = row;
    }
  }
}

export function createFieldGroup(): FieldGroup {
  return { label: null, level: 0, count: 0, rows: [] };
}

export function addGroupRow(bucket: GroupBucket, values: GroupValue[], count: number): void {
  bucket.count += count;
  bucket.rows.push({ end: bucket.count, values });
}

export function addFieldGroups(root: FieldGroup, labels: GroupValue[], values: GroupValue[], count: number): FieldGroup[] {
  const groups = [root];
  addGroupRow(root, values, count);
  let group = root;
  for (const label of labels) {
    const children = group.children ??= new Map();
    const key = uniqueKey(label);
    let child = children.get(key);
    if (!child) children.set(key, child = { parent: group, label, level: group.level + 1, count: 0, rows: [] });
    group = child;
    addGroupRow(group, values, count);
    groups.push(group);
  }
  return groups;
}

export function groupFields(group: FieldGroup): GroupValue[] {
  const labels = new Array<GroupValue>(group.level);
  for (let node = group; node.parent; node = node.parent) labels[node.level - 1] = node.label;
  return labels;
}

export function groupLabels(group: FieldGroup, keys: number, depth: number): GroupValue[] {
  const labels = group.level ? groupFields(group).map(label => label ?? 0) : keys ? [Math.abs(depth) > 1 ? 'Grand Total' : 'Total'] : [];
  while (labels.length < keys) labels.push('');
  return labels;
}

export function* orderFieldGroups(root: FieldGroup, keys: number, depth: number, sort: number[],
  metric: (group: FieldGroup, column: number) => GroupValue, table = false): Iterable<FieldGroup> {
  if (depth < 0) yield root;
  const compare = formulaSortComparator();
  if (table) {
    const leaves: { group: FieldGroup; fields: GroupValue[] }[] = [], pending = [root];
    while (pending.length) {
      const group = pending.pop()!;
      if (!group.children) leaves.push({ group, fields: groupFields(group) });
      else for (const child of group.children.values()) pending.push(child);
    }
    leaves.sort((a, b) => {
      for (const index of sort) {
        const col = Math.abs(index) - 1;
        const order = col < keys ? compare(a.fields[col], b.fields[col], Math.sign(index))
          : compare(metric(a.group, col - keys), metric(b.group, col - keys), Math.sign(index));
        if (order) return order;
      }
      for (let col = 0; col < keys; col++) {
        const order = compare(a.fields[col], b.fields[col], 1);
        if (order) return order;
      }
      return 0;
    });
    for (const { group } of leaves) yield group;
  } else {
    const byMetric = sort.length === 1 && Math.abs(sort[0]) > keys ? sort[0] : 0;
    const pending: { group: FieldGroup; emit?: true }[] = [{ group: root }];
    while (pending.length) {
      const { group, emit } = pending.pop()!;
      if (emit || !group.children) {
        yield group;
        continue;
      }
      const subtotal = group.level > 0 && group.level < Math.abs(depth);
      if (subtotal && depth < 0) yield group;
      if (subtotal && depth > 0) pending.push({ group, emit: true });
      const order = Math.sign(sort.find(index => Math.abs(index) === group.level + 1) ?? 1);
      const col = Math.abs(byMetric) - 1 - keys;
      const children = [...group.children.values()].sort((a, b) => (byMetric ? compare(metric(a, col), metric(b, col), Math.sign(byMetric)) : 0)
        || compare(a.label, b.label, order));
      for (let i = children.length - 1; i >= 0; i--) pending.push({ group: children[i] });
    }
  }
  if (depth > 0) yield root;
}

export function groupMetrics(aggregates: GroupAggregate[]) {
  let readsLeft = MAX_DENSE_ARRAY_SCAN * 4, textLength = 0;
  return (bucket: GroupBucket, relative: GroupBucket, measure: number, metric: number): GroupValue => {
    const id = measure * aggregates.length + metric;
    const results = bucket.results ??= new Map();
    const cached = results.get(id);
    if (cached !== undefined) return cached;
    const value = captureError(() => aggregates[metric].run(column(bucket, measure), column(relative, measure))) ?? 0;
    if (typeof value === 'string' && (textLength += value.length) > maxText) {
      throw new FormulaCalculationLimit('Grouped result text exceeds the preview limit.');
    }
    results.set(id, value);
    return value;
  };

  function charge() {
    if (--readsLeft < 0) throw new FormulaCalculationLimit('Grouped aggregates exceed the preview scan limit.');
  }

  function column(bucket: GroupBucket, col: number): FormulaArray {
    const columns = bucket.columns ??= new Map();
    const cached = columns.get(col);
    if (cached) return cached;
    const { rows, count } = bucket;
    // Repeated rows can be read as one weighted value by the aggregate.
    const repeated = rows.find((row, index) => row.end - (rows[index - 1]?.end ?? 0) > 1);
    const common = repeated ? repeated.values[col] : null;
    const array: FormulaArray = {
      rows: count, columns: 1,
      read(position) {
        charge();
        const value = position === undefined ? common : rows[firstAfter(rows.length, index => rows[index].end <= position)].values[col];
        if (value instanceof FormulaError) throw value;
        return value;
      },
      occupied: [function* () {
        let start = 0;
        for (const { end, values } of rows) {
          charge();
          if (values[col] !== common) for (let position = start; position < end; position++) {
            charge();
            yield position;
          }
          start = end;
        }
      }]
    };
    columns.set(col, array);
    return array;
  }
}
