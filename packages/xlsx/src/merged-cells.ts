import type { ParsedCell, ParsedMerge, ParsedRow, ParsedSheet } from './types';
import { RowHeights } from './row-heights';
import { RowRangeIndex } from './row-range-index';

export interface MergeFragment extends ParsedMerge { source: ParsedMerge; cell?: ParsedCell; rowStyle?: number }

/** Index row intervals without allocating the cells covered by a merge. */
export class SheetMerges {
  private readonly ranges: RowRangeIndex<ParsedMerge>;
  private readonly rows: ParsedRow[];
  private readonly anchors = new Map<ParsedMerge, { cell?: ParsedCell; rowStyle?: number }>();
  private sourceHeights?: RowHeights;

  constructor(private readonly sheet: ParsedSheet) {
    this.ranges = new RowRangeIndex((sheet.merges ?? []).filter(range =>
      [range.firstRow, range.lastRow, range.firstColumn, range.lastColumn].every(Number.isSafeInteger)
      && range.firstRow > 0 && range.firstColumn > 0 && range.lastRow >= range.firstRow && range.lastColumn >= range.firstColumn
      && range.lastRow <= sheet.rowCount && range.lastColumn <= sheet.columnCount));
    this.rows = sheet.rows.every((row, index, rows) => !index || row.index >= rows[index - 1].index)
      ? sheet.rows : [...sheet.rows].sort((a, b) => a.index - b.index);
  }

  before(row: number): number {
    if (!this.sheet.rowHeights) return (row - 1) * 26;
    this.sourceHeights ??= new RowHeights(this.sheet.rowCount, this.sheet.rowHeights);
    return this.sourceHeights.before(row);
  }

  /** Only mounted rows receive interval lists. Native spans are clipped to the
   * window (and HTML's limits); incremental batches retain earlier anchors. */
  window(firstRow: number, lastRow: number, firstColumn: number, lastColumn: number, incremental = false): Map<number, MergeFragment[]> {
    const rows = new Map<number, MergeFragment[]>();
    this.ranges.forEach(firstRow, lastRow, source => {
      if (source.lastColumn < firstColumn || source.firstColumn > lastColumn) return;
      const first = Math.max(source.firstRow, firstRow), last = Math.min(source.lastRow, lastRow);
      const left = Math.max(source.firstColumn, firstColumn), right = Math.min(source.lastColumn, lastColumn);
      // Malformed overlapping declarations cannot produce overlapping native cells.
      for (let row = first; row <= last; row++) {
        if (rows.get(row)?.some(range => range.firstColumn <= right && range.lastColumn >= left)) return;
      }
      for (let row = first; row <= last; row++) {
        const start = incremental ? source.firstRow + Math.floor((row - source.firstRow) / 65_534) * 65_534 : first;
        const ranges = rows.get(row) ?? [];
        for (let column = left; column <= right; column += 1000) {
          ranges.push({ source, ...this.anchor(source), firstRow: start,
            lastRow: incremental ? Math.min(source.lastRow, start + 65_533) : last,
            firstColumn: column, lastColumn: Math.min(right, column + 999) });
        }
        rows.set(row, ranges);
      }
    });
    for (const ranges of rows.values()) ranges.sort((a, b) => a.firstColumn - b.firstColumn);
    return rows;
  }

  private anchor(range: ParsedMerge): { cell?: ParsedCell; rowStyle?: number } {
    const cached = this.anchors.get(range);
    if (cached) return cached;
    let low = 0, high = this.rows.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.rows[middle].index <= range.firstRow) low = middle + 1;
      else high = middle;
    }
    const row = this.rows[low - 1];
    let cell: ParsedCell | undefined;
    if (row?.index === range.firstRow) {
      for (let at = row.cells.length - 1; at >= 0; at--) {
        if (row.cells[at].column === range.firstColumn) { cell = row.cells[at]; break; }
      }
    }
    const anchor = { cell, rowStyle: row?.index === range.firstRow ? row.styleIndex : undefined };
    this.anchors.set(range, anchor);
    return anchor;
  }
}

const indexes = new WeakMap<ParsedSheet, SheetMerges>();
export function sheetMerges(sheet: ParsedSheet): SheetMerges | undefined {
  if (!sheet.merges?.length) return undefined;
  let index = indexes.get(sheet);
  if (!index) { index = new SheetMerges(sheet); indexes.set(sheet, index); }
  return index;
}
