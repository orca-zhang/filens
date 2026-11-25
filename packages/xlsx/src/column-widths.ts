const DEFAULT_WIDTH = 96;

/** Static prefix widths keep horizontal windows and merged fragments in source coordinates. */
export class ColumnWidths {
  private readonly offsets?: Float64Array;

  constructor(readonly count: number, source?: readonly number[]) {
    if (!source) return;
    this.offsets = new Float64Array(count + 1);
    for (let index = 0; index < count; index++) {
      const width = source[index];
      this.offsets[index + 1] = this.offsets[index] + (Number.isFinite(width) && width > 0 ? width : DEFAULT_WIDTH);
    }
  }

  before(column: number): number {
    const index = Math.min(this.count, Math.max(0, column - 1));
    return this.offsets ? this.offsets[index] : index * DEFAULT_WIDTH;
  }

  width(column: number): number { return this.before(column + 1) - this.before(column); }

  at(pixel: number): number {
    pixel = Math.max(0, pixel) || 0;
    if (!this.offsets) return Math.min(this.count, Math.floor(pixel / DEFAULT_WIDTH) + 1);
    let low = 1, high = this.count;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.offsets[middle] <= pixel) low = middle + 1;
      else high = middle;
    }
    return low;
  }
}
