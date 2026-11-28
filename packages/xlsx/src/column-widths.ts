import { VisibleTracks } from './visible-tracks';

const DEFAULT_WIDTH = 96;

/** Static prefix widths keep horizontal windows and merged fragments in source coordinates. */
export class ColumnWidths {
  private readonly offsets?: Float64Array;

  constructor(readonly count: number, source?: readonly number[], readonly tracks = new VisibleTracks(count),
    minimums?: ReadonlyMap<number, number>) {
    if (!source) return;
    this.offsets = new Float64Array(tracks.count + 1);
    for (let index = 0; index < tracks.count; index++) {
      const column = tracks.source(index + 1);
      const width = source[column - 1];
      this.offsets[index + 1] = this.offsets[index]
        + Math.max(Number.isFinite(width) && width > 0 ? width : DEFAULT_WIDTH, minimums?.get(column) ?? 0);
    }
  }

  before(column: number): number {
    const index = this.tracks.before(column);
    return this.offsets ? this.offsets[index] : index * DEFAULT_WIDTH;
  }

  width(column: number): number { return this.before(column + 1) - this.before(column); }

  at(pixel: number): number {
    pixel = Math.max(0, pixel) || 0;
    const count = this.tracks.count;
    if (!count) return this.count + 1;
    if (!this.offsets) return this.tracks.source(Math.min(count, Math.floor(pixel / DEFAULT_WIDTH) + 1));
    let low = 1, high = count;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.offsets[middle] <= pixel) low = middle + 1;
      else high = middle;
    }
    return this.tracks.source(low);
  }
}
