import { forEachWorksheetRangeValue, resolvedCellScalar } from './cell-value';
import { weightedRankReader } from './formula-array';
import { memoizeWithFormulaTime } from './formula-clock';
import type { Scalar } from './formula-reader';
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
  const value = cell && resolvedCellScalar(sheet, cell);
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
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
  return memoizeWithFormulaTime(sheet, (): ConditionalRangeValues | undefined => {
    let min = Infinity, max = -Infinity, count = 0;
    let scale = 0, center = 0, sum = 0, correction = 0, mean = 0, squaredDistance = 0;
    let values = needsSort ? new Float64Array(256) : undefined;
    let stored = 0;
    const repeated = needsSort ? new Map<number, number>() : undefined;
    const counts = frequency ? new Map<FrequencyKey, number>() : undefined;
    const visit = (value: Scalar, weight: number) => {
      if (counts) {
        const key = frequencyKey(value);
        if (key !== undefined) counts.set(key, Math.min(2, (counts.get(key) ?? 0) + weight));
      }
      if (!needsNumbers || typeof value !== 'number' || !Number.isFinite(value)) return;
      if (value < min) min = value;
      if (value > max) max = value;
      if (values && repeated) {
        if (weight > 1) repeated.set(value, (repeated.get(value) ?? 0) + weight);
        else {
          if (stored === values.length) {
            const next = new Float64Array(values.length * 2);
            next.set(values);
            values = next;
          }
          values[stored++] = value;
        }
      }
      count += weight;
      if (average) {
        // Center and scale the running statistics to preserve small differences and keep the variance finite.
        const magnitude = Math.abs(value);
        if (magnitude && (!scale || magnitude / 2 >= scale)) {
          const next = 2 ** Math.min(1023, Math.floor(Math.log2(magnitude)));
          const factor = scale / next;
          center *= factor;
          sum *= factor;
          correction *= factor;
          mean *= factor;
          squaredDistance *= factor * factor;
          scale = next;
        }
        const normalized = scale ? value / scale : 0;
        if (count === weight) center = normalized;
        const shifted = normalized - center, delta = shifted - mean;
        // Compensated summation keeps cells at the mean eligible for inclusive rules.
        const adjusted = shifted * weight - correction, next = sum + adjusted;
        correction = (next - sum) - adjusted;
        sum = next;
        mean = sum / count;
        squaredDistance += weight * delta * (shifted - mean);
      }
    };
    let complete = true;
    visitDisjointAreas(ranges, range => { if (complete) complete = forEachWorksheetRangeValue(sheet, range, visit); });
    if (!complete) return undefined;
    const percentileValues = new Map<number, number>();
    const ranks = new Map<RankCondition, number>();
    if (values && repeated && count) {
      const at = weightedRankReader(values.subarray(0, stored).sort(), repeated);
      for (const percentile of percentiles) {
        const position = percentile / 100 * (count - 1), lower = Math.floor(position);
        percentileValues.set(percentile, interpolate(at(lower), at(Math.ceil(position)), position - lower));
      }
      for (const rule of rankRules) {
        // Match Calc's whole-cell rounding for percentage ranks.
        const limit = rule.percent ? Math.floor(count * rule.rank / 100) : Math.min(count, rule.rank);
        if (limit) ranks.set(rule, at(rule.bottom ? limit - 1 : count - limit));
      }
    }
    // Keep the requested order statistics and release the numeric buffer.
    return { min, max, percentiles: percentileValues, ranks, frequency: frequencyReader(sheet, counts),
      average: { center, scale: scale || 1, mean, deviation: count ? Math.sqrt(Math.max(0, squaredDistance / count)) : 0 } };
  });
}

function frequencyKey(value: Scalar | undefined): FrequencyKey | undefined {
  if (value == null || value === '') return undefined;
  return typeof value === 'string' ? value.toLowerCase() : value;
}

function frequencyReader(sheet: ParsedSheet, counts?: ReadonlyMap<FrequencyKey, number>) {
  const wildcardCounts = new Map<string, number>();
  return (cell: ParsedCell) => {
    const key = frequencyKey(resolvedCellScalar(sheet, cell));
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
