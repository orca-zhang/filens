import { FormulaCalculationLimit, FormulaError, MAX_DENSE_ARRAY_SCAN, type FormulaArray } from './formula-array';
import { addFieldGroups, createFieldGroup, groupLabels, groupMetrics, groupValue, hasGroupHeader, orderFieldGroups, visitGroupingRows,
  type FieldGroup, type GroupAggregate, type GroupValue } from './formula-grouping';

interface GroupOptions {
  headers?: number;
  depth: number;
  sort: number[];
  filter?: FormulaArray;
  table: boolean;
  vertical: boolean;
}

interface OutputRow {
  labels: GroupValue[];
  group?: FieldGroup;
  metric?: number;
}

export function groupFormulaRows(fields: FormulaArray, values: FormulaArray, aggregates: GroupAggregate[],
  { headers, depth, sort, filter, table, vertical }: GroupOptions): FormulaArray {
  const keys = fields.columns, measures = values.columns;
  const vector = aggregates.length > 1, metricLabels = Number(vertical && vector);
  const width = vertical ? measures : Math.max(measures, aggregates.length);
  const columns = keys + width + metricLabels;
  if (columns > 16_384) throw new FormulaError('#SPILL!');
  if (Math.abs(depth) > keys || (table && Math.abs(depth) > 1)) throw new FormulaError('#VALUE!');
  if (sort.some(index => !Number.isInteger(index) || index === 0 || Math.abs(index) > (sort.length > 1 ? keys : columns)
    || (metricLabels && Math.abs(index) === keys + 1))) throw new FormulaError('#VALUE!');

  const total = createFieldGroup();
  visitGroupingRows(values, [fields], filter, hasGroupHeader(values, headers), ([labels], data, count) => {
    addFieldGroups(total, labels, data, count);
  });
  if (!total.count) throw new FormulaError('#CALC!');

  const aggregate = groupMetrics(aggregates);
  const metricValue = (group: FieldGroup, column: number, index?: number): GroupValue => {
    const metric = index ?? (!vertical && vector ? column : 0);
    const measure = measures === 1 ? 0 : column;
    if (metric >= aggregates.length || measure >= measures) return new FormulaError('#N/A');
    return aggregate(group, total, measure, metric);
  };

  const output: OutputRow[] = [];
  if (vector && !vertical) {
    output.push({ labels: [...Array<GroupValue>(keys).fill(''), ...Array.from({ length: width }, (_, col) => aggregates[col]?.label ?? '')] });
  }
  if (headers === 2 || headers === 3) {
    const labels = Array.from({ length: keys }, (_, col) => headers === 2 ? `Row Field ${col + 1}` : groupValue(fields, 0, col) ?? '');
    if (metricLabels) labels.push('');
    for (let col = 0; col < width; col++) {
      const measure = measures === 1 ? 0 : col;
      labels.push(headers === 2 ? `Value ${measure + 1}` : measure < measures ? groupValue(values, 0, measure) ?? '' : '');
    }
    output.push({ labels });
  }

  for (const group of orderFieldGroups(total, keys, depth, sort, (group, column) => metricValue(group, column - metricLabels), table)) {
    const count = metricLabels ? aggregates.length : 1;
    if (output.length + count > 1_048_576) throw new FormulaError('#SPILL!');
    if ((output.length + count) * columns > MAX_DENSE_ARRAY_SCAN) throw new FormulaCalculationLimit('Grouped results exceed the preview limit.');
    const labels = groupLabels(group, keys, depth);
    if (!metricLabels) output.push({ group, labels });
    else aggregates.forEach(({ label }, metric) => output.push({ group, labels: [...labels, label], metric }));
  }
  return { rows: output.length, columns, dense: true, occupied: [], read(position) {
    if (position === undefined) return null;
    const { labels, group, metric } = output[Math.floor(position / columns)];
    const col = position % columns;
    const value = col < labels.length ? labels[col] : metricValue(group!, col - labels.length, metric);
    if (value instanceof FormulaError) throw value;
    return value;
  } };
}
