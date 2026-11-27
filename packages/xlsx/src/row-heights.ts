import { VisibleTracks } from './visible-tracks';
import { fixedRowHeight, sourceRowHeight } from './xlsx-row-heights';
import type { ParsedRowHeightSource } from './types';

/** Prefix heights support sparse measurement updates and pixel-to-row lookup without a full scan on scroll. */
export class RowHeights {
  private readonly values?: Float64Array;
  private readonly tree?: Float64Array;
  private readonly measured = new Map<number, number>();
  private readonly deltas = new Map<number, number>();
  private readonly baseline: number;

  constructor(readonly count: number, private readonly source?: readonly number[], measured?: ReadonlyMap<number, number>,
    private readonly tracks = new VisibleTracks(count), private readonly xlsxSource?: ParsedRowHeightSource) {
    this.baseline = Math.max(1, xlsxSource?.height ?? 26);
    if (!source) {
      for (const [row, { height }] of xlsxSource?.rows ?? []) {
        if (height === undefined || !tracks.includes(row)) continue;
        const pixels = Math.max(1, height);
        if (pixels !== this.baseline) this.update(tracks.before(row + 1), pixels, pixels - this.baseline);
      }
      for (const [row, height] of measured ?? []) this.set(row, height);
      return;
    }
    this.values = new Float64Array(tracks.count);
    this.tree = new Float64Array(tracks.count + 1);
    for (let index = 0; index < tracks.count; index++) {
      const row = tracks.source(index + 1), minimum = this.minimum(row);
      const height = measured?.get(row);
      this.values[index] = height !== undefined && Number.isFinite(height) && !fixedRowHeight(xlsxSource, row)
        ? Math.max(minimum, height) : minimum;
      this.tree[index + 1] += this.values[index];
      const parent = index + 1 + ((index + 1) & -(index + 1));
      if (parent <= tracks.count) this.tree[parent] += this.tree[index + 1];
    }
  }

  height(row: number): number {
    const index = this.tracks.before(row);
    return index < this.tracks.before(row + 1) ? this.values?.[index] ?? this.measured.get(index + 1) ?? this.baseline : 0;
  }

  before(row: number): number {
    let index = this.tracks.before(row);
    let sum = this.tree ? 0 : index * this.baseline;
    for (; index > 0; index -= index & -index) sum += this.tree?.[index] ?? this.deltas.get(index) ?? 0;
    return sum;
  }

  set(row: number, height: number): boolean {
    if (!Number.isInteger(row) || row < 1 || row > this.count || !Number.isFinite(height) || fixedRowHeight(this.xlsxSource, row)) return false;
    const ordinal = this.tracks.before(row + 1);
    if (ordinal === this.tracks.before(row)) return false;
    height = Math.max(this.minimum(row), height);
    const delta = height - (this.values?.[ordinal - 1] ?? this.measured.get(ordinal) ?? this.baseline);
    if (Math.abs(delta) < .25) return false;
    this.update(ordinal, height, delta);
    return true;
  }

  private minimum(row: number): number {
    const height = this.source?.[row - 1];
    return sourceRowHeight(this.xlsxSource, row) ?? (Number.isFinite(height) ? Math.max(26, height!) : this.baseline);
  }

  private update(ordinal: number, height: number, delta: number): void {
    if (this.values) this.values[ordinal - 1] = height;
    else if (height === this.baseline) this.measured.delete(ordinal);
    else this.measured.set(ordinal, height);
    for (let index = ordinal; index <= this.tracks.count; index += index & -index) {
      if (this.tree) this.tree[index] += delta;
      else {
        const next = (this.deltas.get(index) ?? 0) + delta;
        if (next) this.deltas.set(index, next);
        else this.deltas.delete(index);
      }
    }
  }

  at(pixel: number): number {
    const count = this.tracks.count;
    if (!count) return this.count + 1;
    let index = 0, sum = 0, bit = 1;
    while (bit * 2 <= count) bit *= 2;
    for (; bit; bit >>= 1) {
      const next = index + bit;
      if (next > count) continue;
      const height = this.tree?.[next] ?? bit * this.baseline + (this.deltas.get(next) ?? 0);
      if (sum + height <= pixel) { index = next; sum += height; }
    }
    return this.tracks.source(Math.min(count, index + 1));
  }
}
