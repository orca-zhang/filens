import type { ParsedCell, ParsedSheet } from './types';

/** A bulk-loaded, ordered directory over packed 32-column leaves. Each leaf
 * stores only occupied cells; its bitmap maps column bits to packed offsets.
 * The workbook model stays untouched, including unordered and duplicate rows. */
export class WorksheetCellIndex {
  private readonly rows: Float64Array;
  private readonly rowPages: Uint32Array;
  private readonly pages: Float64Array;
  private readonly masks: Uint32Array;
  private readonly offsets: Uint32Array;
  private readonly cells: ParsedCell[];
  private lastRow = -1;

  constructor(sheet: ParsedSheet) {
    const rows: number[] = [], rowPages: number[] = [], pages: number[] = [];
    const masks: number[] = [], offsets: number[] = [], cells: ParsedCell[] = [];
    let previousRow = -1, previousColumn = -1;
    const append = (row: number, cell: ParsedCell) => {
      if (row === previousRow && cell.column === previousColumn) {
        cells[cells.length - 1] = cell;
        return;
      }
      const page = Math.floor((cell.column - 1) / 32);
      if (row !== previousRow) {
        rows.push(row);
        rowPages.push(pages.length);
      }
      if (row !== previousRow || page !== pages[pages.length - 1]) {
        pages.push(page);
        masks.push(0);
        offsets.push(cells.length);
      }
      masks[masks.length - 1] |= 1 << ((cell.column - 1) % 32);
      cells.push(cell);
      previousRow = row;
      previousColumn = cell.column;
    };
    let ordered = true;
    // Build ordered sheets directly, without flattening a second copy of all
    // cell references and row coordinates first.
    scan: for (const row of sheet.rows) {
      if (!validCoordinate(row.index)) continue;
      for (const cell of row.cells) {
        if (!validCoordinate(cell.column)) continue;
        if (row.index < previousRow || (row.index === previousRow && cell.column < previousColumn)) {
          ordered = false;
          break scan;
        }
        append(row.index, cell);
      }
    }
    if (!ordered) {
      rows.length = rowPages.length = pages.length = masks.length = offsets.length = cells.length = 0;
      previousRow = previousColumn = -1;
      const sorted = sheet.rows.filter(row => validCoordinate(row.index)).sort((a, b) => a.index - b.index);
      // Stable sorting preserves duplicate declarations. Hold only one row's
      // temporary cells at a time, including scattered copies of that row.
      for (let at = 0; at < sorted.length;) {
        const row = sorted[at].index, group: ParsedCell[] = [];
        do {
          for (const cell of sorted[at++].cells) if (validCoordinate(cell.column)) group.push(cell);
        } while (at < sorted.length && sorted[at].index === row);
        for (const cell of group.sort((a, b) => a.column - b.column)) append(row, cell);
      }
    }
    rowPages.push(pages.length);
    offsets.push(cells.length);
    this.rows = Float64Array.from(rows);
    this.rowPages = Uint32Array.from(rowPages);
    this.pages = Float64Array.from(pages);
    this.masks = Uint32Array.from(masks);
    this.offsets = Uint32Array.from(offsets);
    this.cells = cells;
  }

  get(row: number, column: number): ParsedCell | undefined {
    if (!Number.isSafeInteger(row) || !Number.isSafeInteger(column) || column < 1) return undefined;
    let at = this.lastRow;
    if (at < 0 || this.rows[at] !== row) {
      at = lowerBound(this.rows, row, 0, this.rows.length);
      if (this.rows[at] !== row) return undefined;
      this.lastRow = at;
    }
    const key = Math.floor((column - 1) / 32), end = this.rowPages[at + 1];
    const page = lowerBound(this.pages, key, this.rowPages[at], end);
    if (page === end || this.pages[page] !== key) return undefined;
    const bit = 1 << ((column - 1) % 32), mask = this.masks[page];
    return mask & bit ? this.cells[this.offsets[page] + popcount(mask & (bit - 1))] : undefined;
  }

  forEachInRange(firstRow: number, lastRow: number, firstColumn: number, lastColumn: number,
    visit: (cell: ParsedCell) => void): void {
    for (let row = lowerBound(this.rows, firstRow, 0, this.rows.length);
      row < this.rows.length && this.rows[row] <= lastRow; row++) {
      let begin = this.offsets[this.rowPages[row]], end = this.offsets[this.rowPages[row + 1]];
      // Fully covered rows already form a contiguous span. Only clipped ends
      // need a page search and bitmap rank.
      if (this.cells[begin].column < firstColumn) begin = this.boundary(row, firstColumn, false);
      if (this.cells[end - 1].column > lastColumn) end = this.boundary(row, lastColumn, true);
      for (let i = begin; i < end; i++) visit(this.cells[i]);
    }
  }

  private boundary(row: number, column: number, inclusive: boolean): number {
    const key = Math.floor((column - 1) / 32), end = this.rowPages[row + 1];
    const page = lowerBound(this.pages, key, this.rowPages[row], end);
    let offset = this.offsets[page];
    if (page < end && this.pages[page] === key) {
      // Arithmetic powers also handle the unsigned high bit and a full word.
      const bits = 2 ** ((column - 1) % 32 + Number(inclusive)) - 1;
      offset += popcount(this.masks[page] & bits);
    }
    return offset;
  }
}

function validCoordinate(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function lowerBound(keys: Float64Array, key: number, first: number, last: number): number {
  while (first < last) {
    const middle = first + Math.floor((last - first) / 2);
    if (keys[middle] < key) first = middle + 1;
    else last = middle;
  }
  return first;
}

function popcount(value: number): number {
  value -= (value >>> 1) & 0x55555555;
  value = (value & 0x33333333) + ((value >>> 2) & 0x33333333);
  return (((value + (value >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}
