import type { ParsedCell, ParsedSheet } from './types';

/** A directory over 32-column bitmaps. Each bitmap maps column bits to
 * offsets in a worksheet row's existing cell array. */
export class WorksheetCellIndex {
  private readonly rows: Float64Array;
  private readonly rowPages: Uint32Array;
  private readonly pages: Float64Array;
  private readonly masks: Uint32Array;
  private readonly offsets: Uint32Array;
  private readonly rowCells: readonly (readonly ParsedCell[])[];
  private lastRow = -1;

  constructor(sheet: ParsedSheet) {
    const rows: number[] = [], rowPages: number[] = [], pages: number[] = [];
    const masks: number[] = [], offsets: number[] = [], rowCells: ParsedCell[][] = [];
    let input = sheet.rows, previousRow = 0;
    for (const row of input) {
      if (!validCoordinate(row.index) || row.index < previousRow) {
        input = input.filter(row => validCoordinate(row.index)).sort((a, b) => a.index - b.index);
        break;
      }
      previousRow = row.index;
    }
    for (let at = 0; at < input.length;) {
      const row = input[at++];
      let cells = row.cells;
      if (input[at]?.index === row.index) {
        cells = cells.slice();
        do {
          for (const cell of input[at++].cells) cells.push(cell);
        } while (input[at]?.index === row.index);
      }
      cells = orderedCells(cells);
      if (!cells.length) continue;
      rows.push(row.index);
      rowPages.push(pages.length);
      rowCells.push(cells);
      let previousPage = -1;
      for (let i = 0; i < cells.length; i++) {
        const column = cells[i].column - 1, page = Math.floor(column / 32);
        if (page !== previousPage) {
          pages.push(page);
          masks.push(0);
          offsets.push(i);
          previousPage = page;
        }
        masks[masks.length - 1] |= 1 << (column % 32);
      }
    }
    rowPages.push(pages.length);
    this.rows = Float64Array.from(rows);
    this.rowPages = Uint32Array.from(rowPages);
    this.pages = Float64Array.from(pages);
    this.masks = Uint32Array.from(masks);
    this.offsets = Uint32Array.from(offsets);
    this.rowCells = rowCells;
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
    return mask & bit ? this.rowCells[at][this.offsets[page] + popcount(mask & (bit - 1))] : undefined;
  }

  forEachInRange(firstRow: number, lastRow: number, firstColumn: number, lastColumn: number,
    visit: (cell: ParsedCell, row: number, column: number) => unknown, reverse = false): void {
    const first = lowerBound(this.rows, firstRow, 0, this.rows.length);
    const last = reverse ? lowerBound(this.rows, Math.floor(lastRow) + 1, first, this.rows.length) - 1 : first;
    const step = reverse ? -1 : 1;
    for (let row = last; row >= first && row < this.rows.length && this.rows[row] <= lastRow; row += step) {
      const cells = this.rowCells[row];
      let begin = 0, end = cells.length;
      // Fully covered rows already form a contiguous span. Only clipped ends
      // need a page search and bitmap rank.
      if (cells[0].column < firstColumn) begin = this.boundary(row, firstColumn, false);
      if (cells[end - 1].column > lastColumn) end = this.boundary(row, lastColumn, true);
      if (reverse) {
        for (let i = end - 1; i >= begin; i--) if (visit(cells[i], this.rows[row], cells[i].column) === false) return;
      } else {
        for (let i = begin; i < end; i++) if (visit(cells[i], this.rows[row], cells[i].column) === false) return;
      }
    }
  }

  *occupiedPositions(firstRow: number, lastRow: number, firstColumn: number, lastColumn: number, reverse = false): Iterable<number> {
    const width = lastColumn - firstColumn + 1;
    const first = lowerBound(this.rows, firstRow, 0, this.rows.length);
    const last = reverse ? lowerBound(this.rows, Math.floor(lastRow) + 1, first, this.rows.length) - 1 : first;
    for (let row = last; row >= first && row < this.rows.length && this.rows[row] <= lastRow; row += reverse ? -1 : 1) {
      const cells = this.rowCells[row];
      const begin = this.boundary(row, firstColumn, false), end = this.boundary(row, lastColumn, true);
      const offset = (this.rows[row] - firstRow) * width - firstColumn;
      if (reverse) for (let i = end - 1; i >= begin; i--) yield offset + cells[i].column;
      else for (let i = begin; i < end; i++) yield offset + cells[i].column;
    }
  }

  private boundary(row: number, column: number, inclusive: boolean): number {
    const key = Math.floor((column - 1) / 32), end = this.rowPages[row + 1];
    const page = lowerBound(this.pages, key, this.rowPages[row], end);
    if (page === end) return this.rowCells[row].length;
    let offset = this.offsets[page];
    if (this.pages[page] === key) {
      // Arithmetic powers also handle the unsigned high bit and a full word.
      const bits = 2 ** ((column - 1) % 32 + Number(inclusive)) - 1;
      offset += popcount(this.masks[page] & bits);
    }
    return offset;
  }
}

function orderedCells(cells: ParsedCell[]): ParsedCell[] {
  let previousColumn = 0;
  for (const { column } of cells) {
    if (!validCoordinate(column) || column <= previousColumn) {
      // Stable sorting keeps the last declaration for each column. Copy just
      // this row's references and preserve the cells used for calculation.
      const sorted = cells.filter(cell => validCoordinate(cell.column)).sort((a, b) => a.column - b.column);
      let size = 0;
      for (const cell of sorted) {
        if (size && sorted[size - 1].column === cell.column) sorted[size - 1] = cell;
        else sorted[size++] = cell;
      }
      sorted.length = size;
      return sorted;
    }
    previousColumn = column;
  }
  return cells;
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
