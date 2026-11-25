import { forEachWorksheetRangeCell, readCellScalar, resolveCellValue } from './cell-value';
import type { ParsedCell, ParsedCondition, ParsedMerge, ParsedSheet } from './types';
import { wildcardMatcher } from './wildcard-matcher';

type RankCondition = Extract<ParsedCondition, { type: 'top10' }>;
type FrequencyKey = string | number | boolean;

export interface ConditionalRangeValues {
  min: number;
  max: number;
  percentiles: ReadonlyMap<number, number>;
  ranks: ReadonlyMap<RankCondition, number>;
  average: { center: number; scale: number; mean: number; deviation: number };
  frequency: (cell: ParsedCell) => number;
}

export function numericCellValue(sheet: ParsedSheet, cell?: ParsedCell): number | undefined {
  if (!cell) return undefined;
  if (cell.needsCalculation) resolveCellValue(sheet, cell);
  if (cell.valueType && cell.valueType !== 'date') return undefined;
  try {
    const value = readCellScalar(sheet, cell);
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function createRangeValueReader(sheet: ParsedSheet, ranges: readonly ParsedMerge[], conditions: readonly ParsedCondition[]) {
  const percentiles = new Set<number>();
  const rankRules: RankCondition[] = [];
  let extrema = false, average = false, frequency = false;
  for (const condition of conditions) {
    if ('thresholds' in condition) {
      for (const threshold of condition.thresholds) {
        if (threshold.type === 'percentile') percentiles.add(threshold.value);
        else if (threshold.type !== 'num' && threshold.type !== 'formula') extrema = true;
      }
    } else if (condition.type === 'top10' && condition.rank) rankRules.push(condition);
    else if (condition.type === 'aboveAverage') average = true;
    else if (condition.type === 'duplicateValues' || condition.type === 'uniqueValues') frequency = true;
  }
  const needsSort = percentiles.size > 0 || rankRules.length > 0;
  const needsNumbers = extrema || average || needsSort;
  if (!needsNumbers && !frequency) return undefined;
  let result: ConditionalRangeValues | undefined;
  return () => {
    if (result) return result;
    let min = Infinity, max = -Infinity, count = 0;
    let scale = 0, center = 0, mean = 0, squaredDistance = 0;
    let values = needsSort ? new Float64Array(256) : undefined;
    const counts = frequency ? new Map<FrequencyKey, number>() : undefined;
    const visit = (cell: ParsedCell) => {
      if (counts) {
        const key = frequencyKey(sheet, cell);
        if (key !== undefined) counts.set(key, Math.min(2, (counts.get(key) ?? 0) + 1));
      }
      if (!needsNumbers) return;
      const value = numericCellValue(sheet, cell);
      if (value === undefined) return;
      if (value < min) min = value;
      if (value > max) max = value;
      if (values) {
        if (count === values.length) {
          const next = new Float64Array(values.length * 2);
          next.set(values);
          values = next;
        }
        values[count] = value;
      }
      count++;
      if (average) {
        // Centering preserves small differences. A power-of-two scale keeps the variance finite.
        const magnitude = Math.abs(value);
        if (magnitude && (!scale || magnitude / 2 >= scale)) {
          const next = 2 ** Math.min(1023, Math.floor(Math.log2(magnitude)));
          const factor = scale / next;
          center *= factor;
          mean *= factor;
          squaredDistance *= factor * factor;
          scale = next;
        }
        const normalized = scale ? value / scale : 0;
        if (count === 1) center = normalized;
        const shifted = normalized - center, delta = shifted - mean;
        mean += delta / count;
        squaredDistance += delta * (shifted - mean);
      }
    };
    visitDisjointAreas(ranges, range => forEachWorksheetRangeCell(sheet, range, visit));
    const percentileValues = new Map<number, number>();
    const ranks = new Map<RankCondition, number>();
    if (values && count) {
      const sorted = values.subarray(0, count).sort();
      for (const percentile of percentiles) {
        const position = percentile / 100 * (count - 1), lower = Math.floor(position);
        percentileValues.set(percentile, interpolate(sorted[lower], sorted[Math.ceil(position)], position - lower));
      }
      for (const rule of rankRules) {
        // Match Calc's whole-cell rounding for percentage ranks.
        const limit = rule.percent ? Math.floor(count * rule.rank / 100) : Math.min(count, rule.rank);
        if (limit) ranks.set(rule, sorted[rule.bottom ? limit - 1 : count - limit]);
      }
    }
    // Keep the requested order statistics and release the numeric buffer.
    result = { min, max, percentiles: percentileValues, ranks, frequency: frequencyReader(sheet, counts),
      average: { center, scale: scale || 1, mean, deviation: count ? Math.sqrt(Math.max(0, squaredDistance / count)) : 0 } };
    return result;
  };
}

function frequencyKey(sheet: ParsedSheet, cell: ParsedCell): FrequencyKey | undefined {
  if (cell.needsCalculation) resolveCellValue(sheet, cell);
  try {
    const value = readCellScalar(sheet, cell);
    if (value === null || value === '') return undefined;
    return typeof value === 'string' ? value.toLowerCase() : value;
  } catch {
    return undefined;
  }
}

function frequencyReader(sheet: ParsedSheet, counts?: ReadonlyMap<FrequencyKey, number>) {
  const wildcardCounts = new Map<string, number>();
  return (cell: ParsedCell) => {
    const key = frequencyKey(sheet, cell);
    if (key === undefined || !counts) return 0;
    if (typeof key !== 'string' || !/[*?]|~[~*?]/.test(key)) return counts.get(key) ?? 0;
    const cached = wildcardCounts.get(key);
    if (cached !== undefined) return cached;
    const matches = wildcardMatcher(key);
    let total = 0;
    for (const [value, count] of counts) {
      if (typeof value === 'string' && matches(value)) total += count;
      if (total > 1) break;
    }
    wildcardCounts.set(key, total);
    return total;
  };
}

export function interpolate(min: number, max: number, fraction: number): number {
  return min * (1 - fraction) + max * fraction;
}

function visitDisjointAreas(ranges: readonly ParsedMerge[], visit: (range: ParsedMerge) => void): void {
  if (ranges.length === 1) { visit(ranges[0]); return; }
  // A sweep at rectangle boundaries visits overlapping sqref entries once per source coordinate.
  const events = ranges.flatMap(range => [{ row: range.firstRow, open: true, range }, { row: range.lastRow + 1, open: false, range }]);
  events.sort((a, b) => a.row - b.row);
  const active = new Set<ParsedMerge>();
  let top = events[0]?.row;
  for (const event of events) {
    if (top < event.row && active.size) {
      const columns = [...active].sort((a, b) => a.firstColumn - b.firstColumn);
      let left = columns[0].firstColumn, right = columns[0].lastColumn;
      for (let i = 1; i < columns.length; i++) {
        const range = columns[i];
        if (range.firstColumn <= right + 1) right = Math.max(right, range.lastColumn);
        else {
          visit({ firstRow: top, lastRow: event.row - 1, firstColumn: left, lastColumn: right });
          left = range.firstColumn;
          right = range.lastColumn;
        }
      }
      visit({ firstRow: top, lastRow: event.row - 1, firstColumn: left, lastColumn: right });
    }
    if (event.open) active.add(event.range);
    else active.delete(event.range);
    top = event.row;
  }
}
