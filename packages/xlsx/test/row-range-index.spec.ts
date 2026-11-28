import { describe, expect, it } from 'vitest';
import { RowRangeIndex } from '../src/row-range-index';

describe('worksheet range windows', () => {
  it('preserves intersection and callback order with overlapping and duplicate ranges', () => {
    const ranges = Array.from({ length: 77 }, (_, id) => {
      const firstRow = id % 9 + 1, firstColumn = (id * 13) % 31 + 1;
      return { id, firstRow, lastRow: firstRow + id % 7, firstColumn, lastColumn: firstColumn + id % 5 };
    });
    ranges.push({ ...ranges[0], id: 77 });
    ranges.push({ id: 78, firstRow: 1, lastRow: 1_048_576, firstColumn: 24, lastColumn: 16_384 });
    const index = new RowRangeIndex(ranges);
    for (const [first, last] of [[1, 3], [6, 10], [14, 15], [1_048_576, 1_048_576]]) {
      for (const [left, right] of [[1, 2], [9, 17], [24, 24], [16_378, 16_384]]) {
        const found: number[] = [];
        index.forEach(first, last, range => found.push(range.id), [left, right]);
        expect(found).toEqual(ranges.filter(range => range.firstRow <= last && range.lastRow >= first
          && range.firstColumn <= right && range.lastColumn >= left).map(range => range.id));
      }
      const rowOnly: number[] = [];
      index.forEach(first, last, range => rowOnly.push(range.id));
      expect(rowOnly).toEqual(ranges.filter(range => range.firstRow <= last && range.lastRow >= first).map(range => range.id));
    }
  });

  it('can query larger caller-supplied columns without truncating the coordinates', () => {
    const ranges = Array.from({ length: 64 }, (_, i) => ({
      firstRow: 1, lastRow: 1, firstColumn: 65_535 + i, lastColumn: 65_536 + i
    }));
    const index = new RowRangeIndex(ranges);
    const columns: number[] = [];
    index.forEach(1, 1, range => columns.push(range.firstColumn), [65_540, 65_540]);
    expect(columns).toEqual([65_539, 65_540]);
  });
});
