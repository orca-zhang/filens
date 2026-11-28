import type { BorderBox, LineStyle } from '@filens/core';
import type { ParsedCell, ParsedMerge, ParsedRow, ParsedSheet } from './types';
import { RowHeights } from './row-heights';
import { RowRangeIndex } from './row-range-index';
import { sheetTracks } from './visible-tracks';
import { cellBorders } from './cell-borders';

export interface MergeFragment extends ParsedMerge { source: ParsedMerge; cell?: ParsedCell; rowStyle?: number }
export type MergeBorderSide = keyof BorderBox;

/** Index merge ranges without allocating their covered cells. */
export class SheetMerges {
  private readonly ranges: RowRangeIndex<ParsedMerge>;
  private readonly rows: ParsedRow[];
  private readonly tracks: ReturnType<typeof sheetTracks>;
  private readonly sortedCells = new WeakMap<ParsedRow, ParsedCell[]>();
  readonly hasStoredBorders: boolean;
  private sourceHeights?: RowHeights;

  constructor(private readonly sheet: ParsedSheet) {
    this.tracks = sheetTracks(sheet);
    this.ranges = new RowRangeIndex((sheet.merges ?? []).filter(range =>
      [range.firstRow, range.lastRow, range.firstColumn, range.lastColumn].every(Number.isSafeInteger)
      && range.firstRow > 0 && range.firstColumn > 0 && range.lastRow >= range.firstRow && range.lastColumn >= range.firstColumn
      && range.lastRow <= sheet.rowCount && range.lastColumn <= sheet.columnCount));
    this.rows = sheet.rows.every((row, index, rows) => !index || row.index >= rows[index - 1].index)
      ? sheet.rows : [...sheet.rows].sort((a, b) => a.index - b.index);
    this.hasStoredBorders = Boolean(sheet.cellStyles?.formats.some(style => style.borders));
  }

  before(row: number): number {
    if (!this.sheet.rowHeights && !this.sheet.rowHeightSource) return this.tracks.rows.before(row) * 26;
    this.sourceHeights ??= new RowHeights(this.tracks.rows.sourceCount, this.sheet.rowHeights, undefined, this.tracks.rows, this.sheet.rowHeightSource);
    return this.sourceHeights.before(row);
  }

  /** Only mounted rows receive interval lists. Native spans are clipped to the
   * window (and HTML's limits); incremental batches retain earlier anchors. */
  window(firstRow: number, lastRow: number, firstColumn: number, lastColumn: number, incremental = false): Map<number, MergeFragment[]> {
    const rows = new Map<number, MergeFragment[]>();
    const { rows: rowTracks, columns: columnTracks } = this.tracks;
    this.ranges.forEach(firstRow, lastRow, source => {
      const first = rowTracks.before(Math.max(source.firstRow, firstRow)) + 1;
      const last = rowTracks.before(Math.min(source.lastRow, lastRow) + 1);
      const left = columnTracks.before(Math.max(source.firstColumn, firstColumn)) + 1;
      const right = columnTracks.before(Math.min(source.lastColumn, lastColumn) + 1);
      if (first > last || left > right) return;
      const sourceLeft = columnTracks.source(left), sourceRight = columnTracks.source(right);
      // Malformed overlapping declarations cannot produce overlapping native cells.
      for (let row = first; row <= last; row++) {
        if (rows.get(rowTracks.source(row))?.some(range => range.firstColumn <= sourceRight && range.lastColumn >= sourceLeft)) return;
      }
      const anchor = this.rowAt(source.firstRow);
      const cell = anchor && this.cellAt(anchor, source.firstColumn);
      const rowStyle = anchor?.styleIndex;
      const sourceStart = rowTracks.before(source.firstRow) + 1, sourceEnd = rowTracks.before(source.lastRow + 1);
      for (let row = first; row <= last; row++) {
        const start = incremental ? sourceStart + Math.floor((row - sourceStart) / 65_534) * 65_534 : first;
        const rowIndex = rowTracks.source(row);
        const ranges = rows.get(rowIndex) ?? [];
        for (let column = left; column <= right; column += 1000) {
          ranges.push({ source, cell, rowStyle, firstRow: rowTracks.source(start),
            lastRow: rowTracks.source(incremental ? Math.min(sourceEnd, start + 65_533) : last),
            firstColumn: columnTracks.source(column), lastColumn: columnTracks.source(Math.min(right, column + 999)) });
        }
        rows.set(rowIndex, ranges);
      }
    }, [firstColumn, lastColumn]);
    for (const ranges of rows.values()) ranges.sort((a, b) => a.firstColumn - b.firstColumn);
    return rows;
  }

