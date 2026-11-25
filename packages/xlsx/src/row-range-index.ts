/** Visit intersecting row intervals without allocating entries for covered rows. */
export class RowRangeIndex<T extends { firstRow: number; lastRow: number; firstColumn: number }> {
  private readonly ranges: T[];
  private readonly ends: Float64Array;
  private readonly size: number;

  constructor(ranges: T[]) {
    this.ranges = ranges.sort((a, b) => a.firstRow - b.firstRow || a.firstColumn - b.firstColumn);
    let size = 1;
    while (size < ranges.length) size *= 2;
    this.size = size;
    this.ends = new Float64Array(size * 2);
    for (let i = 0; i < ranges.length; i++) this.ends[size + i] = ranges[i].lastRow;
    for (let node = size - 1; node; node--) this.ends[node] = Math.max(this.ends[node * 2], this.ends[node * 2 + 1]);
  }

  forEach(firstRow: number, lastRow: number, callback: (range: T) => void): void {
    const visit = (node: number, begin: number, end: number) => {
      if (begin >= this.ranges.length || this.ends[node] < firstRow || this.ranges[begin].firstRow > lastRow) return;
      if (end - begin === 1) callback(this.ranges[begin]);
      else {
        const middle = (begin + end) >>> 1;
        visit(node * 2, begin, middle);
        visit(node * 2 + 1, middle, end);
      }
    };
    visit(1, 0, this.size);
  }
}
