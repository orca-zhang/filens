import type { ParsedMerge } from './types';

/** Visit intersecting ranges without allocating entries for covered cells. */
export class RowRangeIndex<T extends ParsedMerge> {
  private readonly ranges: T[];
  private readonly ends: Float64Array;
  private readonly size: number;
  private columns?: { first: Uint16Array; last: Uint16Array } | false;

  constructor(ranges: T[]) {
    this.ranges = ranges.sort((a, b) => a.firstRow - b.firstRow || a.firstColumn - b.firstColumn);
    let size = 1;
    while (size < ranges.length) size *= 2;
    this.size = size;
    this.ends = new Float64Array(size * 2);
    for (let i = 0; i < ranges.length; i++) this.ends[size + i] = ranges[i].lastRow;
    for (let node = size - 1; node; node--) this.ends[node] = Math.max(this.ends[node * 2], this.ends[node * 2 + 1]);
  }

  forEach(firstRow: number, lastRow: number, callback: (range: T) => void,
    columns?: readonly [firstColumn: number, lastColumn: number]): void {
    const firstColumn = columns?.[0] ?? -Infinity, lastColumn = columns?.[1] ?? Infinity;
    const bounds = columns && (this.columns ??= this.columnBounds());
    const visit = (node: number, begin: number, end: number) => {
      if (begin >= this.ranges.length || this.ends[node] < firstRow || this.ranges[begin].firstRow > lastRow
        || (bounds && (bounds.first[node] > lastColumn || bounds.last[node] < firstColumn))) return;
      if (end - begin === 1) {
        const range = this.ranges[begin];
        if (!columns || bounds || !(range.firstColumn > lastColumn || range.lastColumn < firstColumn)) callback(range);
      } else {
        const middle = (begin + end) >>> 1;
        visit(node * 2, begin, middle);
        visit(node * 2 + 1, middle, end);
      }
    };
    visit(1, 0, this.size);
  }

  private columnBounds() {
    // Identical column spans give every branch the same bounds.
    const edge = this.ranges[0];
    if (this.ranges.length < 64 || this.ranges.every(range =>
      range.firstColumn === edge.firstColumn && range.lastColumn === edge.lastColumn)) return false as const;
    const first = new Uint16Array(this.ends.length), last = new Uint16Array(this.ends.length);
    first.fill(0xffff);
    for (let i = 0; i < this.ranges.length; i++) {
      const { firstColumn, lastColumn } = this.ranges[i];
      if (!Number.isSafeInteger(firstColumn) || !Number.isSafeInteger(lastColumn)
        || firstColumn < 1 || firstColumn > lastColumn || lastColumn > 0xffff) return false as const;
      first[this.size + i] = firstColumn;
      last[this.size + i] = lastColumn;
    }
    for (let node = this.size - 1; node > 0; node--) {
      first[node] = Math.min(first[node * 2], first[node * 2 + 1]);
      last[node] = Math.max(last[node * 2], last[node * 2 + 1]);
    }
    return { first, last };
  }
}
