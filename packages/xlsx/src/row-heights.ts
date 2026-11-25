/** Prefix heights support sparse measurement updates and pixel-to-row lookup without a full scan on scroll. */
export class RowHeights {
  private readonly values?: Float64Array;
  private readonly tree?: Float64Array;
  private readonly measured = new Map<number, number>();
  private readonly deltas = new Map<number, number>();

  constructor(readonly count: number, private readonly source?: readonly number[], measured?: ReadonlyMap<number, number>) {
    // XLSX uses a uniform baseline even when its declared dimensions are very large.
    if (!source) {
      for (const [row, height] of measured ?? []) this.set(row, height);
      return;
    }
    this.values = new Float64Array(count);
    this.tree = new Float64Array(count + 1);
    for (let index = 0; index < count; index++) {
      const minimum = Number.isFinite(source[index]) ? Math.max(26, source[index]) : 26;
      const height = measured?.get(index + 1);
      this.values[index] = height !== undefined && Number.isFinite(height) ? Math.max(minimum, height) : minimum;
      this.tree[index + 1] += this.values[index];
      const parent = index + 1 + ((index + 1) & -(index + 1));
      if (parent <= count) this.tree[parent] += this.tree[index + 1];
    }
  }

  height(row: number): number { return this.values?.[row - 1] ?? this.measured.get(row) ?? 26; }

  before(row: number): number {
    let index = Math.min(this.count, Math.max(0, row - 1));
    let sum = this.tree ? 0 : index * 26;
    for (; index > 0; index -= index & -index) sum += this.tree?.[index] ?? this.deltas.get(index) ?? 0;
    return sum;
  }

  set(row: number, height: number): boolean {
    if (!Number.isInteger(row) || row < 1 || row > this.count || !Number.isFinite(height)) return false;
    const minimum = this.source?.[row - 1];
    height = Math.max(26, Number.isFinite(minimum) ? minimum! : 26, height);
    const delta = height - this.height(row);
    if (Math.abs(delta) < .25) return false;
    if (this.values) this.values[row - 1] = height;
    else if (height === 26) this.measured.delete(row);
    else this.measured.set(row, height);
    for (let index = row; index <= this.count; index += index & -index) {
      if (this.tree) this.tree[index] += delta;
      else {
        const next = (this.deltas.get(index) ?? 0) + delta;
        if (next) this.deltas.set(index, next);
        else this.deltas.delete(index);
      }
    }
    return true;
  }

  at(pixel: number): number {
    let index = 0, sum = 0, bit = 1;
    while (bit * 2 <= this.count) bit *= 2;
    for (; bit; bit >>= 1) {
      const next = index + bit;
      if (next > this.count) continue;
      const height = this.tree?.[next] ?? bit * 26 + (this.deltas.get(next) ?? 0);
      if (sum + height <= pixel) { index = next; sum += height; }
    }
    return Math.min(this.count, index + 1);
  }
}
