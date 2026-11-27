import type { ParsedSheet, ParsedTrackRange } from './types';

type VisibleBlock = ParsedTrackRange & { prior: number; through: number };

/** Translate between source coordinates and visible ordinals without expanding hidden intervals. */
export class VisibleTracks {
  readonly count: number;
  private readonly blocks?: VisibleBlock[];

  constructor(readonly sourceCount: number, hidden?: readonly ParsedTrackRange[]) {
    this.count = sourceCount;
    if (!hidden?.length) return;
    const intervals = hidden.filter(({ first, last }) => Number.isSafeInteger(first) && Number.isSafeInteger(last)
      && first <= last && last >= 1 && first <= sourceCount).sort((a, b) => a.first - b.first);
    if (!intervals.length) return;
    let first = 1, prior = 0;
    const blocks: VisibleBlock[] = [];
    const add = (last: number) => {
      if (first > last) return;
      const through = prior + last - first + 1;
      blocks.push({ first, last, prior, through });
      prior = through;
    };
    for (const interval of intervals) {
      add(interval.first - 1);
      first = Math.max(first, interval.last + 1);
    }
    add(sourceCount);
    this.count = prior;
    this.blocks = blocks;
  }

  before(source: number): number {
    if (!this.blocks) return Math.min(this.count, Math.max(0, source - 1));
    const block = firstAtLeast(this.blocks, source, 'last');
    return block ? block.prior + Math.max(0, source - block.first) : this.count;
  }

  source(ordinal: number): number {
    if (ordinal > this.count) return this.sourceCount + 1;
    if (!this.blocks) return ordinal;
    const block = firstAtLeast(this.blocks, ordinal, 'through');
    return block ? block.first + ordinal - block.prior - 1 : this.sourceCount + 1;
  }

  includes(source: number): boolean {
    return this.before(source + 1) > this.before(source);
  }
}

function firstAtLeast(blocks: readonly VisibleBlock[], value: number, key: 'last' | 'through'): VisibleBlock | undefined {
  let low = 0, high = blocks.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (blocks[middle][key] < value) low = middle + 1;
    else high = middle;
  }
  return blocks[low];
}

const tracks = new WeakMap<ParsedSheet, { rows: VisibleTracks; columns: VisibleTracks }>();
export function sheetTracks(sheet: ParsedSheet) {
  const rows = Math.max(1, sheet.rowCount), columns = Math.max(1, sheet.columnCount);
  let known = tracks.get(sheet);
  if (known?.rows.sourceCount !== rows || known.columns.sourceCount !== columns) {
    known = {
      rows: known?.rows.sourceCount === rows ? known.rows : new VisibleTracks(rows, sheet.hiddenRows),
      columns: known?.columns.sourceCount === columns ? known.columns : new VisibleTracks(columns, sheet.hiddenColumns)
    };
    tracks.set(sheet, known);
  }
  return known;
}

export function addHiddenTrack(ranges: ParsedTrackRange[], index: number): void {
  const previous = ranges.at(-1);
  if (previous?.last === index - 1) previous.last = index;
  else ranges.push({ first: index, last: index });
}