  /** Only stored cells on this part of the source perimeter can add border segments. */
  *edgeBorders(merge: MergeFragment, side: MergeBorderSide, textRtl: boolean): Iterable<readonly [number, number, LineStyle]> {
    if (side === 'top' || side === 'bottom') {
      const row = this.rowAt(side === 'top' ? merge.source.firstRow : merge.source.lastRow);
      if (!row) return;
      const cells = this.orderedCells(row);
      for (let i = lowerBound(cells, merge.firstColumn, cellColumn); i < cells.length && cells[i].column <= merge.lastColumn; i++) {
        const cell = cells[i];
        if (cells[i + 1]?.column === cell.column || cell === merge.cell) continue;
        const border = this.borders(cell, textRtl)?.[side];
        if (border) yield [cell.column, cell.column, border];
      }
    } else {
      const column = (side === 'left') !== Boolean(this.sheet.rightToLeft) ? merge.source.firstColumn : merge.source.lastColumn;
      for (let i = lowerBound(this.rows, merge.firstRow, rowCoordinate); i < this.rows.length && this.rows[i].index <= merge.lastRow; i++) {
        const row = this.rows[i];
        if (this.rows[i + 1]?.index === row.index) continue;
        const cell = this.cellAt(row, column);
        const border = cell !== merge.cell ? this.borders(cell, textRtl)?.[side] : undefined;
        if (border) yield [row.index, row.index, border];
      }
    }
  }

  terminalBorders(range: ParsedMerge, textRtl: boolean): BorderBox | undefined {
    const row = this.rowAt(range.lastRow);
    return row && this.borders(this.cellAt(row, range.lastColumn), textRtl);
  }

  private borders(cell: ParsedCell | undefined, textRtl: boolean): BorderBox | undefined {
    return cell && cellBorders(this.sheet.cellStyles?.formats[cell.styleIndex ?? 0], textRtl);
  }

  private rowAt(index: number): ParsedRow | undefined {
    const row = this.rows[lowerBound(this.rows, index + 1, rowCoordinate) - 1];
    return row?.index === index ? row : undefined;
  }

  private cellAt(row: ParsedRow, column: number): ParsedCell | undefined {
    const cells = this.orderedCells(row);
    const cell = cells[lowerBound(cells, column + 1, cellColumn) - 1];
    return cell?.column === column ? cell : undefined;
  }

  private orderedCells(row: ParsedRow): ParsedCell[] {
    let cells = this.sortedCells.get(row);
    if (!cells) {
      cells = row.cells.every((cell, index) => !index || cell.column >= row.cells[index - 1].column)
        ? row.cells : row.cells.slice().sort((a, b) => a.column - b.column);
      this.sortedCells.set(row, cells);
    }
    return cells;
  }
}

const cellColumn = (cell: ParsedCell) => cell.column;
const rowCoordinate = (row: ParsedRow) => row.index;

function lowerBound<T>(items: readonly T[], target: number, coordinate: (item: T) => number): number {
  let low = 0, high = items.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (coordinate(items[mid]) < target) low = mid + 1;
    else high = mid;
  }
  return low;
}

const indexes = new WeakMap<ParsedSheet, SheetMerges>();
export function sheetMerges(sheet: ParsedSheet): SheetMerges | undefined {
  if (!sheet.merges?.length) return undefined;
  let index = indexes.get(sheet);
  if (!index) { index = new SheetMerges(sheet); indexes.set(sheet, index); }
  return index;
}
